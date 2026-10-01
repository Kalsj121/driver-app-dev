-- ============================================================
-- LCA Transfert v1.37.5 — Phase 2.3 : Sécurisation des messages
--
-- Avant : n'importe qui avec la clé anon pouvait
--   - INSERT un message en se faisant passer pour un chauffeur ou le bureau
--   - UPDATE / DELETE des messages existants
--
-- Après : toutes les écritures passent par des RPCs SECURITY DEFINER qui
-- valident la session et forcent `from` / `fromname` à l'identité réelle.
--
-- Idempotent — DEV uniquement.
-- ============================================================

-- ============================================================
-- 1) driver_send_message (le chauffeur authentifié envoie au bureau ou à qqn)
-- ============================================================
CREATE OR REPLACE FUNCTION driver_send_message(
  p_token           TEXT,
  p_client_id       BIGINT,
  p_to              TEXT,
  p_tolabel         TEXT,
  p_text            TEXT,
  p_attachment_url  TEXT DEFAULT NULL,
  p_attachment_type TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _driver_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;

  INSERT INTO messages (id, "from", fromname, "to", tolabel, text, ts, read, attachment_url, attachment_type)
  VALUES (
    COALESCE(p_client_id, (EXTRACT(EPOCH FROM NOW())*1000)::BIGINT),
    'driver',
    v_sess.fullname,
    COALESCE(p_to, 'bureau'),
    COALESCE(p_tolabel, 'Bureau'),
    COALESCE(p_text, ''),
    NOW(),
    FALSE,
    p_attachment_url,
    p_attachment_type
  );
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION driver_send_message(TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_send_message(TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;

-- ============================================================
-- 2) bureau_send_message (le bureau authentifié envoie à un ou plusieurs chauffeurs)
-- ============================================================
CREATE OR REPLACE FUNCTION bureau_send_message(
  p_token           TEXT,
  p_client_id       BIGINT,
  p_to              TEXT,
  p_tolabel         TEXT,
  p_text            TEXT,
  p_attachment_url  TEXT DEFAULT NULL,
  p_attachment_type TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;

  INSERT INTO messages (id, "from", fromname, "to", tolabel, text, ts, read, attachment_url, attachment_type)
  VALUES (
    COALESCE(p_client_id, (EXTRACT(EPOCH FROM NOW())*1000)::BIGINT),
    'bureau',
    COALESCE(NULLIF(TRIM(v_sess.fullname), ''), v_sess.username),
    COALESCE(p_to, 'all'),
    COALESCE(p_tolabel, 'Tous'),
    COALESCE(p_text, ''),
    NOW(),
    FALSE,
    p_attachment_url,
    p_attachment_type
  );
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION bureau_send_message(TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_send_message(TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;

-- ============================================================
-- 3) mark_messages_read — ouvert à anon (set read=true, inoffensif)
--    Pas besoin de session : l'action est trivialement idempotente et sans risque
--    (au pire un attaquant marque tout comme lu, ce qui n'enlève aucune donnée).
-- ============================================================
CREATE OR REPLACE FUNCTION mark_messages_read(p_ids BIGINT[])
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'touched', 0);
  END IF;
  UPDATE messages SET read = TRUE WHERE id = ANY(p_ids);
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION mark_messages_read(BIGINT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_messages_read(BIGINT[]) TO anon, authenticated;

-- ============================================================
-- 4) bureau_delete_message / bureau_delete_all_messages (super_admin only)
-- ============================================================
CREATE OR REPLACE FUNCTION bureau_delete_message(p_token TEXT, p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF v_sess.role <> 'super_admin' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden'); END IF;
  DELETE FROM messages WHERE id = p_id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION bureau_delete_message(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_delete_message(TEXT, BIGINT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION bureau_delete_all_messages(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD; v_count INT;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF v_sess.role <> 'super_admin' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden'); END IF;
  DELETE FROM messages;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', TRUE, 'deleted', v_count);
END;
$$;
REVOKE ALL ON FUNCTION bureau_delete_all_messages(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_delete_all_messages(TEXT) TO anon, authenticated;

-- ============================================================
-- 5) Verrouillage des GRANTs
-- ============================================================
-- SELECT reste ouvert pour que la realtime subscription + les lectures client fonctionnent
GRANT SELECT ON messages TO anon, authenticated;
-- INSERT / UPDATE / DELETE révoqués en direct
REVOKE INSERT, UPDATE, DELETE ON messages FROM anon, authenticated;

-- Vérifications
SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname='driver_send_message')::INT       AS driver_send_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='bureau_send_message')::INT       AS bureau_send_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='mark_messages_read')::INT        AS mark_read_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='bureau_delete_message')::INT     AS delete_one_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='bureau_delete_all_messages')::INT AS delete_all_ok,
  (SELECT has_table_privilege('anon','messages','INSERT'))::INT                 AS insert_should_be_0,
  (SELECT has_table_privilege('anon','messages','DELETE'))::INT                 AS delete_should_be_0;

-- ============================================================
-- Après : déployer immédiatement les nouveaux supabase_config.js + index.html + dashboard.html
-- ============================================================
