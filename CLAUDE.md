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
- `npm run test` — run both workspaces' tests (vitest)
  - One workspace: `npm run test --workspace client`
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
`services/accountSync.ts` or `importCsv.ts`).

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
- `src/auth/sessionTtl.ts` — how long a session lasts
  (`SESSION_TTL_MINUTES`, default 60, capped at 1440). The session cookie in
  `app.ts` carries **no** `maxAge` on purpose, so it's a browser-session
  cookie that dies when the browser or app closes; the store's `expires_at`
  is the real lifetime, and `rolling: true` + the store's `touch()` make it
  an idle timeout rather than an absolute one. Don't reintroduce
  `cookie.maxAge` — a persistent cookie is what previously let a reopened
  app walk straight in days later, and `set()`/`touch()` reading
  `sessionData.cookie.maxAge` would silently restore that too.
- `src/auth/findOrCreateUser.ts` — resolves an OAuth callback profile (or
  email/password signup, via `createLocalUser`) to an app user: an existing
  `(provider, provider_user_id)` identity returns that user; otherwise an
  existing user is matched by email (so the same person can add a second
  sign-in method) or a new one is created. `isSignupAllowed()`/
  `SignupClosedError` gate every new-account insert in this file (password
  signup, a brand new OAuth identity, and a passkey's own account-creation
  path all end up here) behind `ALLOWED_SIGNUP_EMAIL` — unset means open
  signups (the default); set it to close the app to one address. Linking a
  second sign-in method to an account that already exists is never
  blocked, only creating a brand new one.
- `src/auth/passkeys.ts` / `src/routes/passkeys.ts` — WebAuthn passkey
  sign-in (Face ID/Touch ID/Windows Hello/a security key), alongside
  Google/Facebook/password rather than replacing them. Credentials are
  rows in `passkey_credentials`, keyed by `user_id`. `relyingParty()`
  derives the RP ID/origin from `CLIENT_URL` so this needs no dedicated
  env var in the common case — `PASSKEY_RP_ID`/`PASSKEY_ORIGIN` override
  it when that derivation is wrong. The in-flight WebAuthn challenge lives
  in the session (`req.session.passkeyChallenge`), not a signed cookie —
  `express-session` here is already backed by Postgres, so it can simply
  be put down between the "options" and "verify" calls and picked up
  again, single-use and cleared either way. `register/options` doubles as
  sign-up when there's no session yet (the same door `/auth/signup`
  already opens, behind the same rate limit and `ALLOWED_SIGNUP_EMAIL`
  gate), and `wouldLockOut()` refuses to delete a credential that is the
  only way into an account with no password set.
- `src/auth/tokens.ts` — single-use tokens for password reset and email
  verification links. `createToken()` persists only the SHA-256 hash of a
  random token and returns the raw value (the only time it's ever
  available in plaintext) — same "never store the recoverable secret"
  reasoning as password hashing, so a database leak can't be turned into
  working reset/verify links. `consumeToken()` looks up by hash, checks
  `expires_at`/`used_at`, and marks it used atomically with the check.
- `src/services/mailer.ts` / `src/auth/emailTemplates.ts` — transactional
  email (password reset, email verification) via Resend. Same
  "missing config degrades gracefully" principle as Enable Banking/OAuth:
  without `RESEND_API_KEY`, `sendEmail()` logs the message to the console
  instead of throwing, so the full reset/verify flow works in local dev
  (grab the link from the server log) without a real Resend account.
