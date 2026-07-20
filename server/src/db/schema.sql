-- Postgres schema (Vercel Postgres in production, pglite locally — see
-- db/client.ts). Every statement is idempotent (IF NOT EXISTS throughout),
-- run on every boot, safe to re-run from any state. Unlike the SQLite
-- version this app started with, there's no ALTER-TABLE migration dance
-- here: this schema targets a fresh database, so user_id/password_hash and
-- every per-user unique index are just part of the table definitions from
-- the start rather than retrofitted.

-- A person who can sign in. Created either by an OAuth callback or by
-- email/password signup.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  avatar_url TEXT,
  password_hash TEXT,                -- nullable: OAuth-only users never set one
  email_verified_at TEXT,            -- nullable: set on verify-email, or immediately for OAuth signups (the provider already proved ownership)
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

-- This app already has a live database from before this column existed —
-- unlike every other table here, this can't just be "part of the table
-- definition from the start" via CREATE TABLE IF NOT EXISTS, since that's
-- a no-op against a table that already exists without it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TEXT;

-- One row per (provider, provider_user_id) a user has signed in with.
-- Separate from `users` so the same person can link both Google and
-- Facebook to one account later without a schema change.
CREATE TABLE IF NOT EXISTS oauth_identities (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,           -- google | facebook
  provider_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
  UNIQUE (provider, provider_user_id)
);

-- Single-use tokens for password reset and email verification links. The
-- token itself is never stored — only its SHA-256 hash — so a database
-- leak can't be turned into working reset/verify links (same reasoning as
-- never storing plaintext passwords). expires_at/used_at follow the same
-- app-computed-ISO-string convention as `sessions.expires_at`.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user ON email_verification_tokens (user_id);

-- Backing store for express-session (see auth/sessionStore.ts). `sid` is
-- the opaque token in the session cookie; `data` is the session's JSON
-- blob (currently just { userId }). expires_at is compared against an
-- ISO string generated in application code (not DB-side NOW()), so its
-- format always matches exactly what pruneExpiredSessions writes.
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
  logo TEXT,                        -- ASPSP logo URL from Enable Banking's /aspsps response, captured at /authorize time
  country TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | linked | expired | error
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

-- This app already has a live database from before this column existed —
-- see the identical users.email_verified_at case above for why this can't
-- just be part of the CREATE TABLE IF NOT EXISTS above.
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS logo TEXT;

-- Bank accounts, either synced from Enable Banking or created manually.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,              -- Enable Banking account uid, or a generated uuid for manual accounts
  user_id TEXT REFERENCES users(id),
  bank_connection_id TEXT REFERENCES bank_connections(id),
  name TEXT NOT NULL,
  iban TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL DEFAULT 'manual', -- enablebanking | manual
  -- Linked accounts only: the bank's own current balance, captured via
  -- Enable Banking's /accounts/:id/balances at sync time -- summing synced
  -- transactions is never accurate since only a 90-day window gets synced.
  -- Manual accounts have no such source of truth and stay derived from
  -- their own transaction history instead (these columns stay null).
  balance DOUBLE PRECISION,
  available_balance DOUBLE PRECISION,
  balance_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

-- This app already has a live database from before these columns existed —
-- see users.email_verified_at above for why this can't just be part of the
-- CREATE TABLE IF NOT EXISTS above.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance DOUBLE PRECISION;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS available_balance DOUBLE PRECISION;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance_synced_at TEXT;

-- Category names are unique per user, not globally — two different users
-- both wanting a "Groceries" category must not collide.
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name ON categories (user_id, name);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,              -- Enable Banking transaction_id/entry_reference, csv-import-derived hash, or generated uuid
  user_id TEXT REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  booking_date TEXT NOT NULL,       -- ISO date
  amount DOUBLE PRECISION NOT NULL, -- negative = outflow, positive = inflow
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT,
  counterparty TEXT,
  source TEXT NOT NULL DEFAULT 'manual', -- enablebanking | manual | csv
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
  UNIQUE (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_date
  ON transactions (account_id, booking_date);

CREATE INDEX IF NOT EXISTS idx_transactions_category
  ON transactions (category_id);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id);

-- One monthly spending limit per category. "Spent this month" is computed
-- at query time from transactions, not stored — it always reflects the
-- current calendar month, matching how the rest of the app treats "this
-- month" (no historical budget-period tracking yet). One budget per
-- (user, category).
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  monthly_limit DOUBLE PRECISION NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_user_category ON budgets (user_id, category_id);

-- A debt/loan balance being paid down. Payoff time is computed client-side
-- from balance/apr/minimum_payment via standard amortization math — not
-- stored, since it's a projection that changes as balance changes.
CREATE TABLE IF NOT EXISTS debts (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  balance DOUBLE PRECISION NOT NULL,
  apr DOUBLE PRECISION NOT NULL DEFAULT 0, -- annual percentage rate, e.g. 19.99 for 19.99%
  minimum_payment DOUBLE PRECISION NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

-- A savings goal with manually-tracked progress (not linked to a specific
-- account balance, since a goal like "vacation fund" is often notional
-- rather than a literal separate account).
CREATE TABLE IF NOT EXISTS savings_goals (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  target_amount DOUBLE PRECISION NOT NULL,
  current_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  target_date TEXT,                  -- nullable ISO date
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);
