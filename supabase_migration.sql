-- ============================================================
-- LCA Transfert — Migration Supabase
-- À exécuter dans l'éditeur SQL de votre projet Supabase
-- ============================================================

-- 1. Table driver_accounts (logins chauffeurs — Supabase uniquement)
CREATE TABLE IF NOT EXISTS driver_accounts (
  id         bigserial    PRIMARY KEY,
  username   text         UNIQUE NOT NULL,
  fullname   text         NOT NULL DEFAULT '',
  password   text         NOT NULL DEFAULT '',
  created_at timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE driver_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='driver_accounts' AND policyname='Public read driver_accounts') THEN
    CREATE POLICY "Public read driver_accounts" ON driver_accounts FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='driver_accounts' AND policyname='Public insert driver_accounts') THEN
    CREATE POLICY "Public insert driver_accounts" ON driver_accounts FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='driver_accounts' AND policyname='Public update driver_accounts') THEN
    CREATE POLICY "Public update driver_accounts" ON driver_accounts FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='driver_accounts' AND policyname='Public delete driver_accounts') THEN
    CREATE POLICY "Public delete driver_accounts" ON driver_accounts FOR DELETE USING (true);
  END IF;
END $$;

-- 2. Table vehicles (tracteurs & remorques avec statut active/stand-by)
CREATE TABLE IF NOT EXISTS vehicles (
  id         bigserial    PRIMARY KEY,
  plate      text         UNIQUE NOT NULL,
  type       text         NOT NULL CHECK (type IN ('tracteur','remorque')),
  active     boolean      NOT NULL DEFAULT true,
  created_at timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vehicles' AND policyname='Public read vehicles') THEN
    CREATE POLICY "Public read vehicles" ON vehicles FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vehicles' AND policyname='Public insert vehicles') THEN
    CREATE POLICY "Public insert vehicles" ON vehicles FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vehicles' AND policyname='Public update vehicles') THEN
    CREATE POLICY "Public update vehicles" ON vehicles FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vehicles' AND policyname='Public delete vehicles') THEN
    CREATE POLICY "Public delete vehicles" ON vehicles FOR DELETE USING (true);
  END IF;
END $$;

-- 3. Table active_drivers (chauffeurs actifs en temps réel)
CREATE TABLE IF NOT EXISTS active_drivers (
  id             bigserial    PRIMARY KEY,
  username       text         UNIQUE NOT NULL,
  fullname       text         NOT NULL DEFAULT '',
  plate          text         NOT NULL DEFAULT '',
  plate_remorque text         NOT NULL DEFAULT '',
  lastseen       timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE active_drivers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='active_drivers' AND policyname='Public read active_drivers') THEN
    CREATE POLICY "Public read active_drivers" ON active_drivers FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='active_drivers' AND policyname='Public insert active_drivers') THEN
    CREATE POLICY "Public insert active_drivers" ON active_drivers FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='active_drivers' AND policyname='Public update active_drivers') THEN
    CREATE POLICY "Public update active_drivers" ON active_drivers FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='active_drivers' AND policyname='Public delete active_drivers') THEN
    CREATE POLICY "Public delete active_drivers" ON active_drivers FOR DELETE USING (true);
  END IF;
END $$;

-- Activer la Realtime publication pour active_drivers
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='active_drivers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE active_drivers;
  END IF;
END $$;

-- 4. Colonne plate_remorque dans missions (si pas encore présente)
ALTER TABLE missions ADD COLUMN IF NOT EXISTS plate_remorque text NOT NULL DEFAULT '';

-- 5. Colonne plate_remorque dans missions_archive (si la table existe)
-- ALTER TABLE missions_archive ADD COLUMN IF NOT EXISTS plate_remorque text NOT NULL DEFAULT '';

-- 6. Colonne pdf_allowed dans driver_accounts (permission feuille de route PDF)
ALTER TABLE driver_accounts ADD COLUMN IF NOT EXISTS pdf_allowed boolean NOT NULL DEFAULT false;

-- ============================================================
-- Données de test (décommenter pour insérer)
-- ============================================================
-- INSERT INTO vehicles (plate, type) VALUES ('1-LCA-001', 'tracteur') ON CONFLICT (plate) DO NOTHING;
-- INSERT INTO vehicles (plate, type) VALUES ('1-LCA-002', 'tracteur') ON CONFLICT (plate) DO NOTHING;
-- INSERT INTO vehicles (plate, type) VALUES ('R-001-BEL', 'remorque') ON CONFLICT (plate) DO NOTHING;
-- INSERT INTO vehicles (plate, type) VALUES ('R-002-BEL', 'remorque') ON CONFLICT (plate) DO NOTHING;
