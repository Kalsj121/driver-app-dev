-- ============================================================
-- LCA Transfert v1.37.7 — Phase 2.5 : Sécurisation entities + vehicles + bureau_settings
--
-- Les 3 dernières tables encore ouvertes en écriture pour anon :
--   - entities           (super_admin uniquement, création/rename/toggle/delete)
--   - vehicles           (super_admin uniquement, upsert/toggle/delete)
--   - bureau_settings    (super_admin uniquement, upsert des seuils d'alerte)
--
-- Après migration, toutes les écritures passent par RPCs SECURITY DEFINER.
-- SELECT reste ouvert pour que le dashboard et l'app chauffeur puissent lire.
--
-- Idempotent — DEV uniquement.
-- ============================================================

-- ============================================================
-- 1) ENTITIES — super_admin
-- ============================================================
CREATE OR REPLACE FUNCTION entities_insert(p_token TEXT, p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF v_sess.role <> 'super_admin' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden'); END IF;
  IF p_name IS NULL OR LENGTH(TRIM(p_name)) = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'name_required');
  END IF;
  INSERT INTO entities (name, is_active) VALUES (TRIM(p_name), TRUE);
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION entities_insert(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entities_insert(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION entities_rename(p_token TEXT, p_old TEXT, p_new TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF v_sess.role <> 'super_admin' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden'); END IF;
  UPDATE entities SET name = TRIM(p_new), updated_at = NOW() WHERE name = p_old;
  -- Propagation sur driver_accounts.entity
  UPDATE driver_accounts SET entity = TRIM(p_new) WHERE entity = p_old;
  -- Propagation sur bureau_accounts.allowed_entities (JSONB)
  UPDATE bureau_accounts SET
    allowed_entities = (
      SELECT jsonb_agg(CASE WHEN v::TEXT = to_jsonb(p_old)::TEXT THEN to_jsonb(TRIM(p_new)) ELSE v END)
      FROM jsonb_array_elements(allowed_entities) v
    ), updated_at = NOW()
    WHERE allowed_entities @> to_jsonb(ARRAY[p_old]);
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION entities_rename(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entities_rename(TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION entities_toggle(p_token TEXT, p_id BIGINT, p_active BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF v_sess.role <> 'super_admin' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden'); END IF;
  UPDATE entities SET is_active = COALESCE(p_active, FALSE), updated_at = NOW() WHERE id = p_id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION entities_toggle(TEXT, BIGINT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entities_toggle(TEXT, BIGINT, BOOLEAN) TO anon, authenticated;

CREATE OR REPLACE FUNCTION entities_delete(p_token TEXT, p_id BIGINT, p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF v_sess.role <> 'super_admin' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden'); END IF;
  -- Vider entity chez les chauffeurs concernés
  UPDATE driver_accounts SET entity = '' WHERE entity = p_name;
  -- Retirer de allowed_entities des bureaux
  UPDATE bureau_accounts SET
    allowed_entities = (
      SELECT COALESCE(jsonb_agg(v), '[]'::jsonb) FROM jsonb_array_elements(allowed_entities) v
      WHERE v::TEXT <> to_jsonb(p_name)::TEXT
    ), updated_at = NOW()
    WHERE allowed_entities @> to_jsonb(ARRAY[p_name]);
  -- Supprimer l'entité
  DELETE FROM entities WHERE id = p_id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION entities_delete(TEXT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entities_delete(TEXT, BIGINT, TEXT) TO anon, authenticated;

-- ============================================================
-- 2) VEHICLES — super_admin
-- ============================================================
CREATE OR REPLACE FUNCTION vehicles_upsert(p_token TEXT, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_sess   RECORD;
  v_plate  TEXT;
  v_type   TEXT;
  v_active BOOLEAN;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF v_sess.role <> 'super_admin' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden'); END IF;

  v_plate  := TRIM(p_payload ->> 'plate');
  v_type   := TRIM(p_payload ->> 'type');
  v_active := CASE WHEN p_payload ? 'active' THEN (p_payload ->> 'active')::BOOLEAN ELSE TRUE END;

  IF v_plate IS NULL OR v_plate = '' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'plate_required'); END IF;
  IF v_type  NOT IN ('tracteur','remorque') THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'type_invalid'); END IF;

  INSERT INTO vehicles (plate, type, active)
  VALUES (v_plate, v_type, v_active)
  ON CONFLICT (plate) DO UPDATE
    SET type = EXCLUDED.type, active = EXCLUDED.active;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION vehicles_upsert(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vehicles_upsert(TEXT, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION vehicles_delete(p_token TEXT, p_plate TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF v_sess.role <> 'super_admin' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden'); END IF;
  DELETE FROM vehicles WHERE plate = p_plate;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION vehicles_delete(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vehicles_delete(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION vehicles_toggle(p_token TEXT, p_plate TEXT, p_active BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF v_sess.role <> 'super_admin' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden'); END IF;
  UPDATE vehicles SET active = COALESCE(p_active, FALSE) WHERE plate = p_plate;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION vehicles_toggle(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vehicles_toggle(TEXT, TEXT, BOOLEAN) TO anon, authenticated;

-- ============================================================
-- 3) BUREAU_SETTINGS — super_admin
-- ============================================================
CREATE OR REPLACE FUNCTION bureau_settings_set(p_token TEXT, p_key TEXT, p_value JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sess RECORD;
BEGIN
  SELECT * INTO v_sess FROM _bureau_resolve_session(p_token);
  IF v_sess IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'session_invalid'); END IF;
  IF v_sess.role <> 'super_admin' THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'forbidden'); END IF;
  INSERT INTO bureau_settings (key, value, updated_at, updated_by)
  VALUES (p_key, p_value, NOW(), v_sess.username)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW(), updated_by = v_sess.username;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION bureau_settings_set(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bureau_settings_set(TEXT, TEXT, JSONB) TO anon, authenticated;

-- ============================================================
-- 4) Verrouillage GRANTs
-- ============================================================
REVOKE INSERT, UPDATE, DELETE ON entities         FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON vehicles         FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON bureau_settings  FROM anon, authenticated;

-- SELECT reste ouvert (dashboard + app chauffeur lisent ces tables)
GRANT SELECT ON entities        TO anon, authenticated;
GRANT SELECT ON vehicles        TO anon, authenticated;
GRANT SELECT ON bureau_settings TO anon, authenticated;

-- Vérifications
SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname='entities_insert')::INT        AS ent_insert_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='entities_rename')::INT        AS ent_rename_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='entities_delete')::INT        AS ent_delete_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='vehicles_upsert')::INT        AS veh_upsert_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='vehicles_delete')::INT        AS veh_delete_ok,
  (SELECT COUNT(*) FROM pg_proc WHERE proname='bureau_settings_set')::INT    AS set_ok,
  (SELECT has_table_privilege('anon','entities','INSERT'))::INT              AS ent_insert_should_be_0,
  (SELECT has_table_privilege('anon','vehicles','INSERT'))::INT              AS veh_insert_should_be_0,
  (SELECT has_table_privilege('anon','bureau_settings','INSERT'))::INT       AS set_insert_should_be_0;
