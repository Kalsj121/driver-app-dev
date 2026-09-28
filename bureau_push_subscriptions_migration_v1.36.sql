-- ============================================================
-- LCA Transfert v1.36 — Migration Bureau Push Subscriptions
-- Web Push pour l'app bureau (notifs même quand l'app est killée)
-- ============================================================

CREATE TABLE IF NOT EXISTS bureau_push_subscriptions (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL,
  fullname      TEXT DEFAULT '',
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bureau_push_username ON bureau_push_subscriptions(username);
CREATE INDEX IF NOT EXISTS idx_bureau_push_endpoint ON bureau_push_subscriptions(endpoint);

ALTER TABLE bureau_push_subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bureau_push_subscriptions' AND policyname='bureau_push_subs_public_all') THEN
    CREATE POLICY "bureau_push_subs_public_all" ON bureau_push_subscriptions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Vérification
SELECT 'bureau_push_subscriptions : ' ||
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name='bureau_push_subscriptions'
       ) THEN 'OK ✓' ELSE 'MANQUANT ✗' END AS info;
