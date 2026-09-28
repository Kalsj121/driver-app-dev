-- ============================================================
-- LCA Transfert v1.35 — Migration Tâches LCA
-- ============================================================

-- Ajout des colonnes de suivi "Tâches LCA" sur active_drivers
ALTER TABLE active_drivers ADD COLUMN IF NOT EXISTS is_lca_tasks    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE active_drivers ADD COLUMN IF NOT EXISTS lca_tasks_start TIMESTAMPTZ;

-- Note : côté missions, les périodes "Tâches LCA" sont stockées dans une colonne
-- JSONB comme les pauses (via la ligne ci-dessous, idempotent)
ALTER TABLE missions ADD COLUMN IF NOT EXISTS lca_tasks JSONB DEFAULT '[]'::jsonb;

-- Vérification
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='active_drivers' AND column_name='is_lca_tasks')     AS ad_is_lca_tasks_col,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='active_drivers' AND column_name='lca_tasks_start')  AS ad_lca_tasks_start_col,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='missions' AND column_name='lca_tasks')              AS mis_lca_tasks_col;
