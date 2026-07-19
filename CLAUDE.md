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

Requires Node.js >=22.5 and a `.env` file (copy `.env.example`). Enable
Banking needs `ENABLE_BANKING_APP_ID` and `ENABLE_BANKING_PRIVATE_KEY_PATH`
— see the comments in `.env.example` for the self-serve signup + certificate
steps (no billing, free sandbox with a mock bank). Sign-in needs at least
one of `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or
`FACEBOOK_CLIENT_ID`/`FACEBOOK_CLIENT_SECRET`, plus `SESSION_SECRET`. None
of these crash the server if missing — the corresponding feature just
degrades (bank-link errors per-request; an unconfigured OAuth provider's
login button redirects to an error instead of you being unable to boot the
app at all) — but without at least one OAuth provider configured, you can't
sign in and the whole app behind `RequireAuth` is unreachable.

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

### Authentication (multi-user, Google/Facebook OAuth)

Every table has a `user_id`, every route is behind `requireAuth`
(`src/middleware/requireAuth.ts`), and every query in every route file is
filtered/scoped by `req.user!.id` — there is no "current user" global;
each route reads it off the authenticated request. If you add a new table
or route, it needs a `user_id` column and `WHERE user_id = ?` on every
query, or one user's data leaks into another's response.

- `src/auth/passport.ts` — registers the Google/Facebook strategies **only
  if their env vars are set** (constructing `passport-google-oauth20`/
  `passport-facebook` with an undefined `clientID` throws immediately,
  which would crash the whole server at boot rather than just leaving that
  login button inert — same "missing config degrades gracefully" principle
  as Enable Banking). `configuredProviders` tracks which ones are live;
  `GET /api/auth/providers` exposes it so the client can gray out buttons
  for providers that aren't set up instead of offering a dead link.
- `src/auth/sessionStore.ts` — a hand-rolled `express-session` Store backed
  by the same SQLite file as everything else, not the default in-memory
  store. That default explicitly warns it's unfit for production and,
  worse for local dev, doesn't survive process restarts — which `tsx
  watch` does constantly. Sessions living in SQLite mean you don't get
  logged out every time a file save triggers a restart.
- `src/db/migrate.ts` — see "Multi-user migration" below. Runs on every
  boot, after `schema.sql`; it's a no-op once the database is already
  migrated.
- `src/auth/findOrCreateUser.ts` — resolves an OAuth callback profile to an
  app user. Three cases, checked in order: (1) this `(provider,
  provider_user_id)` has signed in before, return that user; (2) nobody
  has claimed the pre-auth "legacy" data yet (see migration below) — this
  is the first OAuth login this instance has ever seen, so it claims the
  legacy user rather than creating a new one; (3) otherwise, link to an
  existing user by matching email (so the same person can add a second
  provider), or create a brand new user.

**Multi-user migration** (`src/db/migrate.ts`) exists because this app
started single-user with no `user_id` anywhere, and upgrading it couldn't
be allowed to silently drop existing accounts/transactions/etc. On an
upgrade, every legacy table gets `user_id` backfilled to a fixed
placeholder `"legacy"` user (no email) — `findOrCreateUser` hands that
user's data to whoever completes the very first OAuth login on this
instance, then behaves as normal multi-user isolation for everyone after
that. Two non-obvious things learned building this migration, both still
relevant if you touch it:
  1. **`node:sqlite`'s `ALTER TABLE` does not participate in an explicit
     `BEGIN`/`ROLLBACK`** the way plain DML does — observed directly, a
     failure partway through an earlier version of this migration left
     `ALTER`-added columns in place while an uncommitted `UPDATE` in the
     same transaction rolled back, producing a column that existed but was
     `NULL` everywhere. Because of this, `migrate()` doesn't rely on
     transactional atomicity at all — every step re-checks the *actual*
     database state (via `PRAGMA table_info`/`PRAGMA index_list`, not a
     "have I already run" flag) and is safe to run again from any partial
     state, including ones a crash left behind.
  2. **`categories.name` and `budgets.category_id` needed a full table
     rebuild, not just `DROP INDEX`.** Both had an inline column-level
     `UNIQUE` constraint pre-auth; SQLite implements that as an autoindex
     that *cannot* be dropped with `DROP INDEX` (unlike a constraint added
     via a separate `CREATE INDEX`) — the only way to loosen "globally
     unique" to "unique per user" is rename-recreate-copy-drop, which is
     what `rebuildWithoutLegacyUniqueIndex()` does.

- `src/db/schema.sql` — table definitions, applied automatically on startup
  by `src/db/client.ts` (`db.exec(schema)` runs every boot; all DDL uses
  `CREATE TABLE IF NOT EXISTS`, so it's safe to re-run). The
  `idx_categories_user_name` and `idx_budgets_user_category` unique
  indexes are deliberately *not* here even though they're part of the
  final schema — see the comments on those tables and in `migrate.ts` for
  why a standalone `CREATE INDEX` referencing `user_id` in this file would
  fail on an upgrade before the migration ever gets to add that column.
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
origin. Cookies ride along automatically: because the browser only ever
talks to the Vite origin (`:5173`) and Vite proxies `/api` to the server
(`:3001`) server-side, every `/api/*` fetch is same-origin from the
browser's point of view, so the session cookie is sent without needing
`credentials: 'include'` anywhere in `client.ts`.

`App.tsx` uses a React Router layout route (`AppShell`, rendered via
`<Outlet />`) wrapped in `RequireAuth` for every page except `/login` — so
adding a new page under the shell just means adding a `<Route>` inside
that layout route, no per-page auth wiring needed. `RequireAuth` reads
`AuthContext` (which calls `GET /api/auth/me` once on mount) and redirects
to `/login` if there's no user once that initial check resolves; it
renders nothing while the check is in flight rather than flashing
protected content.

Pages under `src/pages/`: `Dashboard` (drag-to-reorder widget grid — net
worth trend, cash flow, accounts, recent transactions, spend-by-category,
budgets — order persisted to `localStorage`), `Transactions` (manual entry
+ CSV import + category management + table), `Accounts` (list + manual
account creation — the only UI for `api.createAccount`, which existed in
the client for a while with nothing calling it), `Budgets`, `Analytics`
(derived views only, no dedicated backend table), `DebtPlanner` (payoff
time via `utils/payoff.ts`'s amortization math, computed client-side since
it's a projection that changes with every payment), `Savings`, `BankLink`
/ `BankLinkCallback` (see the Enable Banking flow above), `Login` (Google/
Facebook buttons; grayed out per `GET /api/auth/providers` if a provider
isn't configured server-side, rather than offering a dead link).

## Data model

Every table below has a `user_id TEXT REFERENCES users(id)` not
individually noted per table — see the Authentication section above for
why, and for the migration that added it retroactively.

- `users` / `oauth_identities` / `sessions` — see Authentication above.
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
- `categories.name` and `budgets.category_id` are unique **per user**
  (`idx_categories_user_name`, `idx_budgets_user_category`), not globally
  — two different users can both have a "Groceries" category.
- `debts.balance` is the current balance, mutated directly by "record a
  payment" (`PATCH /api/debts/:id`) — there's no separate payment ledger,
  just current state.
- `savings_goals.current_amount` is only ever changed via `POST
  /api/savings/:id/contribute` (adds a delta), not a raw `PATCH`, so the
  client never has to read-modify-write it itself.
