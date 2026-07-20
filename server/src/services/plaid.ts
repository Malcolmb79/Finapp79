import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";
import type { Transaction as PlaidTransaction } from "plaid";

/**
 * The only place that talks to the Plaid API. Auth is a client_id/secret
 * pair sent as headers on every request (set once here via baseOptions),
 * unlike Enable Banking's per-request signed JWT — Plaid's secret is
 * environment-scoped (sandbox vs production) via PLAID_ENV, matching
 * PlaidEnvironments' basePath.
 */
const client = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV ?? "sandbox"],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
        "PLAID-SECRET": process.env.PLAID_SECRET,
      },
    },
  })
);

// Broad default coverage (GB/IE first, since that's what this app actually
// needs) — Plaid still only shows institutions you're approved for, so this
// list doesn't grant access by itself, it just says which markets Link is
// allowed to search across.
const COUNTRY_CODES = [
  CountryCode.Gb,
  CountryCode.Ie,
  CountryCode.Us,
  CountryCode.Fr,
  CountryCode.De,
  CountryCode.Es,
  CountryCode.Nl,
  CountryCode.Be,
  CountryCode.Pt,
  CountryCode.At,
  CountryCode.Se,
  CountryCode.Fi,
  CountryCode.Dk,
  CountryCode.No,
  CountryCode.Pl,
];

export async function createLinkToken(userId: string, redirectUri: string | undefined): Promise<string> {
  const { data } = await client.linkTokenCreate({
    client_name: "Personal Finance",
    language: "en",
    country_codes: COUNTRY_CODES,
    user: { client_user_id: userId },
    products: [Products.Transactions],
    redirect_uri: redirectUri,
  });
  return data.link_token;
}

export async function exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
  const { data } = await client.itemPublicTokenExchange({ public_token: publicToken });
  return { accessToken: data.access_token, itemId: data.item_id };
}

export interface InstitutionInfo {
  name: string;
  logo: string | null;
  country: string;
}

export async function getInstitution(institutionId: string): Promise<InstitutionInfo> {
  const { data } = await client.institutionsGetById({
    institution_id: institutionId,
    country_codes: COUNTRY_CODES,
    options: { include_optional_metadata: true },
  });
  return {
    name: data.institution.name,
    // Plaid returns the logo as base64 PNG data directly rather than a
    // hotlinkable URL (Enable Banking's approach) — render as a data: URI.
    logo: data.institution.logo ? `data:image/png;base64,${data.institution.logo}` : null,
    country: data.institution.country_codes[0] ?? "",
  };
}

export interface PlaidAccountBalance {
  accountId: string;
  name: string;
  currency: string | null;
  current: number | null;
  available: number | null;
}

export async function getAccountBalances(accessToken: string): Promise<PlaidAccountBalance[]> {
  const { data } = await client.accountsBalanceGet({ access_token: accessToken });
  return data.accounts.map((a) => ({
    accountId: a.account_id,
    name: a.name,
    currency: a.balances.iso_currency_code,
    current: a.balances.current,
    available: a.balances.available,
  }));
}

export interface SyncResult {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: string[];
  nextCursor: string;
}

// Cursor-based, unlike Enable Banking's fixed 90-day window -- pages
// through every batch internally (Plaid's own docs: "if has_more is true,
// it's important to pull all available pages") so callers just get the
// full delta since the last cursor in one call.
export async function syncTransactions(accessToken: string, cursor: string | null): Promise<SyncResult> {
  const added: PlaidTransaction[] = [];
  const modified: PlaidTransaction[] = [];
  const removed: string[] = [];
  let nextCursor = cursor ?? undefined;
  let hasMore = true;

  while (hasMore) {
    const { data } = await client.transactionsSync({ access_token: accessToken, cursor: nextCursor });
    added.push(...data.added);
    modified.push(...data.modified);
    removed.push(...data.removed.map((r) => r.transaction_id));
    nextCursor = data.next_cursor;
    hasMore = data.has_more;
  }

  return { added, modified, removed, nextCursor: nextCursor! };
}
