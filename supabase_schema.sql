-- ============================================================
-- Supabase Database Schema for LCA Driver App
-- ============================================================
-- INSTRUCTIONS :
--   Si vous recréez les tables depuis zéro → exécutez le bloc OPTION A.
--   Si les tables existent déjà            → exécutez le bloc OPTION B
--   pour migrer les colonnes BIGINT → TIMESTAMPTZ.
-- ============================================================


-- ============================================================
-- OPTION A — Recréation complète (tables vides ou nouvelles)
-- ============================================================

DROP TABLE IF EXISTS missions CASCADE;
DROP TABLE IF EXISTS messages CASCADE;

CREATE TABLE missions (
  id          BIGINT PRIMARY KEY,
  driver      TEXT NOT NULL,
  plate       TEXT,
  date        TEXT NOT NULL,
  daystartts  TIMESTAMPTZ NOT NULL,
  dayendts    TIMESTAMPTZ,
  completed   BOOLEAN DEFAULT FALSE,
  stops       JSONB DEFAULT '[]'::jsonb,
  createdat   TIMESTAMPTZ DEFAULT NOW(),
  updatedat   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
  id          BIGINT PRIMARY KEY,
  "from"      TEXT NOT NULL,
  "fromname"  TEXT,
  "to"        TEXT NOT NULL,
  "tolabel"   TEXT,
  text        TEXT NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  "read"      BOOLEAN DEFAULT FALSE,
  createdat   TIMESTAMPTZ DEFAULT NOW(),
  updatedat   TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- OPTION B — Migration (si les tables existent déjà avec données)
-- Convertit BIGINT → TIMESTAMPTZ sans perdre les données
-- ⚠️ Décommentez UNIQUEMENT ce bloc si vous avez des données à conserver
-- ============================================================

-- ALTER TABLE missions
--   ALTER COLUMN daystartts TYPE TIMESTAMPTZ
--     USING to_timestamp(daystartts / 1000.0),
--   ALTER COLUMN dayendts TYPE TIMESTAMPTZ
--     USING to_timestamp(dayendts / 1000.0);

-- ALTER TABLE messages
--   ALTER COLUMN ts TYPE TIMESTAMPTZ
--     USING to_timestamp(ts / 1000.0);


-- ============================================================
-- INDEX
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_missions_driver    ON missions(driver);
CREATE INDEX IF NOT EXISTS idx_missions_date      ON missions(date);
CREATE INDEX IF NOT EXISTS idx_missions_completed ON missions(completed);
CREATE INDEX IF NOT EXISTS idx_messages_ts        ON messages(ts DESC);
CREATE INDEX IF NOT EXISTS idx_messages_from      ON messages("from");
CREATE INDEX IF NOT EXISTS idx_messages_to        ON messages("to");


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "missions_public_read"   ON missions FOR SELECT USING (true);
CREATE POLICY "missions_public_insert" ON missions FOR INSERT WITH CHECK (true);
CREATE POLICY "missions_public_update" ON missions FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "messages_public_read"   ON messages FOR SELECT USING (true);
CREATE POLICY "messages_public_insert" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "messages_public_update" ON messages FOR UPDATE USING (true) WITH CHECK (true);


-- ============================================================
-- REALTIME (pour le dashboard live)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE missions;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
