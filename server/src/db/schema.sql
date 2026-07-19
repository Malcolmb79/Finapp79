-- Bank connections established via GoCardless (one per linked institution).
CREATE TABLE IF NOT EXISTS bank_connections (
  id TEXT PRIMARY KEY,              -- GoCardless requisition id
  institution_id TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | linked | expired | error
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bank accounts, either synced from GoCardless or created manually.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,              -- GoCardless account id, or a generated uuid for manual accounts
  bank_connection_id TEXT REFERENCES bank_connections(id),
  name TEXT NOT NULL,
  iban TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL DEFAULT 'manual', -- gocardless | manual
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,              -- GoCardless transactionId, csv-import-derived hash, or generated uuid
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  booking_date TEXT NOT NULL,       -- ISO date
  amount REAL NOT NULL,             -- negative = outflow, positive = inflow
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT,
  counterparty TEXT,
  source TEXT NOT NULL DEFAULT 'manual', -- gocardless | manual | csv
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_date
  ON transactions (account_id, booking_date);

CREATE INDEX IF NOT EXISTS idx_transactions_category
  ON transactions (category_id);
