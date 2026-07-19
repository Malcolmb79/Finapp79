# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A local personal expense tracker. Transactions arrive three ways: automatically
via open banking (GoCardless Bank Account Data), manual entry through the UI,
or CSV import for banks GoCardless doesn't cover.

## Commands

Run from the repo root (npm workspaces: `server`, `client`).

- `npm install` — install all workspace dependencies
- `npm run dev` — run API (port 3001) and client (port 5173) together
- `npm run dev:server` / `npm run dev:client` — run just one side
- `npm run build` — build both workspaces
- `npm run typecheck` — typecheck both workspaces
- `npm run lint` — lint both workspaces
- `npm run test` — run server tests (vitest)
  - Single test file: `npm run test --workspace server -- path/to/file.test.ts`

Requires Node.js >=22.5 and a `.env` file (copy `.env.example`) with GoCardless
`GOCARDLESS_SECRET_ID` / `GOCARDLESS_SECRET_KEY` — get a free sandbox account
at https://bankaccountdata.gocardless.com/. Without real credentials, manual
entry and CSV import still work; only the bank-link flow needs them.

## Architecture

**`server/`** — Express + TypeScript API, SQLite via Node's built-in
`node:sqlite` (`DatabaseSync`) — chosen specifically to avoid a native
node-gyp build step (no `better-sqlite3`), since that requires a working
Python + native toolchain that isn't guaranteed to be set up. `node:sqlite`
has no `db.transaction()` helper like better-sqlite3 does, so
`src/db/client.ts` exports a `withTransaction()` wrapper (manual
BEGIN/COMMIT/ROLLBACK) used anywhere multiple inserts need to be atomic
(CSV import, GoCardless transaction sync).

- `src/db/schema.sql` — table definitions, applied automatically on startup
  by `src/db/client.ts` (`db.exec(schema)` runs every boot; all DDL uses
  `CREATE TABLE IF NOT EXISTS`, so it's safe to re-run).
- `src/services/gocardless.ts` — the only place that talks to the GoCardless
  API. Handles token caching/refresh internally; callers just call functions
  like `createRequisition`, `getAccountTransactions`.
- `src/routes/bankLink.ts` — the three-step open banking flow:
  1. `POST /api/bank-link/requisitions` creates a GoCardless requisition and
     returns an authorization URL to redirect the user to.
  2. After the user authorizes at their bank and is redirected back,
     `POST /api/bank-link/requisitions/:id/complete` resolves the linked
     accounts and inserts rows into `accounts`.
  3. `POST /api/bank-link/accounts/:accountId/sync` pulls transactions for a
     linked account and upserts them into `transactions`.
- `src/routes/importCsv.ts` — CSV rows are content-hashed (`sha256` of
  account+date+amount+description) to derive the transaction `id`, so
  re-importing the same file is a no-op via `INSERT OR IGNORE` instead of
  creating duplicates. GoCardless-synced transactions dedupe the same way,
  keyed on the provider's own `transactionId`.
- Manual transactions (`source = 'manual'`) are the only ones that can be
  deleted (`DELETE /api/transactions/:id` filters on `source = 'manual'`) —
  synced and imported transactions are meant to stay in sync with their
  origin instead of being hand-edited away.
- `PATCH /api/transactions/:id` only touches fields actually present in the
  request body (checked via `"field" in req.body`), not just truthy ones —
  needed so a category can be explicitly cleared back to `null`
  (uncategorized) rather than that being indistinguishable from "field
  omitted, leave it alone."

**`client/`** — React + TypeScript, Vite, React Router. Dev server proxies
`/api/*` to the Express server (see `vite.config.ts`), so client code always
calls relative paths through `src/api/client.ts` — never hardcode the API
origin.

Three pages under `src/pages/`: `Dashboard` (aggregate totals), `Transactions`
(manual entry form + CSV import + category management + table, all backed by
the same `refresh()` callback pattern), `BankLink` (institution search →
GoCardless redirect). Categories are flat with an optional `parent_id` for
subcategories, but there's no UI yet for picking a parent when creating one.

## Data model

- `bank_connections` — one row per GoCardless requisition (a bank
  authorization session).
- `accounts` — either linked via `bank_connection_id` (source = `gocardless`)
  or created manually (source = `manual`). Account `id` is the GoCardless
  account id when synced, otherwise a generated UUID.
- `transactions.amount` — negative is outflow, positive is inflow, no
  separate sign/type column.
- `transactions.source` is one of `gocardless` | `manual` | `csv` and
  determines both the `id` derivation strategy and whether the row is
  user-deletable (see above).
