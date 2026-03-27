-- ============================================================
-- LCA Transfert — Migration Supabase
-- À exécuter dans l'éditeur SQL de votre projet Supabase
-- ============================================================

-- 1. Nouvelle table pour la gestion des véhicules (tracteurs & remorques)
CREATE TABLE IF NOT EXISTS vehicles (
  id         bigserial PRIMARY KEY,
  plate      text       UNIQUE NOT NULL,
  type       text       NOT NULL CHECK (type IN ('tracteur','remorque')),
  active     boolean    NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Activer RLS (Row Level Security) et permettre la lecture publique
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read vehicles" ON vehicles FOR SELECT USING (true);
CREATE POLICY "Public insert vehicles" ON vehicles FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update vehicles" ON vehicles FOR UPDATE USING (true);
CREATE POLICY "Public delete vehicles" ON vehicles FOR DELETE USING (true);

-- 2. Ajouter la colonne plate_remorque dans la table active_drivers
ALTER TABLE active_drivers ADD COLUMN IF NOT EXISTS plate_remorque text NOT NULL DEFAULT '';

-- 3. Ajouter la colonne plate_remorque dans la table missions
ALTER TABLE missions ADD COLUMN IF NOT EXISTS plate_remorque text NOT NULL DEFAULT '';

-- 4. (Optionnel) Ajouter plate_remorque dans missions_archive si elle existe
ALTER TABLE missions_archive ADD COLUMN IF NOT EXISTS plate_remorque text NOT NULL DEFAULT '';

-- ============================================================
-- Exemples de données pour tester (à adapter selon vos plaques)
-- ============================================================
-- INSERT INTO vehicles (plate, type) VALUES ('1-LCA-001', 'tracteur');
-- INSERT INTO vehicles (plate, type) VALUES ('1-LCA-002', 'tracteur');
-- INSERT INTO vehicles (plate, type) VALUES ('R-001', 'remorque');
-- INSERT INTO vehicles (plate, type) VALUES ('R-002', 'remorque');
