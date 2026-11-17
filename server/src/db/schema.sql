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

-- Passkeys (WebAuthn credentials). One row per registered authenticator.
--
-- None of this is secret: a public key and a counter cannot be used to sign
-- in, because the private half never leaves the device. What matters is that
-- the row is bound to the right user and that `counter` only ever moves
-- forward — a counter that goes backwards is the signal that a credential has
-- been cloned.
--
-- `id` is the authenticator's own base64url credential ID and is globally
-- unique, so it is the primary key and the sign-in lookup is by id alone. That
-- is the one query here not scoped by user_id, and necessarily so: at sign-in
-- there is no session yet to say who is asking. The row then names the user.
CREATE TABLE IF NOT EXISTS passkey_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key TEXT NOT NULL,          -- base64url COSE key
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT,                   -- JSON array as WebAuthn reports it, e.g. ["internal","hybrid"]
  label TEXT NOT NULL,               -- so a lost device can be told apart and removed
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user ON passkey_credentials (user_id);

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

-- An arranged overdraft: how far below zero the account may go. Kept apart
-- from balance because it is a borrowing facility, not money held — it
-- belongs in "available to spend" but never in net worth.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS overdraft_limit DOUBLE PRECISION;

-- Set when a balance was entered by hand rather than synced from a bank, so
-- a manual figure is recognisable as one and a later sync can be told apart
-- from it.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance_is_manual BOOLEAN NOT NULL DEFAULT FALSE;

-- current | savings | credit_card | loan. What the account *is*, which the
-- balance alone can't say: a credit card and a current account both sit at
-- -1,200 in completely different senses. Two things follow from it — money
-- owed is entered as a positive figure and stored negative, and a facility
-- is an overdraft on a current account but a credit limit on a card.
-- Defaults to 'current' because that is what every account predating this
-- column was assumed to be.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'current';

-- What the bank last reported, kept even when a hand-set balance is the one
-- being used. Without it a manual figure silently outranks every later sync
-- with no way to see the two disagree, let alone hand the account back.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS synced_balance DOUBLE PRECISION;

-- Kept off every total without being deleted: a closed account, a joint
-- account someone else tracks, an account being wound down. Hiding rather
-- than removing keeps its history intact and reversible, which deletion
-- isn't.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- An account's own branding, as opposed to its bank connection's. A linked
-- account inherits both from bank_connections, but a manual account has no
-- connection to inherit from — these are where a bank matched by name (from a
-- statement import or the detect-bank action) gets recorded. Without them
-- that match had nowhere to go.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS logo TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS institution_name TEXT;

-- Terms of a loan, read from its agreement (see services/loanContract.ts).
-- They live on the account rather than in a separate table because they
-- describe the account itself, the way overdraft_limit does — and a loan
-- account without them still works, it just can't say when it will be paid
-- off. loan_rate is an annual percentage (11.5 means 11.5%).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_principal DOUBLE PRECISION;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_monthly_payment DOUBLE PRECISION;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_rate DOUBLE PRECISION;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_start_date TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_end_date TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_term_months INTEGER;

-- Category names are unique per user, not globally — two different users
-- both wanting a "Groceries" category must not collide.
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name ON categories (user_id, name);

-- Whether money filed here is regular income the forecast can count on.
--
-- Declared rather than inferred, and that is the point. Income was only ever
-- found by pattern — three credits of a consistent amount at a consistent
-- spacing — so a salary that has just started, changed, or comes from more
-- than one place is invisible, and the balance projection shows a household
-- whose money only ever goes down. Waiting three months to be believed is a
-- poor answer when the owner knows on day one.
--
-- A flag on the category rather than a table of declared incomes: the owner
-- is already filing the salary somewhere, so this asks nothing new of them,
-- and it stays right when the employer, amount or pay date changes.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS counts_as_income BOOLEAN NOT NULL DEFAULT FALSE;

