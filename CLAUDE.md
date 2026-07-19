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
(or `ENABLE_BANKING_PRIVATE_KEY` — see Deployment below) — see the comments
in `.env.example` for the self-serve signup + certificate steps (no
billing, free sandbox with a mock bank). Sign-in needs at least one of
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `FACEBOOK_CLIENT_ID`/
`FACEBOOK_CLIENT_SECRET`, or nothing at all (email/password sign-up is
always available), plus `SESSION_SECRET`. `POSTGRES_URL` is optional for
local dev (see Architecture below) but required in production. None of
these crash the server if missing — the corresponding feature just
degrades (bank-link errors per-request; an unconfigured OAuth provider's
login button redirects to an error instead of you being unable to boot the
app at all).

## Architecture

**`server/`** — Express 5 + TypeScript API, Postgres via `src/db/client.ts`,
which picks between two drivers based on whether `POSTGRES_URL` is set:
  - **Set** (Vercel deployment) — `@neondatabase/serverless`, talking to
    real Vercel Postgres (Neon-backed) over the network. (Not
    `@vercel/postgres`: that package is deprecated now that Vercel Postgres
    moved to a native Neon integration — `@neondatabase/serverless` is what
    it wrapped anyway, and is the currently-recommended client.)
  - **Unset** (local dev, the default) — `@electric-sql/pglite`, a WASM
    Postgres that runs in-process with zero external service or native
    build step, persisted to `server/data/pgdata/` (gitignored). Same "no
    required install for local dev" reasoning that originally picked
    `node:sqlite` over `better-sqlite3` — just aimed at a Postgres-compatible
    engine now that production needs real Postgres, so there's no dialect
    split between dev and prod.