- `src/middleware/authRateLimit.ts` — `loginRateLimit`/`signupRateLimit`/
  `emailActionRateLimit`, all keyed by IP (express-rate-limit's default),
  applied to `/signup`, `/login`, `/forgot-password`, and
  `/resend-verification`. `POST /auth/forgot-password` always responds 204
  regardless of whether the email is registered — an enumeration-safe
  design, so don't add a branch that reveals account existence there.
- `app.ts` throws at boot if `SESSION_SECRET` is unset **and**
  `NODE_ENV === "production"` (local dev still gets a warning + insecure
  fallback, so it keeps working without a `.env`); `helmet()` is mounted
  for standard security headers (`contentSecurityPolicy: false`, since
  this API never serves HTML); the error-handling middleware returns the
  real `err.message` in dev but a generic "Internal server error" in
  production, so stack traces/internals never reach a client response.
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
- A statement whose **description column is mapped to the wrong field**
  imports perfectly — every date, every amount and the total all correct —
  and the rows arrive with no name, surfacing days later as a review queue of
  lines reading "Transaction" over a date, with nothing left to say which
  statement did it. Three places address it, and they are three different
  problems rather than one repeated:
  - `statementParser.ts` ignores a header-name hint for a column that is
    empty on **every** row. "Reference" is one of the words a description
    column is recognised by and is routinely the column a bank leaves blank
    beside the one that names the transaction. It also skips a column whose
    every row says the same thing, which is a currency or channel code and
    would otherwise name every transaction on the statement "ZAR".
  - `strayName()` is the row-level answer, and the one that matters for PDFs:
    a PDF has no columns, only text at coordinates, so a line indented
    differently from the rest (an FNB fee prefixed with "#", a sub-total) has
    its text assigned to a neighbouring column and arrives with a correct
    date, a correct amount and no name. The text was never missing — it is
    one cell over. So a row the description column leaves blank takes the
    longest name-like text elsewhere on its own line. `looksLikeName()` is
    what keeps that honest: two consecutive letters, not a date, not an
    amount, not a bare ISO code.
  - `importStatement.ts`'s preview returns `unnamed: {count, betterColumn}`.
    `betterDescriptionColumn()` does not guess harder — it re-applies the
    mapping with each unused column as the description and takes the one
    leaving fewest rows nameless, and only ever offers it. It will never
    propose a column that isn't text — not the date, not the amount, and not
    the running balance, which is the one it actually offered on an FNB
    statement. Naming a row "12,381.04" looks fixed and is worse, because it
    stops announcing that anything is missing.
  - The preview returns `lines`, aligned with `sample` by index: the file's
    own cells for a row nothing could name, and null for every row that has
    a name. "Why has this come through blank?" has no answer that isn't the
    line itself — either the text is in a column the mapping isn't reading,
    and it is right there to be seen, or the line really is a date and an
    amount, which is equally worth knowing because no column will fix it.
    `applyMappingIndexed()` exists for this, with `applyMapping()` as a
    projection of it, so there is one parse rather than two that can drift.
  - And some statements genuinely do not name some rows. An FNB cheque
    account prints its own fee postings with the description column empty —
    the PDF's text layer has no run at that x-position at all, not text in
    the wrong column — so no mapping will ever produce one. Those rows get a
    box in the preview instead of a dash, and `importedDescription()` stores
    what was typed. It never overrides a description the file carries, and
    the content hash is still taken from the file's own description, so
    naming a row does not change its identity and next month's overlapping
    statement still dedupes against it.
  - `services/statementCharges.ts` fills that box where the statement does
    say what the row was, somewhere else and in aggregate. FNB prints
    `Service Fees 241.62 Dr` / `Other Fees 69.00 Dr` in a summary above the
    transactions, and 2.00 + 114.62 + 125.00 is 241.62 exactly while the
    remaining unnamed row is 69.00 exactly. `chargeLines()` reads only lines
    naming a fee or charge — a statement is full of `<words> <number>` lines
    and any of them could coincidentally match, so the restriction is what
    stops a coincidence being read as an explanation; aggregates ("Total bank
    charges") and zero totals are skipped too. `nameUnnamedRows()` claims a
    charge only when **exactly one** combination of the still-unclaimed rows
    adds up to it, and claims each row at most once: 2.00 + 3.00 and 5.00
    both make 5.00, and picking one would be inventing the answer.

    The label and the figure are both quoted from the document (`printed`
    keeps the amount exactly as written, so the evidence stays findable on
    the page), the arithmetic is shown under each row, and the dialog fills
    the box rather than writing anything — so it can be corrected or cleared
    before it becomes a transaction. Same grounded footing as
    `loanContract.ts` and `policyDocument.ts`.
  - `GET /api/accounts/:id/imports` counts `unnamed` per import, for the
    same reason `futureDated` is there: a perfect-looking import needs
    something that identifies it after the fact. The detail card pairs with
    it by printing a csv row's `created_at`, which is exactly the key an
    import is listed and undone by.
- Manual transactions (`source = 'manual'`) are the only ones that can be
  deleted (`DELETE /api/transactions/:id` filters on `source = 'manual'`) —
  synced and imported transactions are meant to stay in sync with their
  origin instead of being hand-edited away.
- A row awaiting review (`reviewed_at IS NULL`) can already carry a
  `category_id`: the detail card opens from the review queue and files it
  without approving it. So everywhere that decides what approving will write
  — `PendingReviewWidget`'s `selectedCategory`, `TopHeader`'s `chosen` — reads
  `category_id ?? suggested_category_id`, never the suggestion alone. The
  suggestion is a guess and the stored category is a decision; letting the
  guess win means the tick quietly undoes the edit the screen had just shown.
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
it's a projection that changes with every payment, plus the payoff
modeller, refinance check and credit utilisation described below),
`Savings`, `Reports` / `Future` / `Properties` / `BuyToLet` (see "Statements,
projections and property" below), `Policies`
(life cover: upload a statement, confirm what was read from it, and choose
per policy which figure counts towards net worth — see the data model below),
`BankLink`
/ `BankLinkCallback` (see the Enable Banking flow above), `Login` (Google/
Facebook buttons; grayed out per `GET /api/auth/providers` if a provider
isn't configured server-side, rather than offering a dead link).

### Statements, projections and property

Three pages added after the core app, and the split between the first two
is deliberate rather than cosmetic.

**`Reports`** states the position. Five statements — net worth, income and
expense, month by month, budget vs actual, and the ratio set — all built
by `utils/reports.ts`, which resolves every one of them to a single
shape: columns, sections of rows, and notes. That is what lets one
renderer (`components/ReportView.tsx`) draw all of them, one exporter
write all of them to CSV, and a sixth report be a function rather than a
page. Every money cell carries its raw figure beside its formatted text,
so the export is something a spreadsheet can add up rather than a picture
of one. The notes print along with the figures, including on paper: the
caveats are part of what the statement claims.

Two rules the shape enforces. Every report carries a period in words, and
the net worth statement is dated rather than windowed, because a balance
sheet has a date and not a period. And `budgetVsActual` compares only the
categories that have a limit — measuring every euro of spending against
the sum of only the budgeted caps reported "395% used" for a household
whose two budgets were both roughly kept, which is arithmetic that makes a
false claim.

**`Future`** projects from it, and is a separate page on purpose: a
projection sitting in a table of facts is a projection that will be quoted
as a fact. `utils/fire.ts` and `utils/scenario.ts` carry two decisions
worth not undoing. The pot is *investable* assets — cash, savings and
investments, never the home, which does not pay for groceries unless it is
sold. And everything is in today's money against a real return, so the
target is never inflated to match; mixing a nominal return with an
un-inflated target is the standard error in these calculators and it
always errs optimistically. `projectFire` refuses a negative monthly
saving outright rather than projecting through it: the pot still
compounds, so the honest-looking alternative returns a retirement date
decades out while the shortfall funding each month is borrowing the model
does not track. Saving *nothing* is deliberately allowed — a pot large
enough to compound into the target on its own is coasting.

**`Properties`** is property held as an investment or lived in, kept out
of `accounts` for the reason policies are (see the data model below).
`utils/propertyMetrics.ts` computes NOI *before* the mortgage, which is
the whole point of the measure — it says what the building earns,
separately from how the buyer financed it, so two identical houses do not
report different performance because one owner borrowed more. Every metric
returns null rather than zero when its input is missing, and the portfolio
totals count what they left out.

**`BuyToLet`** appraises a deal before it is bought, and exists because a
UK landlord's deal spreadsheet gives the wrong Irish answer confidently.
`utils/irishTax.ts` holds every rate in one dated block so a Finance Act
can be absorbed in one place; `utils/btlDeal.ts` is the deal model on top
of it. The corrections that matter, each of which a UK sheet gets wrong in
a different direction:

- **No second-home stamp duty surcharge.** Ireland charges a landlord the
  same 1% / 2% / 6% bands as an owner occupier (three or more apartments in
  one block stop at 2%; ten or more units inside twelve months is 15% on the
  whole price, s31E SDCA 1999). A UK sheet's surcharge overstates the entry
  cost by more than the duty itself.
- **No Section 24.** Interest is 100% deductible under s97(2)(e) TCA 1997,
  so the UK add-back overstates the tax on every geared deal. But the
  deduction is conditional on RTB registration and is *lost in full* for the
  year without it — a cliff edge, not a taper, and `personalRentalTax` adds
  the interest back when `rtbRegistered` is false.
- **USC and PRSI sit on top of income tax**, so a higher-rate landlord is
  near 52% rather than the UK's 40%. The RPRIR landlord credit reduces
  income tax only, never USC or PRSI, and is not refundable.
- **A close company is usually worse here.** 25% corporation tax on rental
  profit plus a 20% surcharge on what it retains, about 40% all in, and the
  dividend out is taxed again at the shareholder's rate. The UK sheet's
  usual conclusion reverses. `comparePersonalAndCompany` returns a
  comparison rather than a recommendation because the answer genuinely
  swings on the band and on whether the money is needed.
- **Local Property Tax is the owner's**, where UK council tax is the
  tenant's, so a UK sheet has no line for it at all.

Two modelling points worth not undoing. **Capital repayment is cash out and
is not deductible**, which a UK sheet sidesteps by assuming interest-only —
the normal UK BTL product and the unusual Irish one. So `taxableProfit` is
cash flow *plus* the capital repaid *minus* wear and tear, and the first
year's split comes from the real amortization schedule rather than an
average of the term. The default worked example shows why it matters: a
deal with +€210 a month of cash flow is -€19 a month after tax. And
**vacancy is allowed for**, because a deal that only works at full
occupancy is a deal with no margin in it.

A deal is its own table rather than a draft `properties` row: a candidate
has no equity, no tenancy and no mortgage, and letting one into
`properties` would put things nobody has bought into net worth.

Also on `DebtPlanner`: `utils/amortization.ts` produces the month-by-month
schedule with and without an extra payment, and `compareRefinance` exists
to expose the trap that a refinance is sold on the monthly payment and
paid for in total interest — `cheaperButCostlier` flags the case where a
longer term moves those two in opposite directions. The final contracted
payment absorbs the rounding remainder the way a lender's does; without
that, a 360-month loan reports 361 payments and every "months saved"
figure beside it is off by one. `utils/creditHealth.ts` does utilisation
only, on revolving credit only — an instalment loan has no limit to use a
share of, and including mortgages would make everybody who has bought a
house look maxed out. It is not a credit score and says so.

**Every screen that builds a net worth figure must add accounts, policies,
holdings *and* properties.** Each has a `*Contributions` helper of the
same shape for that reason. The first cut of properties added the per-property
opt-in without wiring the contribution anywhere, so the property page
announced €222,000 was in net worth while the sidebar, dashboard, reports
and projections all disagreed. The five places are `Sidebar`, `Dashboard`
(headline, trend and the per-currency breakdown), `Reports`, `Future` and
the page itself.

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
- `policies` / `policy_valuations` — life insurance, read from a statement by
  `services/policyDocument.ts` (the same grounded-extraction design as
  `loanContract.ts`, whose helpers it imports rather than copies). Kept out of
  `accounts` deliberately: a policy has no transactions, no IBAN and no bank
  connection, so folding it in would offer it as a transaction target in every
  account dropdown, the statement importer, the account filter and the debt
  planner.

  The two money columns are **not** interchangeable, and most of the design
  exists to keep them apart. `cover_amount` is the sum assured — what pays out
  on death, which is not money held; a term policy quotes a large one and has
  no cash value at all. `surrender_value` is what the policy is worth if cashed
  in today, and that is the figure that behaves like an asset. They sit
  together on the same page of a statement in the same currency, so the reader
  drops a surrender value whose evidence is the cover amount's own sentence
  (`dropConfusedSurrender`), and nothing is stored until confirmed.

  `net_worth_source` (`none` | `surrender` | `cover`) names which figure counts,
  per policy, and defaults to `none` — a policy is in no total until asked in.
  Counting one at its cover amount is allowed, and every screen that uses the
  figure says so rather than letting it disappear into a total.
  `policy_valuations` keeps one row per confirmed statement, which is what lets
  the net worth trend show a policy from its first statement onward instead of
  projecting today's value back across history it wasn't held for.
- `properties` — a house, flat or plot, kept out of `accounts` on the same
  reasoning as `policies`: no transactions, no IBAN, no bank connection, so
  folding it in would offer a house as a transaction target in every account
  dropdown, the statement importer, the account filter and the debt planner.

  The mortgage is a plain balance here rather than a link to a loan account,
  and that is a limitation rather than an oversight — a household already
  tracking its mortgage as a loan account would otherwise have the same debt
  counted twice. `net_worth_source` (`none` | `equity` | `value`) resolves
  it, defaulting to `none` exactly as a policy does. `value` is the answer
  for that double-counting case, and the screens say which was chosen.

  There is no valuation history the way `policy_valuations` is one, so
  `propertyContributionsAt` contributes from the purchase date onwards at
  today's figure and nothing before. Projecting past the purchase would show
  a household owning a house in years it did not — inventing wealth, which is
  the worse of the two available errors — while carrying today's value back
  across the years it *was* held merely flattens the line.
- `categories.is_transfer` marks money that moves between the household's own
  accounts. A transfer is one event in two rows — €2,000 leaves the current
  account and the same €2,000 arrives in savings — so counted naively it adds
  the same money to both sides of a month, and a savings rate built on those
  two figures is wrong in the numerator and the denominator together.

  **Both rows stay.** The balances need them. What changes is which list a
  screen reads: `worthTx` (and anything about balances) keeps everything,
  while every income, spending, category and savings-rate figure comes off a
  list passed through `excludeTransfers` in `utils/transfers.ts`. Server-side
  the same exclusion is a `COALESCE(c.is_transfer, FALSE) = FALSE` clause in
  `plan.ts` and `budgetAdvisor.ts`. It is the same split the app already made
  for a loan repayment, generalised — and the same "every screen or none"
  rule the net worth figures live under.

  `findTransferPairs` matches an outflow to an inflow on a *different*
  account, within a few days and within 2% on amount, each row used once. It
  only ever suggests: two accounts, four days and a matching amount describes
  a transfer and equally describes paying somebody who banks where you do.
- Policy premiums reach `GET /api/plan` through `services/policyPremiums.ts`,
  and only the ones that match no transaction are subtracted from the surplus.
  A premium debited from a tracked account is already inside `typicalSpend` —
  the same double-count the plan already avoids for debt minimums.


### What a subscription is not

A loan instalment comes back every month for an identical amount, which is the
entire definition `detectRecurring` works from — so "Direct Debit to Novuna
Personal Fi · Monthly · €187.24/mo" sat above Netflix in the subscriptions
list, as though stopping it were an option.

It isn't one. A subscription is money spent to keep receiving something; a
repayment buys down a balance, so net worth is unchanged by it and there is
nothing to cancel. Counting it overstates the total twice — once as spending
that isn't spending, once as a commitment that could be dropped.

- `subscriptions()` in `recurring.ts` is `detectRecurring` over
  `spendingTransactions`, which is the rule the rest of the app already applies
  to every figure about what was spent. A subscriptions total built without it
  was the one spending figure in the app disagreeing with the others.
  `detectRecurring` itself is left alone: the **forecast** must keep the
  repayment, because the money does leave the account, and a projection that
  drops a real outgoing errs in the direction a "will there be enough" line
  must never err in.
- `recurringRepayments()` returns the other half, and the card prints it —
  "One loan repayment is not counted here — €170.00 a month". A total that
  quietly leaves things out is a total nobody can reconcile against the account
  it came from, which is the same reason `dropped`, the report `notes` and the
  property totals all name what they excluded.
- Price rises go the same way. A loan instalment moving is a rate change, not a
  price rise; there is no provider to ring about it.
- All of that depends on the payment having been **attributed** — a repayment
  rule on the loan's own account. Until then an untracked loan is
  indistinguishable from a subscription, so `loanRepayments.ts` speaks up about
  the one case where the app can see both halves and nobody has joined them: a
  loan or card whose balance nothing is moving, beside a payment carrying that
  account's own name. The owner called it "Novuna" and the bank wrote "Novuna"
  on the payment — evidence from two independent places, the same footing
  `statementCharges.ts` stands on.

  `distinctiveWords()` is what keeps it from being a guess: words naming the
  *kind* of thing (loan, card, personal, finance, direct) are struck out,
  because every account of a type carries them and matching on one would attach
  "Personal loan" to the first lender's direct debit it saw. And a loan
  matching two payments, or a payment matching two loans, is refused outright —
  a lender charging a monthly fee beside the instalment is the ordinary case,
  and two cards with one bank is the same ambiguity from the other side. Same
  exactly-one discipline as `nameUnnamedRows`.

  It only ever offers. Confirming writes the **ordinary repayment rule**, not a
  flag of this feature's own — so the payment leaves the list *and* the loan's
  balance starts moving. Hiding the row alone would leave the loan frozen,
  which is the worse of the two faults.

### The balance projection, and what it will not project

`utils/forecast.ts` draws the line from today's spendable total and what
repeats. Three rules keep it from inventing money, and each of them exists
because it once did.

- **`stillLive()` drops a commitment that has missed its turn** — more than
  one and a half of its own cycles since the last charge. Without it,
  `nextDueDates` steps forward from the last charge and skips the dates that
  have been and gone, which *looks* like old payments are handled: a credit
  received once in January 2025 produces no 2025 dates, and then produces
  next month's, and the month after, forever. Harmless on a cancelled
  subscription, where it only makes the line pessimistic. On the income side
  it is how a household gets shown a balance climbing by a dozen salaries a
  month.
- **Credits carrying a payment reference never group.** `merchantKey` strips
  digits, so "Inward Swift R026J26Md0" and "Inward Swift R026K7Pb60" are two
  merchants with one payment each. A merchant with one payment has no spacing
  to measure, so `declaredIncome` falls back to monthly — a deliberate guess,
  defensible for a job started last month and catastrophic multiplied by
  every one-off credit in the history. `stillLive` is what bounds it.
- **`incomeFrom` lets the caller read income off a different list.** The line
  opens at `spendableTotal`, which is every spendable account added together,
  so a transfer between two of them is already inside the opening figure on
  both sides — projecting the inflow leg adds money that was always there.
  The Dashboard passes transfers-excluded transactions for income and the
  full list for outgoings, on purpose: the outflow leg may genuinely leave
  the spendable total for a liability account that is not in it, and both
  choices err towards a lower balance, which is the direction a "will there
  be enough" projection should be wrong in.

The card names both sides — "from 4 regular payments and 1 income worth
€2,171.55 a month" — because naming only the commitments is what let a wrong
projection go unexplained: a line climbing by ninety thousand euro read
exactly like one climbing by nine hundred.

### Statements that stopped arriving

An account fed by statement import fails silently when you forget it: no
error, nothing turns red, it simply stops changing — which on screen is
indistinguishable from an account with nothing happening on it. Same quiet
failure a broken bank sync has, which is why that one is already an alert.

`utils/statementsDue.ts` is the single definition, and two decisions in it
matter:

- **Coverage, not the upload date.** The accounts list returns both
  `last_import_at` (when a statement was uploaded) and `last_imported_date`
  (how far it reached). An import done this morning carrying nothing newer
  than March means the account has been fed and is still months stale, so the
  measure is coverage and the upload date is only context.
- **Forty days, not thirty.** A monthly statement covering the 8th to the 7th
  is only issued on the 7th, so coverage on a perfectly kept account drifts to
  thirty-odd days old every month purely by waiting. Firing at thirty would
  nag every account every month for being up to date.

It refuses to ask about three kinds of account, and each omission is what
keeps the prompt worth reading: linked accounts (fed by sync, and a quiet one
is already a sync or authorisation alert in its own words), accounts never
imported to (no habit to be behind on — inferring one would put every manual
account on the list permanently), and hidden accounts.

`statementsMissing()` covers that second case with a narrower question that
needs no guessing: **has anything ever gone in, by any route?** A hand-kept
account has entries; one never imported to that *also* holds nothing at all
is a balance with no history behind it. It reads `transaction_count` from the
accounts route, counted over all time, because the client's transaction list
is filtered by range and scope and so cannot answer "ever" — and only an
explicit zero counts, since treating a missing count as emptiness would list
every hand-kept account the moment anything upstream stopped sending the
field. A new account gets `NEW_ACCOUNT_GRACE_DAYS` before being asked,
because the gap between making one and feeding it is part of setting it up.

That half is deliberately **not** in the bell. Being behind is news: it
became true on a particular day and stops being true when you act. An account
that has always been empty is not news on any day, and an alert that fires
every day until you deal with it is one you learn to ignore — so it lives in
the widget and on the account row, where a standing list belongs. The widget
keeps the two in separate sections for the same reason: one account needs its
next statement, the other its first, and running them together makes the
second read as a lapse rather than as setup nobody finished.

Three surfaces, one rule: the alert in the bell (`deriveAlerts`), the
`statementsDue` dashboard widget, and the flag beside the account on the
Accounts page — which reaches it through `staleness()` in `accountBalance.ts`,
delegating its import half to `statementDue` rather than keeping a second
definition. Worded per kind there, because "no import in 168 days" is a plain
lie on an account imported to this morning whose statements stopped in June.

### Scheduled syncing

`vercel.json`'s `crons` entry calls `GET /api/cron/sync` once a day, and
nothing else calls it. It is deliberately not behind `requireAuth` — a
scheduled invocation has no session by definition — so it guards itself with
`CRON_SECRET`, which Vercel sends as a bearer token. With that unset the route
is open in dev and shut in production, so a deployment where nobody set the
secret fails closed rather than open (`routes/cron.ts`).

The sync itself lives in `services/accountSync.ts` so the schedule runs
exactly what the button runs. Two implementations of "sync an account" would
drift, and the one that drifts is always the one nobody is watching. Failures
are recorded per account (`last_sync_at` / `last_sync_error`) and shown on the
Accounts page: an Enable Banking authorisation lapses after roughly 90 days,
and an account that silently stops updating looks exactly like an account with
nothing happening on it.

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
  file is gitignored and never reaches the deployment. Passkeys need no
  env var of their own — `relyingParty()` derives the RP ID/origin from
  `CLIENT_URL`, which is already in this list; set `PASSKEY_RP_ID`/
  `PASSKEY_ORIGIN` only if that derivation is ever wrong. Set
  `ALLOWED_SIGNUP_EMAIL` to close signups to one address instead of
  leaving the deployment open to anyone who finds the URL.
- OAuth redirect URIs need your production URL added alongside the
  localhost ones already registered (Google Cloud Console / Meta for
  Developers) — `https://your-app.vercel.app/api/auth/google/callback`
  etc.
- Session cookies are `secure` only when `NODE_ENV === "production"`
  (Vercel sets this automatically); `app.set("trust proxy", 1)` in
  `app.ts` is required for that to work correctly behind Vercel's proxy.
- **Project Settings -> General -> Root Directory must be blank** (the
  actual repo root). Vercel's initial import flow can auto-suggest a
  subfolder (e.g. `server`) as the root if it heuristically guesses that's
  "the app" — if it's set wrong, every command (`npm install`, the build)
  runs with that subfolder as cwd instead of the repo root. This produces
  a confusing symptom: `npm run build --workspace client` *appears* to
  work (npm's `--workspace` flag walks up to find the real monorepo root
  regardless of cwd, so it still locates and builds the client), but
  `npm install` only sees that one workspace's own dependencies, so
  packages declared solely in the other workspace's `package.json` (e.g.
  `react` when cwd is `server/`) never get installed — surfacing as
  `tsc` "cannot find module 'react'" errors that look like a dependency
  problem but aren't. Confirmed by a plain `npm run <script-that-only-
  exists-at-repo-root>` failing with "workspace server@0.1.0 ... Missing
  script" — that error only makes sense if cwd was `server/`, not root.
  `installCommand: "npm install --include=dev"` in `vercel.json` stays as
  a safety margin against a separate, real (but not what actually caused
  this) npm behavior: `NODE_ENV=production` (which Vercel's build sets)
  can make plain `npm install` skip `devDependencies` — and `typescript`/
  `vite`/`@types/react` all live there in `client/package.json`.
