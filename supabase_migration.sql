-- ============================================================
-- LCA Transfert — Migration véhicules & chauffeurs actifs
-- Tables existantes : missions, messages
-- ============================================================

-- 1. Nouvelle colonne dans missions (tracteur déjà dans "plate", on ajoute remorque)
ALTER TABLE missions ADD COLUMN IF NOT EXISTS plate_remorque TEXT DEFAULT '';

-- 2. Nouvelle table : active_drivers (chauffeurs visibles en temps réel)
CREATE TABLE IF NOT EXISTS active_drivers (
  id             BIGSERIAL    PRIMARY KEY,
  username       TEXT         UNIQUE NOT NULL,
  fullname       TEXT         NOT NULL DEFAULT '',
  plate          TEXT         NOT NULL DEFAULT '',
  plate_remorque TEXT         NOT NULL DEFAULT '',
  lastseen       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE active_drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active_drivers_read"   ON active_drivers FOR SELECT USING (true);
CREATE POLICY "active_drivers_insert" ON active_drivers FOR INSERT WITH CHECK (true);
CREATE POLICY "active_drivers_update" ON active_drivers FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "active_drivers_delete" ON active_drivers FOR DELETE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE active_drivers;

-- 3. Nouvelle table : vehicles (listes tracteurs & remorques)
CREATE TABLE IF NOT EXISTS vehicles (
  id         BIGSERIAL    PRIMARY KEY,
  plate      TEXT         UNIQUE NOT NULL,
  type       TEXT         NOT NULL CHECK (type IN ('tracteur','remorque')),
  active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicles_read"   ON vehicles FOR SELECT USING (true);
CREATE POLICY "vehicles_insert" ON vehicles FOR INSERT WITH CHECK (true);
CREATE POLICY "vehicles_update" ON vehicles FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "vehicles_delete" ON vehicles FOR DELETE USING (true);
