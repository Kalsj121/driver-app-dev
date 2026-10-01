-- ============================================================
-- LCA Transfert v1.37.4 — Phase 2.2 : Sécurisation missions + archives + active_drivers
--
-- Objectif : plus aucune écriture directe sur missions, missions_archive,
-- active_drivers depuis le client. Tout passe par des RPCs SECURITY DEFINER
-- qui valident un token de session (driver ou bureau).
--
-- Après cette migration, un attaquant qui tape l'API Supabase :
--   - ne peut PLUS insérer de fausses missions au nom d'un chauffeur
--   - ne peut PLUS modifier ou supprimer des missions existantes
--   - ne peut PLUS ajouter / supprimer des chauffeurs connectés
--
-- Les sessions chauffeur sont désormais serveur-side (table driver_sessions,
-- fermée en lecture). Le token est délivré par attempt_driver_login à la
-- connexion et stocké côté client dans un cookie HttpOnly-like.
--
-- Idempotent — à passer sur DEV uniquement.
-- ============================================================

-- ============================================================
-- 1) driver_sessions — tokens serveur-side (fermée en lecture pour anon)
-- ============================================================
CREATE TABLE IF NOT EXISTS driver_sessions (
  token         TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_driver_sessions_username ON driver_sessions(username);
CREATE INDEX IF NOT EXISTS idx_driver_sessions_expires  ON driver_sessions(expires_at);

ALTER TABLE driver_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='driver_sessions' AND policyname='driver_sessions_deny_all') THEN
    CREATE POLICY "driver_sessions_deny_all" ON driver_sessions
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

REVOKE ALL ON driver_sessions FROM PUBLIC;
REVOKE ALL ON driver_sessions FROM anon;
REVOKE ALL ON driver_sessions FROM authenticated;

