# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A local personal expense tracker. Transactions arrive three ways: automatically
via open banking (Enable Banking), manual entry through the UI, or CSV import
for banks Enable Banking doesn't cover.

Originally built against GoCardless Bank Account Data; switched to Enable
Banking after GoCardless closed new signups (see
`https://bankaccountdata.gocardless.com/new-signups-disabled`). If you see
references to GoCardless anywhere outside this history note, they're stale.

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

Requires Node.js >=22.5 and a `.env` file (copy `.env.example`) with
`ENABLE_BANKING_APP_ID` and `ENABLE_BANKING_PRIVATE_KEY_PATH` — see the
comments in `.env.example` for the self-serve signup + certificate steps
(no billing, free sandbox with a mock bank). Without real credentials,
manual entry and CSV import still work; only the bank-link flow needs them.

## Architecture

**`server/`** — Express 5 + TypeScript API, SQLite via Node's built-in
`node:sqlite` (`DatabaseSync`) — chosen specifically to avoid a native
node-gyp build step (no `better-sqlite3`), since that requires a working
Python + native toolchain that isn't guaranteed to be set up. `node:sqlite`
has no `db.transaction()` helper like better-sqlite3 does, so
`src/db/client.ts` exports a `withTransaction()` wrapper (manual
BEGIN/COMMIT/ROLLBACK) used anywhere multiple inserts need to be atomic
(CSV import, Enable Banking transaction sync).

Deliberately on Express 5, not 4: Express 4 doesn't catch rejected promises
thrown inside `async (req, res) =>` route handlers, so an unhandled
rejection there crashes the whole Node process — not just that request. All
the Enable Banking routes are async and call an external API that can
reject (e.g. missing/invalid credentials), so this isn't hypothetical.
Express 5 forwards those rejections to the error-handling middleware in
`src/index.ts` automatically, turning a process crash into a normal 500
response.

- `src/db/schema.sql` — table definitions, applied automatically on startup
  by `src/db/client.ts` (`db.exec(schema)` runs every boot; all DDL uses
  `CREATE TABLE IF NOT EXISTS`, so it's safe to re-run).
- `src/services/enableBanking.ts` — the only place that talks to the Enable
  Banking API. Auth is a locally-signed short-lived RS256 JWT (`kid` =
  `ENABLE_BANKING_APP_ID`, signed with the private key at
  `ENABLE_BANKING_PRIVATE_KEY_PATH`) sent as a bearer token on every
  request — there's no token endpoint/network round trip like OAuth
  client-credentials flows, so nothing needs caching.
- `src/routes/bankLink.ts` — the open banking flow. Unlike a requisition
  ID from a single "create link" call, Enable Banking identifies a bank by
  a `(name, country)` pair and returns `code`/`state` directly in the
  redirect query string, so the flow is simpler than the GoCardless one it
  replaced:
  1. `POST /api/bank-link/authorize` generates our own `state` UUID,
     records a `pending` row in `bank_connections` keyed on it, and asks
     Enable Banking for an authorization URL.
  2. The user authorizes at their bank (or, in sandbox, at Mock ASPSP) and
     is redirected to `ENABLE_BANKING_REDIRECT_URL` with `?code=&state=`
     in the query string. The client's `BankLinkCallback.tsx` (mounted at
     `/bank-link/callback`) reads those directly off the URL — no
     localStorage relay needed, unlike the previous provider.
  3. `POST /api/bank-link/sessions` exchanges the code for a session,
     looks up the pending `bank_connections` row by `state`, and inserts
     the linked accounts.
  4. `POST /api/bank-link/accounts/:accountId/sync` pulls transactions
     (paginated via `continuation_key`) and upserts them. Enable Banking
     reports amount as unsigned + a `credit_debit_indicator`
     (`CRDT`/`DBIT`); `signedAmount()` in `bankLink.ts` converts that to
     this app's negative-is-outflow convention.
- `src/routes/importCsv.ts` — CSV rows are content-hashed (`sha256` of
  account+date+amount+description) to derive the transaction `id`, so
  re-importing the same file is a no-op via `INSERT OR IGNORE` instead of
  creating duplicates. Enable Banking transactions dedupe the same way,
  preferring the provider's `transaction_id`/`entry_reference` and falling
  back to a content hash if neither is present.
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

Four pages under `src/pages/`: `Dashboard` (aggregate totals), `Transactions`
(manual entry form + CSV import + category management + table, all backed by
the same `refresh()` callback pattern), `BankLink` (institution search →
Enable Banking redirect), `BankLinkCallback` (finishes the link and triggers
the first sync — see the bankLink.ts flow above).

## Data model

- `bank_connections` — one row per Enable Banking authorization (keyed on
  our own generated `state` UUID, since there's no single provider-issued
  ID to key off before the user has even authorized).
- `accounts` — either linked via `bank_connection_id` (source =
  `enablebanking`) or created manually (source = `manual`). Account `id` is
  the Enable Banking account `uid` when synced, otherwise a generated UUID.
- `transactions.amount` — negative is outflow, positive is inflow, no
  separate sign/type column.
- `transactions.source` is one of `enablebanking` | `manual` | `csv` and
  determines both the `id` derivation strategy and whether the row is
  user-deletable (see above).