Both drivers only expose an async `query(text, params)` (Postgres `$1, $2`
placeholders), but every route was originally written against
`node:sqlite`'s synchronous `db.prepare(sql).get/all/run(...params)` shape
with `?` placeholders. Rather than rewrite every call site's SQL,
`db.prepare()` in `client.ts` is a compatibility shim: it translates `?` ->
`$1, $2, ...` once and keeps the exact same `get`/`all`/`run` call shape
everywhere else (now returning Promises) — the actual per-route changes
were adding `await`, not restructuring queries. Two real dialect
differences did need fixing at the call sites, though, and would bite again
if copied into new queries: SQLite's scalar `MAX(a, b)` is Postgres's
`GREATEST(a, b)` (Postgres's `MAX` is aggregate-only), and there's no
`lastInsertRowid` — inserts that need the new row use `RETURNING *`/`get()`
instead of `run()`.

`withTransaction()` wraps a driver-level dedicated connection (not just a
BEGIN/COMMIT around ordinary pooled queries) — for the Postgres driver,
`pool.query()` may multiplex separate calls across different physical
connections, so BEGIN on one and an INSERT on another wouldn't actually be
in the same transaction. Its callback receives a `tx` with its own
`.prepare()`, bound to that one connection; callers use `tx.prepare(...)`
inside the callback instead of the outer `db.prepare(...)` (see
`bankLink.ts`'s sync route or `importCsv.ts`).

Deliberately on Express 5, not 4: Express 4 doesn't catch rejected promises
thrown inside `async (req, res) =>` route handlers, so an unhandled
rejection there crashes the whole Node process — not just that request. All
the Enable Banking routes are async and call an external API that can
reject (e.g. missing/invalid credentials), so this isn't hypothetical.
Express 5 forwards those rejections to the error-handling middleware in
`src/app.ts` automatically, turning a process crash into a normal 500
response.

`src/app.ts` builds and exports the configured Express app (no
`app.listen()`); `src/index.ts` is the local-dev entrypoint (imports
`loadEnv.js` first — see the comment there on why import order matters —
then `app.ts`, then calls `.listen()`). `/api/index.ts` at the repo root is
the Vercel entrypoint: it re-exports the same `app`, which Vercel's
Node.js runtime accepts as a request handler directly.

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
  by the same Postgres database as everything else, not the default
  in-memory store (unfit for production, and doesn't survive a serverless
  function tearing down between invocations either). `expires_at` is
  compared against an ISO string computed in application code
  (`new Date().toISOString()`), not a DB-side `NOW()`, so both sides of
  every comparison are in the same format regardless of which driver is
  active. There's no `setInterval` sweeping expired rows — that doesn't
  survive serverless — so `set()` probabilistically (~1%) calls
  `pruneExpiredSessions()` on write instead.
- `src/auth/findOrCreateUser.ts` — resolves an OAuth callback profile (or
  email/password signup, via `createLocalUser`) to an app user: an existing
  `(provider, provider_user_id)` identity returns that user; otherwise an
  existing user is matched by email (so the same person can add a second
  sign-in method) or a new one is created.
- `src/db/schema.sql` — table definitions, applied automatically on startup
  by `src/db/client.ts`'s `initDb()` (top-level `await` in `app.ts`; all
  DDL uses `CREATE TABLE`/`INDEX IF NOT EXISTS`, so it's safe to re-run —
  on Vercel this happens once per cold start). Unlike the SQLite version
  this schema started as, `user_id`/`password_hash`/every per-user unique
  index are just part of the table definitions from the start — there's no
  migration step, since this targets a database that starts empty.
- `src/services/enableBanking.ts` — the only place that talks to the Enable
  Banking API. Auth is a locally-signed short-lived RS256 JWT (`kid` =
  `ENABLE_BANKING_APP_ID`) sent as a bearer token on every request — no
  token endpoint/network round trip like OAuth client-credentials flows, so
  nothing needs caching. The private key itself comes from
  `ENABLE_BANKING_PRIVATE_KEY` (raw PEM content — the only option that
  works on Vercel, since the gitignored `.pem` file never reaches the
  deployment) if set, else `ENABLE_BANKING_PRIVATE_KEY_PATH` (a file path,
  local-dev convenience).
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
  re-importing the same file is a no-op via `ON CONFLICT (id) DO NOTHING`
  instead of creating duplicates. Enable Banking transactions dedupe the
  same way, preferring the provider's `transaction_id`/`entry_reference`
  and falling back to a content hash if neither is present.
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

## Deployment (Vercel)

One Vercel project serves both halves from this repo:
- `vercel.json` (repo root) builds the client (`npm run build --workspace
  client`, output `client/dist`) and rewrites `/api/:path*` to the
  serverless function, everything else to `index.html` (SPA fallback).
  Same-origin in production, so `client/src/api/client.ts`'s relative
  `/api/*` paths work unchanged from dev — no separate API domain, no CORS
  needed there (the `cors()` middleware in `app.ts` still matters for local
  dev, where client and server run on different ports).
- `/api/index.ts` is the one serverless function handling every `/api/*`
  route — Express does its own internal routing via the routers already
  mounted in `app.ts`, so one catch-all function is correct, not one
  function per route.
- Required env vars (Vercel dashboard -> Settings -> Environment
  Variables): `SESSION_SECRET`, `CLIENT_URL` (your production URL),
  `POSTGRES_URL` (set automatically once you link the Postgres storage
  integration — see `.env.example`), plus whichever of the OAuth/Enable
  Banking vars you're using. `ENABLE_BANKING_PRIVATE_KEY` (raw PEM
  content) is required there instead of the `_PATH` variant, since the key
  file is gitignored and never reaches the deployment.
- OAuth redirect URIs need your production URL added alongside the
  localhost ones already registered (Google Cloud Console / Meta for
  Developers) — `https://your-app.vercel.app/api/auth/google/callback`
  etc.
- Session cookies are `secure` only when `NODE_ENV === "production"`
  (Vercel sets this automatically); `app.set("trust proxy", 1)` in
  `app.ts` is required for that to work correctly behind Vercel's proxy.
