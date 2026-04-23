-- ============================================================
-- LCA Transfert — Migration Supabase v1.02 (FIX)
-- Corrige l'erreur "relation missions_archive does not exist"
-- À exécuter dans l'éditeur SQL de votre projet Supabase
-- ============================================================

-- 0. Créer la table missions_archive si elle n'existe pas encore
--    (copie la structure de missions pour rester cohérent)
CREATE TABLE IF NOT EXISTS missions_archive (
  id              text        PRIMARY KEY,
  driver          text        NOT NULL DEFAULT '',
  plate           text        NOT NULL DEFAULT '',
  plate_remorque  text        NOT NULL DEFAULT '',
  date            text        NOT NULL DEFAULT '',
  daystartts      timestamptz,
  dayendts        timestamptz,
  completed       boolean     NOT NULL DEFAULT false,
  stops           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  pauses          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updatedat       timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE missions_archive ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='missions_archive' AND policyname='Public read missions_archive') THEN
    CREATE POLICY "Public read missions_archive" ON missions_archive FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='missions_archive' AND policyname='Public insert missions_archive') THEN
    CREATE POLICY "Public insert missions_archive" ON missions_archive FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='missions_archive' AND policyname='Public update missions_archive') THEN
    CREATE POLICY "Public update missions_archive" ON missions_archive FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='missions_archive' AND policyname='Public delete missions_archive') THEN
    CREATE POLICY "Public delete missions_archive" ON missions_archive FOR DELETE USING (true);
  END IF;
END $$;

-- ============================================================
-- 1. Migration v1.02 : suivi pause & état entre-missions en temps réel
-- ============================================================

-- active_drivers : colonnes pause / entre-missions
ALTER TABLE active_drivers ADD COLUMN IF NOT EXISTS is_paused        boolean     NOT NULL DEFAULT false;
ALTER TABLE active_drivers ADD COLUMN IF NOT EXISTS pause_start      timestamptz;
ALTER TABLE active_drivers ADD COLUMN IF NOT EXISTS between_missions boolean     NOT NULL DEFAULT false;

-- missions : colonne pauses (array JSON) — pauses cumulées de la journée
ALTER TABLE missions ADD COLUMN IF NOT EXISTS pauses jsonb NOT NULL DEFAULT '[]'::jsonb;

-- missions_archive : colonnes plate_remorque et pauses
-- (sans risque maintenant que la table est garantie d'exister)
ALTER TABLE missions_archive ADD COLUMN IF NOT EXISTS plate_remorque text  NOT NULL DEFAULT '';
ALTER TABLE missions_archive ADD COLUMN IF NOT EXISTS pauses         jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
-- 2. Activer la Realtime publication pour active_drivers (si pas déjà fait)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='active_drivers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE active_drivers;
  END IF;
END $$;

-- ============================================================
-- Fin de la migration v1.02
-- ============================================================
