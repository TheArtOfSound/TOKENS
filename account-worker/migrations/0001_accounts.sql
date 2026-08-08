CREATE TABLE IF NOT EXISTS ledger_accounts (
  oort_user_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  oort_username TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_color TEXT,
  avatar_url TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_handle_idx
  ON ledger_accounts(handle);

CREATE INDEX IF NOT EXISTS ledger_accounts_oort_username_idx
  ON ledger_accounts(oort_username);
