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
-- Migration v1.03 : persistance du flux dispatch + pause
-- ============================================================
-- Timestamps de notification / réception d'instructions (missions actives)
ALTER TABLE missions ADD COLUMN IF NOT EXISTS tdispatchnotified timestamptz;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS tdispatchreceived timestamptz;

-- Pause en cours pendant une mission (survit au reload)
ALTER TABLE missions ADD COLUMN IF NOT EXISTS ispaused    boolean     NOT NULL DEFAULT false;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS tpausestart timestamptz;

-- Conservation des timestamps dispatch dans les archives
ALTER TABLE missions_archive ADD COLUMN IF NOT EXISTS tdispatchnotified timestamptz;
ALTER TABLE missions_archive ADD COLUMN IF NOT EXISTS tdispatchreceived timestamptz;

-- ============================================================
-- Migration v1.05 : pauses de la journée complète (même en dehors d'une mission)
-- ============================================================
-- Permet d'enregistrer les pauses prises par le chauffeur entre deux missions
-- (quand aucune mission active n'est attachée) afin qu'elles apparaissent bien
-- dans la feuille de route de fin de journée.
ALTER TABLE active_drivers ADD COLUMN IF NOT EXISTS day_pauses jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
-- Fin des migrations v1.02 → v1.05
-- ============================================================
