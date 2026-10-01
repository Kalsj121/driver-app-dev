-- ============================================================
-- LCA Transfert v1.37.6 — Phase 2.4 : Sécurisation des push_subscriptions
--
-- Avant : n'importe qui pouvait
--   - insérer un faux endpoint push dans les tables (spam potentiel)
--   - lire les endpoints + clés p256dh/auth (= capacité d'envoi push si VAPID privée obtenue)
--   - supprimer les abonnements d'autres users
--   - toggle alerts_enabled d'un autre bureau
--
-- Après : toutes les écritures passent par des RPCs SECURITY DEFINER qui
-- valident la session (driver ou bureau) et empêchent toute manipulation croisée.
-- Les Edge Functions (service_role) continuent à voir tout — pas d'impact sur
-- l'envoi réel des notifications.
--
-- Idempotent — DEV uniquement.
-- ============================================================

-- ============================================================
-- 1) RPCs chauffeur
-- ============================================================
CREATE OR REPLACE FUNCTION driver_subscribe_push(
  p_token      TEXT,
  p_endpoint   TEXT,
  p_p256dh     TEXT,
  p_auth       TEXT,
  p_user_agent TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _driver_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF p_endpoint IS NULL OR LENGTH(TRIM(p_endpoint)) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'endpoint_required');
  END IF;

  -- Nettoyage défensif : supprimer les anciens abonnements de ce chauffeur
  -- qui ne sont PAS cet endpoint (évite les notifications doublées si un ancien
  -- device n'a jamais correctement désinscrit).
  DELETE FROM push_subscriptions
   WHERE driver_username = v_sess.username
     AND endpoint <> p_endpoint;

  INSERT INTO push_subscriptions (driver_username, driver_fullname, endpoint, p256dh, auth, user_agent, last_used_at)
  VALUES (v_sess.username, v_sess.fullname, p_endpoint, p_p256dh, p_auth, LEFT(COALESCE(p_user_agent,''),500), NOW())
  ON CONFLICT (endpoint) DO UPDATE
    SET driver_username = EXCLUDED.driver_username,
        driver_fullname = EXCLUDED.driver_fullname,
        p256dh          = EXCLUDED.p256dh,
        auth            = EXCLUDED.auth,
        user_agent      = EXCLUDED.user_agent,
        last_used_at    = NOW();

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION driver_subscribe_push(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_subscribe_push(TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION driver_unsubscribe_push(p_token TEXT, p_endpoint TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _driver_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  DELETE FROM push_subscriptions
   WHERE driver_username = v_sess.username
     AND endpoint = p_endpoint;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION driver_unsubscribe_push(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_unsubscribe_push(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- 2) RPCs bureau
-- ============================================================
CREATE OR REPLACE FUNCTION bureau_subscribe_push(
  p_token      TEXT,
  p_endpoint   TEXT,
  p_p256dh     TEXT,
  p_auth       TEXT,
  p_user_agent TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF p_endpoint IS NULL OR LENGTH(TRIM(p_endpoint)) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'endpoint_required');
  END IF;

  -- Idem : nettoyer les abonnements du même username avec un autre endpoint
  DELETE FROM bureau_push_subscriptions
   WHERE username = v_sess.username
     AND endpoint <> p_endpoint;

  INSERT INTO bureau_push_subscriptions (username, endpoint, p256dh, auth, user_agent, last_used_at)
  VALUES (v_sess.username, p_endpoint, p_p256dh, p_auth, LEFT(COALESCE(p_user_agent,''),500), NOW())
  ON CONFLICT (endpoint) DO UPDATE
    SET username     = EXCLUDED.username,
        p256dh       = EXCLUDED.p256dh,
        auth         = EXCLUDED.auth,
        user_agent   = EXCLUDED.user_agent,
        last_used_at = NOW();

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION bureau_subscribe_push(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_subscribe_push(TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION bureau_unsubscribe_push(p_token TEXT, p_endpoint TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  DELETE FROM bureau_push_subscriptions
   WHERE username = v_sess.username
     AND endpoint = p_endpoint;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION bureau_unsubscribe_push(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_unsubscribe_push(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- 3) Toggle alertes bureau (set + get)
-- ============================================================
CREATE OR REPLACE FUNCTION bureau_get_alerts_enabled(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD; v_enabled BOOLEAN;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  SELECT alerts_enabled INTO v_enabled
    FROM bureau_push_subscriptions
    WHERE username = v_sess.username
    LIMIT 1;
  RETURN jsonb_build_object('ok', TRUE, 'enabled', COALESCE(v_enabled, FALSE));
END;
$$;
REVOKE ALL ON FUNCTION bureau_get_alerts_enabled(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_get_alerts_enabled(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION bureau_set_alerts_enabled(p_token TEXT, p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  UPDATE bureau_push_subscriptions
    SET alerts_enabled = COALESCE(p_enabled, FALSE)
    WHERE username = v_sess.username;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION bureau_set_alerts_enabled(TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_set_alerts_enabled(TEXT, BOOLEAN) TO anon, authenticated;

-- ============================================================
-- 4) Verrouillage des GRANTs : plus aucun accès direct depuis anon
--    (les Edge Functions utilisent service_role → non impactées)
-- ============================================================
REVOKE ALL ON push_subscriptions         FROM anon, authenticated;
REVOKE ALL ON bureau_push_subscriptions  FROM anon, authenticated;

-- Vérifications
SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname='driver_subscribe_push')::INT    AS drv_sub_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='driver_unsubscribe_push')::INT  AS drv_unsub_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='bureau_subscribe_push')::INT    AS bur_sub_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='bureau_unsubscribe_push')::INT  AS bur_unsub_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='bureau_get_alerts_enabled')::INT AS get_alerts_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='bureau_set_alerts_enabled')::INT AS set_alerts_ok,
  (SELECT has_table_privilege('anon','push_subscriptions','SELECT'))::INT        AS drv_select_should_be_0,
  (SELECT has_table_privilege('anon','bureau_push_subscriptions','SELECT'))::INT AS bur_select_should_be_0;
