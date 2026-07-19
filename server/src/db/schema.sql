-- Bank connections established via Enable Banking (one per linked institution).
-- id is our own generated `state` uuid, since Enable Banking identifies an
-- ASPSP by a (name, country) pair rather than a single opaque id.
CREATE TABLE IF NOT EXISTS bank_connections (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,     -- ASPSP name
  institution_name TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | linked | expired | error
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bank accounts, either synced from Enable Banking or created manually.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,              -- Enable Banking account uid, or a generated uuid for manual accounts
  bank_connection_id TEXT REFERENCES bank_connections(id),
  name TEXT NOT NULL,
  iban TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL DEFAULT 'manual', -- enablebanking | manual
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,              -- Enable Banking transaction_id/entry_reference, csv-import-derived hash, or generated uuid
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  booking_date TEXT NOT NULL,       -- ISO date
  amount REAL NOT NULL,             -- negative = outflow, positive = inflow
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT,
  counterparty TEXT,
  source TEXT NOT NULL DEFAULT 'manual', -- enablebanking | manual | csv
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_date
  ON transactions (account_id, booking_date);

CREATE INDEX IF NOT EXISTS idx_transactions_category
  ON transactions (category_id);

-- One monthly spending limit per category. "Spent this month" is computed
-- at query time from transactions, not stored — it always reflects the
-- current calendar month, matching how the rest of the app treats "this
-- month" (no historical budget-period tracking yet).
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id),
  monthly_limit REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
