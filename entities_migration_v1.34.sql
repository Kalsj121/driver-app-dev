-- ============================================================
-- LCA Transfert v1.34 — Migration Entités (multi-tenancy)
-- À exécuter dans Supabase → SQL Editor → Run
-- ============================================================

-- 1. Table entities : liste centralisée pour éviter les doublons
CREATE TABLE IF NOT EXISTS entities (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entities_name   ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_active ON entities(is_active);

-- RLS permissif comme les autres tables
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='entities' AND policyname='entities_public_all') THEN
    CREATE POLICY "entities_public_all" ON entities FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 2. Colonne entity sur driver_accounts (à quelle entité appartient ce chauffeur)
ALTER TABLE driver_accounts ADD COLUMN IF NOT EXISTS entity TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_driver_accounts_entity ON driver_accounts(entity);

-- 3. Colonne allowed_entities sur bureau_accounts (quelles entités ce user bureau peut voir)
--    JSON array — si vide et non super_admin → voit tout (comportement admin classique)
ALTER TABLE bureau_accounts ADD COLUMN IF NOT EXISTS allowed_entities JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 4. Seed d'une entité par défaut pour ne pas commencer à vide
INSERT INTO entities (name, is_active) VALUES ('Liege Cargo Agency SA', true)
ON CONFLICT (name) DO NOTHING;

-- 5. Vérification
SELECT
  (SELECT COUNT(*) FROM entities) AS entities_count,
  (SELECT COUNT(*) FROM entities WHERE is_active) AS entities_actives,
  (SELECT COUNT(*) FROM driver_accounts WHERE entity IS NOT NULL AND entity != '') AS chauffeurs_avec_entite,
  (SELECT COUNT(*) FROM bureau_accounts WHERE allowed_entities::text != '[]') AS bureaux_avec_restriction;
