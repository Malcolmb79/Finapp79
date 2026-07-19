/**
 * Thin client for GoCardless Bank Account Data (formerly Nordigen).
 * Docs: https://developer.gocardless.com/bank-account-data/overview
 *
 * Flow: token -> pick institution -> create requisition (returns a bank
 * authorization link) -> user authorizes at their bank -> poll requisition
 * for linked account ids -> pull balances/transactions per account.
 */

const API_BASE = "https://bankaccountdata.gocardless.com/api/v2";

let cachedToken: { access: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.access;
  }

  const res = await fetch(`${API_BASE}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret_id: process.env.GOCARDLESS_SECRET_ID,
      secret_key: process.env.GOCARDLESS_SECRET_KEY,
    }),
  });

  if (!res.ok) {
    throw new Error(`GoCardless auth failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access: string; access_expires: number };
  cachedToken = { access: data.access, expiresAt: Date.now() + data.access_expires * 1000 - 30_000 };
  return data.access;
}

async function gcFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`GoCardless request failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

export interface Institution {
  id: string;
  name: string;
  bic: string;
  countries: string[];
}

export function listInstitutions(country: string): Promise<Institution[]> {
  return gcFetch<Institution[]>(`/institutions/?country=${encodeURIComponent(country)}`);
}

export interface Requisition {
  id: string;
  link: string;
  status: string;
  accounts: string[];
}

export function createRequisition(institutionId: string): Promise<Requisition> {
  return gcFetch<Requisition>("/requisitions/", {
    method: "POST",
    body: JSON.stringify({
      redirect: process.env.GOCARDLESS_REDIRECT_URL,
      institution_id: institutionId,
    }),
  });
}

export function getRequisition(requisitionId: string): Promise<Requisition> {
  return gcFetch<Requisition>(`/requisitions/${requisitionId}/`);
}

export interface RemoteTransaction {
  transactionId: string;
  bookingDate: string;
  transactionAmount: { amount: string; currency: string };
  remittanceInformationUnstructured?: string;
  creditorName?: string;
  debtorName?: string;
}

export function getAccountTransactions(accountId: string): Promise<{
  transactions: { booked: RemoteTransaction[]; pending: RemoteTransaction[] };
}> {
  return gcFetch(`/accounts/${accountId}/transactions/`);
}

export function getAccountDetails(accountId: string): Promise<{
  account: { iban?: string; currency: string; name?: string };
}> {
  return gcFetch(`/accounts/${accountId}/details/`);
}
