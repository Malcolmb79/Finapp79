import jwt from "jsonwebtoken";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Thin client for the Enable Banking API (pan-EU/UK open banking aggregator).
 * Docs: https://enablebanking.com/docs/api/reference/
 *
 * Flow: sign a short-lived JWT per request (no network round trip needed,
 * unlike providers with an OAuth client-credentials token endpoint) -> list
 * ASPSPs (banks) -> POST /auth to get a redirect URL -> user authorizes at
 * their bank -> Enable Banking redirects back with ?code=&state= -> POST
 * /sessions to exchange the code for linked accounts -> pull transactions
 * per account.
 */

const API_BASE = "https://api.enablebanking.com";

let cachedPrivateKey: string | null = null;

function getPrivateKey(): string {
  if (cachedPrivateKey) return cachedPrivateKey;

  // Vercel deployments can't read ENABLE_BANKING_PRIVATE_KEY_PATH off disk —
  // the .pem file is gitignored (never committed) and so never makes it
  // into the deployment bundle. ENABLE_BANKING_PRIVATE_KEY holds the same
  // PEM content directly as an env var instead, set from the Vercel
  // dashboard; the file-path variant remains for local dev convenience.
  if (process.env.ENABLE_BANKING_PRIVATE_KEY) {
    cachedPrivateKey = process.env.ENABLE_BANKING_PRIVATE_KEY.replace(/\\n/g, "\n");
    return cachedPrivateKey;
  }

  const path = process.env.ENABLE_BANKING_PRIVATE_KEY_PATH;
  if (!path) throw new Error("Set either ENABLE_BANKING_PRIVATE_KEY or ENABLE_BANKING_PRIVATE_KEY_PATH");
  // Resolved relative to server/ (this file's directory, two levels up),
  // not process.cwd() — same reasoning as db/client.ts's DATABASE_PATH.
  cachedPrivateKey = readFileSync(resolve(__dirname, "../..", path), "utf-8");
  return cachedPrivateKey;
}

function authHeader(): string {
  const appId = process.env.ENABLE_BANKING_APP_ID;
  if (!appId) throw new Error("ENABLE_BANKING_APP_ID is not set");

  // Max allowed lifetime is 24h; signing is local so there's no cost to
  // making these short-lived.
  const token = jwt.sign({}, getPrivateKey(), {
    algorithm: "RS256",
    issuer: "enablebanking.com",
    audience: "api.enablebanking.com",
    expiresIn: "23h",
    keyid: appId,
  });

  return `Bearer ${token}`;
}

async function ebFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    // Enable Banking stamps every response with X-Request-Id, and it's the
    // first thing their support asks for. Carry it in the error so a failure
    // is reportable straight from the logs, without reproducing the call.
    const requestId = res.headers.get("x-request-id") ?? "none";
    throw new Error(
      `Enable Banking request failed: ${res.status} ${await res.text()} [${path} request_id=${requestId}]`
    );
  }

  return res.json() as Promise<T>;
}

export interface Aspsp {
  name: string;
  country: string;
  logo?: string;
}

export async function listAspsps(country: string): Promise<Aspsp[]> {
  const { aspsps } = await ebFetch<{ aspsps: Aspsp[] }>(`/aspsps?country=${encodeURIComponent(country)}`);
  return aspsps;
}

export interface AuthorizationResponse {
  url: string;
  authorization_id: string;
}

/**
 * How long a bank authorisation lasts.
 *
 * Ninety days is the regulatory ceiling, so this is as long as it can be
 * rather than a number worth tuning. What matters is that it *ends*: the
 * consent lapses on a date, the bank stops answering, and none of that is
 * visible anywhere unless the app writes the date down. Returned to the
 * caller for exactly that reason, rather than computed and forgotten in here.
 */
export const AUTH_VALID_DAYS = 90;

export function authorisationExpiry(from = new Date()): string {
  const validUntil = new Date(from);
  validUntil.setDate(validUntil.getDate() + AUTH_VALID_DAYS);
  return validUntil.toISOString();
}

export function startAuthorization(
  aspsp: { name: string; country: string },
  state: string,
  redirectUrl: string,
  validUntilIso: string
): Promise<AuthorizationResponse> {
  return ebFetch<AuthorizationResponse>("/auth", {
    method: "POST",
    body: JSON.stringify({
      access: { valid_until: validUntilIso },
      aspsp,
      state,
      redirect_url: redirectUrl,
      psu_type: "personal",
    }),
  });
}

export interface AccountBalance {
  balance_amount: { amount: string; currency: string };
  // ISO 20022 four-letter codes -- CLBD (closing booked), ITAV (interim
  // available), XPCD (expected), and so on. Not the Berlin Group camelCase
  // spellings ("closingBooked"), which this API never returns.
  balance_type: string;
}

// listAccountTransactions only pulls a 90-day window, so summing those
// transactions is never a real balance for an account with any history
// before that window -- this hits the bank's own current-balance figure
// directly instead.
export async function getAccountBalances(accountUid: string): Promise<AccountBalance[]> {
  const { balances } = await ebFetch<{ balances: AccountBalance[] }>(`/accounts/${accountUid}/balances`);
  return balances;
}