-- ============================================================
-- 2) Helper : résoudre un token chauffeur
-- ============================================================
CREATE OR REPLACE FUNCTION _driver_resolve_session(p_token TEXT)
RETURNS TABLE(
  username      TEXT,
  fullname      TEXT,
  pdf_allowed   BOOLEAN,
  entity        TEXT,
  expires_at    TIMESTAMPTZ,
  last_activity TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT ds.username, da.fullname, COALESCE(da.pdf_allowed, FALSE), da.entity,
         ds.expires_at, ds.last_activity
  FROM driver_sessions ds
  JOIN driver_accounts da ON da.username = ds.username
  WHERE ds.token = p_token
    AND ds.expires_at > NOW()
  LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION _driver_resolve_session(TEXT) FROM PUBLIC;

-- ============================================================
-- 3) RPC attempt_driver_login — remplace verify_driver_login
--    Même signature de login mais retourne JSONB avec session
-- ============================================================
CREATE OR REPLACE FUNCTION attempt_driver_login(
  p_username TEXT,
  p_hash     TEXT,
  p_ip       TEXT DEFAULT NULL,
  p_ua       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_acc            RECORD;
  v_hash_db        TEXT;
  v_token          TEXT;
  v_exp            TIMESTAMPTZ;
  v_session_hours  INT := 72;  -- long shift coverage
BEGIN
  SELECT * INTO v_acc FROM driver_accounts WHERE username = p_username LIMIT 1;
  IF v_acc.username IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'unknown_user');
  END IF;

  SELECT password_hash INTO v_hash_db FROM driver_credentials WHERE username = p_username LIMIT 1;
  IF v_hash_db IS NULL OR v_hash_db <> p_hash THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'bad_password');
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_exp   := NOW() + (v_session_hours || ' hours')::INTERVAL;
  INSERT INTO driver_sessions(token, username, expires_at, ip, user_agent)
    VALUES (v_token, v_acc.username, v_exp, p_ip, p_ua);

  RETURN jsonb_build_object(
    'ok', TRUE,
    'token', v_token,
    'expires_at', v_exp,
    'account', jsonb_build_object(
      'username',    v_acc.username,
      'fullname',    v_acc.fullname,
      'pdf_allowed', COALESCE(v_acc.pdf_allowed, FALSE),
      'entity',      v_acc.entity
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION attempt_driver_login(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attempt_driver_login(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- validate / touch / end
CREATE OR REPLACE FUNCTION validate_driver_session(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_row RECORD;
BEGIN
  SELECT * INTO v_row FROM _driver_resolve_session(p_token);
  IF v_row IS NULL THEN
    RETURN jsonb_build_object('valid', FALSE, 'reason', 'invalid_or_expired');
  END IF;
  RETURN jsonb_build_object(
    'valid', TRUE,
    'account', jsonb_build_object(
      'username',    v_row.username,
      'fullname',    v_row.fullname,
      'pdf_allowed', v_row.pdf_allowed,
      'entity',      v_row.entity
    ),
    'expires_at', v_row.expires_at
  );
END;
$$;
REVOKE ALL ON FUNCTION validate_driver_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_driver_session(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION touch_driver_session(p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN UPDATE driver_sessions SET last_activity = NOW() WHERE token = p_token; END;
$$;
REVOKE ALL ON FUNCTION touch_driver_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION touch_driver_session(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION end_driver_session(p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN DELETE FROM driver_sessions WHERE token = p_token; END;
$$;
REVOKE ALL ON FUNCTION end_driver_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION end_driver_session(TEXT) TO anon, authenticated;

-- ============================================================
-- 4) RPC driver_save_mission (upsert d'une mission, par le chauffeur authentifié)
--    - Le payload est un JSONB avec les colonnes de la table missions.
--    - La colonne `driver` est TOUJOURS écrasée par la username de la session
--      (plus de spoofing possible).
-- ============================================================
CREATE OR REPLACE FUNCTION driver_save_mission(p_token TEXT, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sess       RECORD;
  v_payload    JSONB;
  v_cols       TEXT;
  v_vals       TEXT;
  v_updates    TEXT;
  v_id         BIGINT;
  v_sql        TEXT;
BEGIN
  SELECT * INTO v_sess FROM _driver_resolve_session(p_token);
  IF v_sess IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid');
  END IF;

  -- Forcer le driver à la session, retirer updated_at non pertinent
  v_payload := p_payload - 'driver';
  v_payload := v_payload || jsonb_build_object('driver', v_sess.username, 'updatedat', NOW());

  -- Construire INSERT ... ON CONFLICT (id) DO UPDATE dynamiquement
  SELECT string_agg(quote_ident(k), ','),
         string_agg('(' || quote_literal(v::TEXT) || ')::jsonb', ',')
    INTO v_cols, v_vals
  FROM jsonb_each(v_payload) t(k, v);

  SELECT string_agg(quote_ident(k) || ' = EXCLUDED.' || quote_ident(k), ',')
    INTO v_updates
  FROM jsonb_each(v_payload) t(k, v)
  WHERE k <> 'id';

  v_sql := format(
    'INSERT INTO missions (%s) SELECT %s FROM jsonb_populate_record(NULL::missions, %L::jsonb) ON CONFLICT (id) DO UPDATE SET %s WHERE missions.driver = %L RETURNING id',
    v_cols,
    (SELECT string_agg(quote_ident(k), ',') FROM jsonb_each(v_payload) t(k,v)),
    v_payload::text,
    v_updates,
    v_sess.username
  );

  EXECUTE v_sql INTO v_id;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden_or_conflict');
  END IF;
  RETURN jsonb_build_object('ok', TRUE, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION driver_save_mission(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_save_mission(TEXT, JSONB) TO anon, authenticated;

-- ============================================================
-- 5) RPC driver_save_mission_archive (idem pour missions_archive)
-- ============================================================
CREATE OR REPLACE FUNCTION driver_save_mission_archive(p_token TEXT, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sess    RECORD;
  v_payload JSONB;
  v_cols    TEXT;
  v_updates TEXT;
  v_id      TEXT;
  v_sql     TEXT;
BEGIN
  SELECT * INTO v_sess FROM _driver_resolve_session(p_token);
  IF v_sess IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid');
  END IF;

  v_payload := p_payload - 'driver';
  v_payload := v_payload || jsonb_build_object('driver', v_sess.username);

  SELECT string_agg(quote_ident(k), ',') INTO v_cols FROM jsonb_each(v_payload) t(k,v);
  SELECT string_agg(quote_ident(k) || ' = EXCLUDED.' || quote_ident(k), ',') INTO v_updates
    FROM jsonb_each(v_payload) t(k,v) WHERE k <> 'id';

  v_sql := format(
    'INSERT INTO missions_archive (%s) SELECT %s FROM jsonb_populate_record(NULL::missions_archive, %L::jsonb) ON CONFLICT (id) DO UPDATE SET %s WHERE missions_archive.driver = %L RETURNING id',
    v_cols, v_cols, v_payload::text, v_updates, v_sess.username
  );
  EXECUTE v_sql INTO v_id;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden_or_conflict');
  END IF;
  RETURN jsonb_build_object('ok', TRUE, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION driver_save_mission_archive(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_save_mission_archive(TEXT, JSONB) TO anon, authenticated;

-- ============================================================
-- 6) RPC driver_register_active + driver_remove_active
-- ============================================================
CREATE OR REPLACE FUNCTION driver_register_active(
  p_token          TEXT,
  p_plate          TEXT DEFAULT '',
  p_plate_remorque TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _driver_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  INSERT INTO active_drivers (username, fullname, plate, plate_remorque, lastseen)
  VALUES (v_sess.username, v_sess.fullname, COALESCE(p_plate,''), COALESCE(p_plate_remorque,''), NOW())
  ON CONFLICT (username) DO UPDATE
    SET fullname       = EXCLUDED.fullname,
        plate          = EXCLUDED.plate,
        plate_remorque = EXCLUDED.plate_remorque,
        lastseen       = NOW();
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION driver_register_active(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_register_active(TEXT, TEXT, TEXT) TO anon, authenticated;

-- Met à jour un état pause/between_missions sur la ligne active_drivers du chauffeur authentifié
CREATE OR REPLACE FUNCTION driver_update_active_state(p_token TEXT, p_state JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_sess    RECORD;
  v_updates TEXT;
  v_sql     TEXT;
  v_touched INT;
BEGIN
  SELECT * INTO v_sess FROM _driver_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;

  -- Autorise seulement un petit set de colonnes (whitelist)
  SELECT string_agg(quote_ident(k) || ' = (' || quote_literal(v::text) || ')::jsonb', ',')
    INTO v_updates
    FROM jsonb_each(p_state) t(k,v)
    WHERE k IN ('lastseen','is_paused','pause_start','between_missions');
  IF v_updates IS NULL THEN
    v_updates := 'lastseen = to_jsonb(NOW())';
  ELSE
    v_updates := v_updates || ', lastseen = to_jsonb(NOW())';
  END IF;

  v_sql := format('UPDATE active_drivers SET %s WHERE username = %L', v_updates, v_sess.username);
  EXECUTE v_sql;
  GET DIAGNOSTICS v_touched = ROW_COUNT;

  -- Si 0 ligne → insérer la ligne minimale (chauffeur pas encore enregistré en actif)
  IF v_touched = 0 THEN
    INSERT INTO active_drivers (username, fullname, lastseen)
    VALUES (v_sess.username, v_sess.fullname, NOW())
    ON CONFLICT (username) DO NOTHING;
    EXECUTE v_sql;
  END IF;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION driver_update_active_state(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_update_active_state(TEXT, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION driver_remove_active(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _driver_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  DELETE FROM active_drivers WHERE username = v_sess.username;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION driver_remove_active(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_remove_active(TEXT) TO anon, authenticated;

-- ============================================================
-- 7) RPCs côté bureau — update/delete mission + dismiss active driver
-- ============================================================
CREATE OR REPLACE FUNCTION bureau_update_mission(
  p_caller_token TEXT, p_mission_id BIGINT, p_patch JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_caller  RECORD;
  v_updates TEXT;
  v_sql     TEXT;
  v_touched INT;
BEGIN
  SELECT * INTO v_caller FROM _bureau_resolve_session(p_caller_token);
  IF v_caller IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;

  SELECT string_agg(quote_ident(k) || ' = (' || quote_literal(v::text) || ')::jsonb', ',')
    INTO v_updates
    FROM jsonb_each(p_patch) t(k,v)
    WHERE k NOT IN ('id','driver');  -- driver immuable
  IF v_updates IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'empty_patch');
  END IF;
  v_sql := format('UPDATE missions SET %s WHERE id = %L', v_updates, p_mission_id);
  EXECUTE v_sql;
  GET DIAGNOSTICS v_touched = ROW_COUNT;
  RETURN jsonb_build_object('ok', TRUE, 'touched', v_touched);
END;
$$;
REVOKE ALL ON FUNCTION bureau_update_mission(TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_update_mission(TEXT, BIGINT, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION bureau_update_mission_archive(
  p_caller_token TEXT, p_id TEXT, p_patch JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_caller  RECORD;
  v_updates TEXT;
  v_sql     TEXT;
  v_touched INT;
BEGIN
  SELECT * INTO v_caller FROM _bureau_resolve_session(p_caller_token);
  IF v_caller IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;

  SELECT string_agg(quote_ident(k) || ' = (' || quote_literal(v::text) || ')::jsonb', ',')
    INTO v_updates
    FROM jsonb_each(p_patch) t(k,v)
    WHERE k NOT IN ('id','driver');
  IF v_updates IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'empty_patch'); END IF;
  v_sql := format('UPDATE missions_archive SET %s WHERE id = %L', v_updates, p_id);
  EXECUTE v_sql;
  GET DIAGNOSTICS v_touched = ROW_COUNT;
  RETURN jsonb_build_object('ok', TRUE, 'touched', v_touched);
END;
$$;
REVOKE ALL ON FUNCTION bureau_update_mission_archive(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_update_mission_archive(TEXT, TEXT, JSONB) TO anon, authenticated;

-- Variante upsert pour les cas où le bureau force une archive (ex: forceEndDay)
CREATE OR REPLACE FUNCTION bureau_upsert_mission_archive(
  p_caller_token TEXT, p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_caller  RECORD;
  v_cols    TEXT;
  v_updates TEXT;
  v_sql     TEXT;
  v_id      TEXT;
BEGIN
  SELECT * INTO v_caller FROM _bureau_resolve_session(p_caller_token);
  IF v_caller IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;

  SELECT string_agg(quote_ident(k), ',') INTO v_cols FROM jsonb_each(p_payload) t(k,v);
  SELECT string_agg(quote_ident(k) || ' = EXCLUDED.' || quote_ident(k), ',') INTO v_updates
    FROM jsonb_each(p_payload) t(k,v) WHERE k <> 'id';

  v_sql := format(
    'INSERT INTO missions_archive (%s) SELECT %s FROM jsonb_populate_record(NULL::missions_archive, %L::jsonb) ON CONFLICT (id) DO UPDATE SET %s RETURNING id',
    v_cols, v_cols, p_payload::text, v_updates
  );
  EXECUTE v_sql INTO v_id;
  RETURN jsonb_build_object('ok', TRUE, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION bureau_upsert_mission_archive(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_upsert_mission_archive(TEXT, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION bureau_delete_mission(
  p_caller_token TEXT, p_mission_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_caller RECORD;
BEGIN
  SELECT * INTO v_caller FROM _bureau_resolve_session(p_caller_token);
  IF v_caller IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF v_caller.role <> 'super_admin' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden'); END IF;
  DELETE FROM missions_archive WHERE id::TEXT = p_mission_id::TEXT;
  DELETE FROM missions         WHERE id = p_mission_id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION bureau_delete_mission(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_delete_mission(TEXT, BIGINT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION bureau_dismiss_active_driver(
  p_caller_token TEXT, p_username TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_caller RECORD;
BEGIN
  SELECT * INTO v_caller FROM _bureau_resolve_session(p_caller_token);
  IF v_caller IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  DELETE FROM active_drivers WHERE username = p_username;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION bureau_dismiss_active_driver(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_dismiss_active_driver(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- 8) Verrouillage des GRANTs : plus de INSERT/UPDATE/DELETE direct
-- ============================================================
REVOKE INSERT, UPDATE, DELETE ON missions          FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON missions_archive  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON active_drivers    FROM anon, authenticated;

-- SELECT reste ouvert (dashboard + app chauffeur en ont besoin)
GRANT SELECT ON missions         TO anon, authenticated;
GRANT SELECT ON missions_archive TO anon, authenticated;
GRANT SELECT ON active_drivers   TO anon, authenticated;

-- ============================================================
-- Vérifications
-- ============================================================
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='driver_sessions')::INT       AS driver_sessions_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='attempt_driver_login')::INT                       AS driver_login_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='driver_save_mission')::INT                        AS save_mission_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='driver_save_mission_archive')::INT                AS save_archive_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='bureau_update_mission')::INT                      AS bureau_update_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='bureau_delete_mission')::INT                      AS bureau_delete_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='driver_register_active')::INT                     AS register_active_ok,
  (SELECT has_table_privilege('anon','missions','INSERT'))::INT                                  AS missions_insert_should_be_0;

-- ============================================================
-- APRÈS cette migration :
--   → déployer immédiatement index.html + supabase_config.js + dashboard.html v1.37.4
--   → les chauffeurs connectés devront se reconnecter (login RPC émet le token)
--   → tester : login chauffeur, démarrage journée, ajout stop, fin journée
--   → tester côté dashboard : édition mission, suppression mission
-- ============================================================