-- Whether that income arrives on no schedule at all: a tax refund, a bonus,
-- something sold.
--
-- It is income and every total should say so, but the forecast must not draw
-- it forward. A refund marked as regular income is a line that climbs by the
-- refund every month from now on, which is money the household does not have
-- and would plan against. Dropping such a payment from income entirely has
-- the opposite fault: the month it lands reads as a windfall nobody can
-- explain, and the savings rate for the year is wrong.
--
-- So it is a second flag rather than a third value of the first: occasional
-- income is still income, and only the projection treats it differently.
-- Meaningful only where counts_as_income is set, and cleared with it.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS income_is_occasional BOOLEAN NOT NULL DEFAULT FALSE;

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
  reviewed_at TEXT,                 -- null = pending review; set when the user approves the transaction
  UNIQUE (account_id, id)
);

-- Same live-database problem as users.email_verified_at above, with a
-- twist: existing rows must NOT suddenly become "pending" (that would
-- empty every dashboard/budget/analytics total until manually re-reviewed).
-- The volatile default backfills every pre-existing row as already-reviewed
-- at ALTER time — but in Postgres, ADD COLUMN ... DEFAULT also leaves that
-- default permanently attached to the column, so every *future* INSERT
-- that omits reviewed_at (manual create, CSV import, Enable Banking sync —
-- all three) would silently get "reviewed" instead of "pending". The
-- DROP DEFAULT right after undoes that: the backfill above already ran
-- once, and dropping a default that isn't there (fresh DBs, or subsequent
-- boots) is a harmless no-op either way.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reviewed_at TEXT DEFAULT (now() AT TIME ZONE 'utc')::text;
ALTER TABLE transactions ALTER COLUMN reviewed_at DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_transactions_account_date
  ON transactions (account_id, booking_date);

CREATE INDEX IF NOT EXISTS idx_transactions_category
  ON transactions (category_id);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_reviewed ON transactions (user_id, reviewed_at);

-- Merchant -> category guesses from the AI categoriser (see
-- services/aiCategorySuggestion.ts), cached so an unfamiliar merchant costs
-- one model call ever rather than one per pending-list fetch. match_key is
-- the same lowercased counterparty/description that categorySuggestion.ts
-- matches on, so both sources agree on what counts as "the same merchant".
-- A NULL category_id is a cached miss — a merchant the model couldn't place,
-- recorded so it isn't re-sent on every refresh.
CREATE TABLE IF NOT EXISTS ai_category_cache (
  user_id TEXT NOT NULL REFERENCES users(id),
  match_key TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
  PRIMARY KEY (user_id, match_key)
);

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

-- A household can hold money in more than one currency, and a budget set in
-- one says nothing about the other: GBP 150 of groceries and EUR 150 of
-- groceries are two separate caps against two separate sets of transactions.
-- Converting them into one would be worse than useless here, because the
-- question "have I gone over" is asked of each account's own currency, in the
-- country whose prices it pays.
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';

-- The old index allowed one budget per category, full stop. Dropping it is
-- what lets the same category hold a cap in each currency; the replacement
-- still stops two budgets for the same category in the SAME currency.
DROP INDEX IF EXISTS idx_budgets_user_category;
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_user_category_currency
  ON budgets (user_id, category_id, currency);