export interface AccountDetails {
  // "The maximum credit or overdraft allowed on the account" -- the arranged
  // facility, which the balances endpoint does not carry. Optional: plenty of
  // banks don't expose it, and an account with no facility has none.
  credit_limit?: { amount: string; currency: string };
}

export function getAccountDetails(accountUid: string): Promise<AccountDetails> {
  return ebFetch<AccountDetails>(`/accounts/${accountUid}/details`);
}

export interface SessionAccount {
  uid: string;
  account_id?: { iban?: string };
  name?: string;
  currency: string;
}

export interface SessionResponse {
  session_id: string;
  accounts: SessionAccount[];
}

export function exchangeCode(code: string): Promise<SessionResponse> {
  return ebFetch<SessionResponse>("/sessions", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export interface RemoteTransaction {
  transaction_id?: string;
  entry_reference?: string;
  booking_date: string;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator?: "CRDT" | "DBIT";
  remittance_information?: string[];
  creditor?: { name?: string };
  debtor?: { name?: string };
}

/** The furthest back a bank will answer for, and the default window. */
export const MAX_HISTORY_DAYS = 90;

export interface TransactionPage {
  transactions: RemoteTransaction[];
  /** Set when a page failed and the walk stopped early. */
  incomplete?: string;
}

/**
 * A bank's transactions, walked page by page.
 *
 * Two things here are the scars of one failure, and both matter.
 *
 * **A failed page no longer throws the successful ones away.** This used to
 * `await` each page straight into an array and let any rejection escape, so a
 * single bad page discarded every page already fetched and wrote nothing at
 * all. AIB returned `ASPSP_ERROR / "Unknown error"` on one page partway
 * through, and because the walk restarted from the same date every run it hit
 * the same page every time: the account stopped updating completely, for a
 * week, with no record of why. What is fetched is now kept and the reason is
 * handed back.
 *
 * **The caller chooses where to start.** A page that fails cannot be stepped
 * over — its continuation key is inside the response that failed — so a walk
 * that always begins ninety days back will keep dying at the same page
 * forever, however gracefully. Starting from what is already stored begins
 * the walk after the bad stretch, which is what actually gets a stuck account
 * moving again.
 *
 * One retry per page, because `ASPSP_ERROR` with no detail is the shape of an
 * upstream hiccup rather than a permanent condition.
 */
export async function listAccountTransactions(accountUid: string, options: { from?: string } = {}): Promise<TransactionPage> {
  const floor = new Date();
  floor.setDate(floor.getDate() - MAX_HISTORY_DAYS);
  const floorStr = floor.toISOString().slice(0, 10);
  // Never further back than the bank will answer for, whatever is asked.
  let start = options.from && options.from > floorStr ? options.from : floorStr;

  const all: RemoteTransaction[] = [];
  let lastError: string | undefined;

  /**
   * Start again after whatever the failed walk did manage to fetch.
   *
   * This is the move that actually gets a stuck account unstuck. A page that
   * fails cannot be stepped over from inside the walk — its continuation key
   * is in the response that failed — but a *fresh* walk beginning after the
   * last transaction successfully read is a different pagination, and one
   * that need never reach the bad page at all.
   *
   * Bounded, and each restart must strictly advance the date. A walk whose
   * very first page fails has fetched nothing, so there is no later date to
   * move to and nothing to be gained by asking again.
   */
  for (let walk = 0; walk < MAX_WALK_RESTARTS; walk++) {
    const page = await walkFrom(accountUid, start);
    all.push(...page.transactions);
    if (!page.incomplete) return { transactions: all };

    lastError = page.incomplete;
    const newest = page.transactions.reduce<string | null>(
      (latest, tx) => (tx.booking_date && (!latest || tx.booking_date > latest) ? tx.booking_date : latest),
      null
    );
    const next = newest ? new Date(Date.parse(`${newest}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : null;
    if (!next || next <= start) break;
    start = next;
  }

  return { transactions: all, incomplete: lastError };
}

/** How many times to begin again past a bad page before giving up. */
const MAX_WALK_RESTARTS = 6;

/** One pagination, from one date, stopping at the first page it can't get. */
async function walkFrom(accountUid: string, dateFromStr: string): Promise<TransactionPage> {
  const transactions: RemoteTransaction[] = [];
  let continuationKey: string | undefined;

  for (;;) {
    const query = new URLSearchParams({ date_from: dateFromStr });
    if (continuationKey) query.set("continuation_key", continuationKey);
    const path = `/accounts/${accountUid}/transactions?${query.toString()}`;

    let page: { transactions: RemoteTransaction[]; continuation_key?: string };
    try {
      page = await ebFetch<typeof page>(path);
    } catch {
      // One retry, because ASPSP_ERROR with no detail is the shape of an
      // upstream hiccup rather than a permanent condition. The first error is
      // dropped on purpose: if the retry also fails, its reason is the
      // current one and the more useful of the two.
      try {
        page = await ebFetch<typeof page>(path);
      } catch (retryErr) {
        const reason = retryErr instanceof Error ? retryErr.message : "the bank stopped responding";
        // Everything fetched so far is real and worth keeping — the insert
        // dedupes, so a partial pull costs nothing and the next run carries
        // on from a later date.
        return { transactions, incomplete: reason };
      }
    }

    transactions.push(...page.transactions);
    continuationKey = page.continuation_key;
    if (!continuationKey) return { transactions };
  }
}
