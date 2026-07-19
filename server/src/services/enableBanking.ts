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
    throw new Error(`Enable Banking request failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

export interface Aspsp {
  name: string;
  country: string;
}

export async function listAspsps(country: string): Promise<Aspsp[]> {
  const { aspsps } = await ebFetch<{ aspsps: Aspsp[] }>(`/aspsps?country=${encodeURIComponent(country)}`);
  return aspsps;
}

export interface AuthorizationResponse {
  url: string;
  authorization_id: string;
}

export function startAuthorization(
  aspsp: { name: string; country: string },
  state: string,
  redirectUrl: string
): Promise<AuthorizationResponse> {
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 90);

  return ebFetch<AuthorizationResponse>("/auth", {
    method: "POST",
    body: JSON.stringify({
      access: { valid_until: validUntil.toISOString() },
      aspsp,
      state,
      redirect_url: redirectUrl,
      psu_type: "personal",
    }),
  });
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

export async function listAccountTransactions(accountUid: string): Promise<RemoteTransaction[]> {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 90);
  const dateFromStr = dateFrom.toISOString().slice(0, 10);

  const transactions: RemoteTransaction[] = [];
  let continuationKey: string | undefined;

  do {
    const query = new URLSearchParams({ date_from: dateFromStr });
    if (continuationKey) query.set("continuation_key", continuationKey);

    const page = await ebFetch<{ transactions: RemoteTransaction[]; continuation_key?: string }>(
      `/accounts/${accountUid}/transactions?${query.toString()}`
    );
    transactions.push(...page.transactions);
    continuationKey = page.continuation_key;
  } while (continuationKey);

  return transactions;
}