-- What was put into a category for one particular month.
--
-- `budgets.monthly_limit` above is a standing cap: the same number every
-- month, answering "have I gone over". That suits a bill and suits nothing
-- else. The categories people struggle with are the lumpy ones -- car
-- repairs, clothes, presents -- where the question is not "did I overspend in
-- March" but "how much is there for this, now, given the last few months".
--
-- Answering that needs a figure per month rather than one per category, and
-- a balance that carries: what is left stays in the envelope, and an
-- overspend carries as a debt against the next month. See
-- client/src/utils/envelope.ts for the arithmetic.
--
-- Kept beside `budgets` rather than replacing it. The standing cap still
-- drives the existing budget widgets, and a row here is an override for one
-- month -- so an account that has never touched this is unaffected, and
-- nothing has to be migrated.
CREATE TABLE IF NOT EXISTS budget_allocations (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  month TEXT NOT NULL,              -- YYYY-MM
  amount DOUBLE PRECISION NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

-- One figure per category per month: assigning again replaces, rather than
-- adding a second row that would silently double the envelope.
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_allocations_unique
  ON budget_allocations (user_id, category_id, month);

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

-- A life insurance policy, read from its statement (see
-- services/policyDocument.ts). Deliberately not an `accounts` row with a new
-- account_type: a policy has no transactions, no IBAN and no bank connection,
-- so folding it in would offer it as a transaction target in every account
-- dropdown, in the statement importer, in the account filter and in the debt
-- planner — a lot of places to then suppress it again.
--
-- The two money columns are the point of the table, and they are not
-- interchangeable:
--
--   cover_amount is the sum assured — what pays out on death. It is not money
--   held, and no arrangement of this app's totals should ever treat it as
--   such by default.
--
--   surrender_value is what the policy is worth if cashed in today. That is
--   an asset, and it is the figure a policy normally contributes to net
--   worth. A term policy has none, and null is the honest answer there.
--
-- net_worth_source names which of the two (if either) counts, per policy. It
-- defaults to 'none' so a policy never enters a total until it is asked to —
-- there is no safe figure to guess with, and a wrong net worth reads exactly
-- like a right one.
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,               -- generated uuid
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  insurer TEXT,
  policy_number TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  cover_amount DOUBLE PRECISION,     -- sum assured: protection, never wealth
  surrender_value DOUBLE PRECISION,  -- cash/fund value: the asset figure
  valued_at TEXT,                    -- the statement date those figures were true on
  premium DOUBLE PRECISION,
  premium_frequency TEXT,            -- monthly | quarterly | annual
  start_date TEXT,
  maturity_date TEXT,
  net_worth_source TEXT NOT NULL DEFAULT 'none', -- none | surrender | cover
  extract_json TEXT,                 -- the confirmed extraction, quotes included
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

CREATE INDEX IF NOT EXISTS idx_policies_user ON policies (user_id);

-- One row per confirmed statement import. Without it a re-upload silently
-- overwrites the previous figure, and there is no way to see the value move
-- between statements or to notice that a newly read figure disagrees wildly
-- with the last one. It is also what keeps the net worth trend honest: a
-- policy contributes from its earliest valuation onwards rather than being
-- projected backwards over history it wasn't held for.
CREATE TABLE IF NOT EXISTS policy_valuations (
  id TEXT PRIMARY KEY,               -- generated uuid
  user_id TEXT REFERENCES users(id),
  policy_id TEXT NOT NULL REFERENCES policies(id),
  valued_at TEXT NOT NULL,
  cover_amount DOUBLE PRECISION,
  surrender_value DOUBLE PRECISION,
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

CREATE INDEX IF NOT EXISTS idx_policy_valuations_policy ON policy_valuations (policy_id, valued_at);

-- A savings goal with manually-tracked progress (not linked to a specific
-- account balance, since a goal like "vacation fund" is often notional
-- rather than a literal separate account).
-- A pair of transactions somebody has looked at and said are two payments,
-- not one stored twice.
--
-- Without this the duplicate screen is a treadmill: the same pair is flagged,
-- judged, and flagged again on the next visit, because the thing that makes
-- them look alike - one account, one day, one amount - never changes. Two
-- coffees at the same price stay two coffees forever.
--
-- Keyed on the pair rather than on either row, and ordered so that the same
-- two ids always produce the same key whichever way round they arrive.
CREATE TABLE IF NOT EXISTS duplicate_dismissals (
  user_id TEXT REFERENCES users(id),
  a_id TEXT NOT NULL,
  b_id TEXT NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_duplicate_dismissals_pair
  ON duplicate_dismissals (user_id, a_id, b_id);

CREATE TABLE IF NOT EXISTS savings_goals (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  target_amount DOUBLE PRECISION NOT NULL,
  current_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  target_date TEXT,                  -- nullable ISO date
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

-- A standing instruction for what a transaction means, matched on its text.
--
-- A personal loan is repaid by a direct debit that lands on whichever account
-- funds it — the An Post loan's €383.87 appears on AIB, the sterling ones on
-- Barclays — and nothing at all appears on the loan. So the loan's balance sat
-- frozen at whatever was last typed in while the payments went out month after
-- month.
--
-- A rule is the durable answer rather than tagging each payment as it arrives:
-- it is written once and every future payment is attributed by it. Matching on
-- text scoped to one account is what makes it safe — "AN POST" on AIB is the
-- loan, and the same words on a different account are not.
--
-- No amount in the rule on purpose. Repayments change when a rate moves or a
-- loan is settled early, and a rule pinned to €383.87 would silently stop
-- matching at exactly the moment the figure mattered most.
CREATE TABLE IF NOT EXISTS transaction_rules (
  id TEXT PRIMARY KEY,               -- generated uuid
  user_id TEXT REFERENCES users(id),
  match_text TEXT NOT NULL,          -- case-insensitive substring of description/counterparty
  match_account_id TEXT REFERENCES accounts(id),  -- null = any account
  repays_account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

CREATE INDEX IF NOT EXISTS idx_transaction_rules_user ON transaction_rules (user_id);

-- The second thing a rule can say: file this merchant here, always.
-- Separate from repays_account_id rather than one "action" column, because a
-- rule can honestly do both -- an An Post direct debit repays the loan AND
-- belongs under Loan repayments -- and a single action would force a choice
-- that does not exist.
--
-- The table shipped a few hours before this column, so it is an ALTER for the
-- same reason as users.email_verified_at above: a CREATE TABLE IF NOT EXISTS
-- is a no-op against a table that already exists without it.
ALTER TABLE transaction_rules ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id);

-- A rule with neither action does nothing at all, which is a rule nobody
-- meant to write. The routes refuse one; this is the backstop.
ALTER TABLE transaction_rules ALTER COLUMN repays_account_id DROP NOT NULL;

-- When the schedule last reached this account, and what went wrong if
-- anything did. An expired bank authorisation (they lapse after roughly 90
-- days) is the common failure, and without somewhere to record it the account
-- simply stops updating -- which looks exactly like an account with nothing
-- happening on it.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_sync_at TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

-- One payment across several categories.
--
-- A correctness gap rather than a convenience: a supermarket shop that is
-- half groceries and half a birthday present has no honest single category,
-- and until now the choice was to file it wrong or leave it unfiled. Both put
-- a figure in a budget that is not true.
--
-- The parent transaction keeps its own amount and category untouched. A split
-- is a second, finer reading of the same money, and every total that works by
-- category reads the splits where they exist and the parent where they do
-- not — see categorySlices. Keeping the parent intact is what makes a split
-- undoable: delete the rows and the transaction is exactly what it was.
--
-- No constraint that the parts sum to the whole, because the route enforces it
-- and a half-entered split should fail with a sentence rather than a
-- constraint violation. ON DELETE CASCADE because a split of a deleted
-- transaction is not a record of anything.
CREATE TABLE IF NOT EXISTS transaction_splits (
  id TEXT PRIMARY KEY,               -- generated uuid
  user_id TEXT REFERENCES users(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id),
  amount DOUBLE PRECISION NOT NULL,  -- same sign convention as the parent
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_transaction_splits_tx ON transaction_splits (transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_splits_user ON transaction_splits (user_id);

-- When the bank's authorisation lapses.
--
-- Ninety days is the regulatory ceiling and the app asks for all of it, so
-- every linked bank stops answering roughly a quarter after it was linked.
-- Until this column existed nothing recorded that date and nothing noticed it
-- passing: the account simply stopped updating, which is indistinguishable
-- from an account with nothing happening on it. One did exactly that for a
-- week before anybody asked why.
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS valid_until TEXT;

-- An investment holding: shares, funds, crypto, anything with a quantity and
-- a price.
--
-- Kept apart from `accounts` for the same reason policies are: a holding has
-- no transactions and no IBAN, and folding it in would offer it as a
-- transaction target in every account dropdown and the statement importer.
--
-- Quantity and price are separate columns rather than one value, because the
-- two move for different reasons and only the split tells you which happened.
-- A holding worth 20% more because the price rose is a different fact from
-- one worth 20% more because more was bought, and a single value column
-- cannot tell them apart.
CREATE TABLE IF NOT EXISTS holdings (
  id TEXT PRIMARY KEY,               -- generated uuid
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  ticker TEXT,                       -- optional; a fund may have none worth typing
  kind TEXT NOT NULL DEFAULT 'equity', -- equity | fund | bond | crypto | other
  quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- What it cost, per unit, in the holding's own currency. The basis for
  -- gain/loss, and never overwritten by a price update.
  unit_cost DOUBLE PRECISION,
  currency TEXT NOT NULL DEFAULT 'EUR',
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings (user_id);

-- One row per price ever recorded, not a single current price.
--
-- Same reasoning as policy_valuations: keeping the history is what lets the
-- net worth trend show a holding from the first price onward, instead of
-- projecting today's price back across months it was worth something else.
CREATE TABLE IF NOT EXISTS holding_prices (
  id TEXT PRIMARY KEY,               -- generated uuid
  user_id TEXT REFERENCES users(id),
  holding_id TEXT NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  priced_at TEXT NOT NULL,           -- ISO date
  unit_price DOUBLE PRECISION NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

CREATE INDEX IF NOT EXISTS idx_holding_prices_holding ON holding_prices (holding_id, priced_at);

-- One person letting another see their finances.
--
-- A household shares a picture, so a share is all-or-nothing rather than
-- per-account: "what can my partner see" answered account by account is a
-- permissions system, and a permissions system in a two-person app is a
-- maintenance burden nobody asked for.
--
-- `role` is the one distinction worth keeping. A viewer can read everything
-- and change nothing, which is the right answer for an accountant, a parent
-- helping out, or anyone you want to show rather than hand over.
--
-- Invites are by email and carry only the SHA-256 hash of their token, the
-- same reasoning as password resets in tokens.ts: a database leak must not
-- become a working invite into somebody's bank data.
CREATE TABLE IF NOT EXISTS household_shares (
  id TEXT PRIMARY KEY,               -- generated uuid
  -- Whose data is being shared. Not named user_id on purpose: every other
  -- table in this schema uses that for "whose row is this", and conflating
  -- the two here is exactly the mistake that leaks data.
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  -- Who it is shared with. Null until the invite is accepted.
  member_user_id TEXT REFERENCES users(id),
  invited_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',   -- viewer | editor
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | revoked
  token_hash TEXT,                   -- SHA-256 of the invite token; cleared on accept
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
  accepted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_household_shares_owner ON household_shares (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_household_shares_member ON household_shares (member_user_id);

-- Property held as an investment or lived in.
--
-- Kept out of `accounts` for the reason policies are: a property has no
-- transactions, no IBAN and no bank connection, so folding it in would offer a
-- house as a transaction target in every account dropdown, the statement
-- importer, the account filter and the debt planner.
--
-- The mortgage lives here as a plain balance rather than as a link to a loan
-- account, and that is a deliberate limitation rather than an oversight: a
-- household that already tracks its mortgage as a loan account would otherwise
-- have the same debt counted twice. `net_worth_source` is what resolves it —
-- same mechanism as a policy's, and defaulting the same way, to `none`. A
-- property is in no total until asked in.
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,                    -- generated uuid
  user_id TEXT REFERENCES users(id),
  address TEXT NOT NULL,
  property_type TEXT NOT NULL DEFAULT 'rental', -- residence | rental | multi_family | commercial | land
  currency TEXT NOT NULL DEFAULT 'EUR',
  purchase_price DOUBLE PRECISION,
  purchase_date TEXT,
  market_value DOUBLE PRECISION,          -- what it is worth now, which is the figure every metric uses
  mortgage_balance DOUBLE PRECISION,      -- outstanding principal, stored positive
  mortgage_payment DOUBLE PRECISION,      -- per month: the debt service a DSCR is measured against
  monthly_rent DOUBLE PRECISION,          -- gross, before vacancy
  monthly_expenses DOUBLE PRECISION,      -- operating only: rates, insurance, maintenance, management
  vacancy_rate DOUBLE PRECISION,          -- percentage: 5 means five per cent of the year empty
  -- none | equity | value. Equity is the usual answer; value is for a property
  -- whose mortgage is already tracked as a loan account, where counting the
  -- equity would subtract that debt a second time.
  net_worth_source TEXT NOT NULL DEFAULT 'none',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

CREATE INDEX IF NOT EXISTS idx_properties_user ON properties (user_id);

-- A buy-to-let deal being appraised, which is not the same thing as a property
-- owned (`properties`). A deal is a candidate: a price somebody might pay, a
-- rent they think they would get, and a structure they have not committed to.
-- Most of them are never bought, and the ones that are become a `properties`
-- row with a different set of facts behind it.
--
-- Kept as its own table rather than as draft properties for that reason: a
-- half-modelled purchase has no equity, no tenancy and no mortgage, and
-- letting it into `properties` would put candidates into net worth.
CREATE TABLE IF NOT EXISTS btl_deals (
  id TEXT PRIMARY KEY,                    -- generated uuid
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  address TEXT,
  notes TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',

  purchase_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  ltv DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  mortgage_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  interest_only BOOLEAN NOT NULL DEFAULT FALSE,
  term_years DOUBLE PRECISION NOT NULL DEFAULT 25,
  arrangement_fees DOUBLE PRECISION NOT NULL DEFAULT 0,
  purchase_fees DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- Three or more apartments in one block stop at the 2% stamp duty band.
  apartment_block BOOLEAN NOT NULL DEFAULT FALSE,
  -- Ten or more units inside twelve months: 15% on the whole price (s31E).
  bulk_purchase BOOLEAN NOT NULL DEFAULT FALSE,

  refurb_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  value_after_works DOUBLE PRECISION NOT NULL DEFAULT 0,
  furnishings_cost DOUBLE PRECISION NOT NULL DEFAULT 0,

  units INTEGER NOT NULL DEFAULT 1,
  rent_per_unit DOUBLE PRECISION NOT NULL DEFAULT 0,
  vacancy_rate DOUBLE PRECISION NOT NULL DEFAULT 5,

  management_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  lpt_annual DOUBLE PRECISION NOT NULL DEFAULT 0,
  insurance_monthly DOUBLE PRECISION NOT NULL DEFAULT 0,
  maintenance_monthly DOUBLE PRECISION NOT NULL DEFAULT 0,
  service_charge_monthly DOUBLE PRECISION NOT NULL DEFAULT 0,
  rtb_fee_annual DOUBLE PRECISION NOT NULL DEFAULT 0,
  other_monthly DOUBLE PRECISION NOT NULL DEFAULT 0,

  ownership TEXT NOT NULL DEFAULT 'personal',   -- personal | company
  marginal_rate DOUBLE PRECISION NOT NULL DEFAULT 0.4,
  retained_share DOUBLE PRECISION NOT NULL DEFAULT 1,
  rtb_registered BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

CREATE INDEX IF NOT EXISTS idx_btl_deals_user ON btl_deals (user_id);

-- A note or a thing to do, pinned to the dashboard.
--
-- Deliberately not a task manager. It exists because the things somebody
-- means to do about their money ("cancel the gym", "chase the deposit",
-- "move 500 to savings before the 28th") are the one part of a review that
-- has nowhere to live — they end up in a phone note that is never beside the
-- figures that prompted them.
--
-- `done_at` rather than a boolean: a thing ticked off yesterday and a thing
-- ticked off in March read differently, and a list that cannot tell them
-- apart has to clear itself to stay useful.
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,                    -- generated uuid
  user_id TEXT REFERENCES users(id),
  body TEXT NOT NULL,
  done_at TEXT,                           -- null = still outstanding
  -- Hand-ordered, so the thing that matters can be dragged to the top.
  -- Sparse on purpose: reordering one row should not rewrite every other.
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON notes (user_id, position);

-- Whether money filed here is a movement between the household's own accounts
-- rather than income or spending.
--
-- A transfer is two real transactions describing one event: money leaves the
-- current account and the same money arrives in the savings account. Counted
-- naively, that single event adds to income *and* to spending, so a household
-- moving 2,000 to savings every month reports 2,000 more earned and 2,000
-- more spent than actually happened — and a savings rate computed from those
-- two figures is wrong in both the numerator and the denominator.
--
-- The same reasoning the app already applies to a loan repayment, which is
-- also one event wearing two faces. That one is derived from a rule; this one
-- is declared on the category, because only the owner knows that "Inward
-- SWIFT" is their own money arriving from elsewhere rather than a client
-- paying an invoice.
--
-- A flag on the category rather than a pairing table: somebody filing these
-- as "Transfers" has already done the work, and asking them to additionally
-- match each out to each in would be asking twice. See services/transferPairs
-- for the matching, which is offered as a check rather than required.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_transfer BOOLEAN NOT NULL DEFAULT FALSE;

-- A subscription somebody has looked at and said is still wanted.
--
-- The standing commitments card answers what you pay; it cannot answer what
-- you have actually decided about. A subscription nobody questions is the
-- whole failure mode of subscriptions — the charge is small enough that no
-- month ever forces the issue, and the only thing that would surface it is
-- noticing you have not thought about it since the year before last. So the
-- useful fact is not the amount, which the card already has, but the date you
-- last looked.
--
-- Keyed on the merchant key rather than on a transaction: the thing being
-- reviewed is the arrangement, which outlives any one charge, and next
-- month's charge is a different row with the same answer. That key is derived
-- client-side by `merchantKey()` and stored here verbatim, so the two have to
-- agree — see the note on `label` for what happens when they stop.
--
-- `label` is what it was called when it was reviewed, and nothing matches on
-- it. It is there so a row remains identifiable to a human after the fact:
-- a merchant key is a stripped, lowercased fragment, and a review whose
-- transactions have since gone would otherwise be a row saying only
-- "direct debit to". Such a row matches nothing and shows nowhere, which is
-- the right outcome — the subscription it was about has stopped.
CREATE TABLE IF NOT EXISTS subscription_reviews (
  id TEXT PRIMARY KEY,               -- generated uuid
  user_id TEXT REFERENCES users(id),
  merchant_key TEXT NOT NULL,        -- merchantKey() of the recurring payment
  label TEXT NOT NULL,
  reviewed_at TEXT,                  -- ISO date it was last confirmed as wanted
  created_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_reviews_user_merchant
  ON subscription_reviews (user_id, merchant_key);

-- This table briefly also carried `cancelling_at`, for marking a subscription
-- as on its way out and watching whether the charges actually stopped. It was
-- dropped at the owner's request: one date is the whole of what this page is
-- for, and a second state to maintain is a second thing to keep honest.
--
-- Dropped rather than left in place unused, because a column nothing writes
-- is a column the next reader has to work out the status of — and a database
-- created after this change would not have had it at all, so leaving it would
-- mean two different shapes of the same table depending on when it was made.
-- Only ever held a value set by the feature being removed.
ALTER TABLE subscription_reviews DROP COLUMN IF EXISTS cancelling_at;

-- Whether money filed here is a subscription.
--
-- Declared, like every other thing this app knows about a category, and for
-- the reason the last three attempts at this failed: a subscription is not a
-- shape in the data. The detector that finds payments coming back on a rhythm
-- for a consistent amount finds a loan instalment, a life premium, a phone
-- bill and the bins, because all of those are exactly that shape — and no
-- refinement of it will ever separate "something I signed up to and could
-- stop" from "something I owe every month", because the difference is not in
-- the transactions. It is in what the household means by them.
--
-- So the subscriptions page lists what is tagged here and nothing else. The
-- cadence, the annual cost and the price rises are still worked out from the
-- charges — that is description, which the data can support. Membership is a
-- decision, which it cannot.
--
-- A flag on the category rather than on each transaction: filing is already
-- how this app is told what a payment is, and tagging Netflix every month
-- would be asking the same question twelve times a year.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN NOT NULL DEFAULT FALSE;

-- What somebody has read in the bell, and what was true when they read it.
--
-- The alerts are derived from the data rather than stored, which is right:
-- a budget that is over is over whether or not a row says so. But it means
-- they cannot be marked read the way a message can, so every one of them
-- stayed in the bell for as long as the condition lasted. A badge that never
-- goes down is a badge nobody reads.
--
-- The severity is stored with the dismissal, because it is what makes an
-- alert news a second time: a budget dismissed at 91% spent has to come back
-- when it goes over, or reading it once buries the thing it was warning
-- about. And a dismissal is pruned as soon as its alert stops being derived
-- at all, so the condition recurring next month is news again rather than
-- something already marked read.
CREATE TABLE IF NOT EXISTS alert_dismissals (
  user_id TEXT REFERENCES users(id),
  alert_id TEXT NOT NULL,            -- deriveAlerts' own id, e.g. "budget:7"
  severity TEXT NOT NULL,            -- what it was when read: warning | critical
  dismissed_at TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
  PRIMARY KEY (user_id, alert_id)
);
