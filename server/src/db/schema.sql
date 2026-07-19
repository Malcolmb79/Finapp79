-- A person who can sign in. Created either by claiming the pre-auth
-- "legacy" placeholder (see migrate.ts) or by a brand-new OAuth login.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (provider, provider_user_id) a user has signed in with.
-- Separate from `users` so the same person can link both Google and
-- Facebook to one account later without a schema change.
CREATE TABLE IF NOT EXISTS oauth_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,           -- google | facebook
  provider_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_user_id)
);

-- Backing store for express-session (see auth/sessionStore.ts). `sid` is
-- the opaque token in the session cookie; `data` is the session's JSON
-- blob (currently just { userId }).
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Bank connections established via Enable Banking (one per linked institution).
-- id is our own generated `state` uuid, since Enable Banking identifies an
-- ASPSP by a (name, country) pair rather than a single opaque id.
CREATE TABLE IF NOT EXISTS bank_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  institution_id TEXT NOT NULL,     -- ASPSP name
  institution_name TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | linked | expired | error
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bank accounts, either synced from Enable Banking or created manually.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,              -- Enable Banking account uid, or a generated uuid for manual accounts
  user_id TEXT REFERENCES users(id),
  bank_connection_id TEXT REFERENCES bank_connections(id),
  name TEXT NOT NULL,
  iban TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL DEFAULT 'manual', -- enablebanking | manual
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Category names are unique per user, not globally — two different users
-- both wanting a "Groceries" category must not collide. The uniqueness
-- index itself is created in migrate.ts, not here: on an upgraded database
-- `categories` already exists without `user_id` at the point schema.sql
-- runs (CREATE TABLE IF NOT EXISTS is a no-op for it), so a standalone
-- `CREATE INDEX ... (user_id, name)` statement in this file would fail the
-- entire schema.exec() batch before migrate() ever gets to add the column.
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,              -- Enable Banking transaction_id/entry_reference, csv-import-derived hash, or generated uuid
  user_id TEXT REFERENCES users(id),
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

-- idx_transactions_user is created in migrate.ts, not here — same reason
-- as the categories/budgets indexes above: transactions already exists
-- without user_id on an upgraded database at the point this file runs.

-- One monthly spending limit per category. "Spent this month" is computed
-- at query time from transactions, not stored — it always reflects the
-- current calendar month, matching how the rest of the app treats "this
-- month" (no historical budget-period tracking yet).
-- One budget per (user, category) — see the categories comment above for
-- why that uniqueness index lives in migrate.ts instead of here.
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  monthly_limit REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A debt/loan balance being paid down. Payoff time is computed client-side
-- from balance/apr/minimum_payment via standard amortization math — not
-- stored, since it's a projection that changes as balance changes.
CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  balance REAL NOT NULL,
  apr REAL NOT NULL DEFAULT 0,       -- annual percentage rate, e.g. 19.99 for 19.99%
  minimum_payment REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A savings goal with manually-tracked progress (not linked to a specific
-- account balance, since a goal like "vacation fund" is often notional
-- rather than a literal separate account).
CREATE TABLE IF NOT EXISTS savings_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  current_amount REAL NOT NULL DEFAULT 0,
  target_date TEXT,                  -- nullable ISO date
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
