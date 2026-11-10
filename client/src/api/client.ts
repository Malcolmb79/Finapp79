const BASE = "/api";

// The account filter currently on screen, mirrored out of React so the plain
// request helper can reach it. Sent on every call rather than added to the few
// adviser endpoints by hand: an adviser that silently reasoned over accounts
// the screen has filtered out would give advice the user cannot check against
// anything in front of them, and that is exactly the kind of mistake that only
// shows up once someone acts on it.
let accountScope: string | null = null;

export function setRequestAccountScope(accountId: string | null) {
  accountScope = accountId;
}

/**
 * What to show a person when a request fails.
 *
 * Every route that can fail in a way the user could act on already words the
 * reason — "that PDF couldn't be opened", "if it's a scan rather than a text
 * PDF". Wrapping the raw body put `502: {"error":"..."}` on screen instead, so
 * the sentence written for the user arrived quoted, braced and prefixed with a
 * number that means nothing to them.
 *
 * The status is kept only where there is no message to show: a proxy error or
 * a crash mid-response has no JSON body, and "500" is then more use than an
 * empty string.
 */
async function errorMessage(res: Response): Promise<string> {
  const body = await res.text();
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.error === "string" && parsed.error) return parsed.error;
  } catch {
    // Not JSON — fall through to the raw body below.
  }
  return body.trim() ? `${res.status}: ${body}` : `Request failed (${res.status})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accountScope ? { "X-Account-Scope": accountScope } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface Transaction {
  id: string;
  account_id: string;
  category_id: number | null;
  booking_date: string;
  amount: number;
  currency: string;
  description: string | null;
  counterparty: string | null;
  source: "enablebanking" | "manual" | "csv";
  reviewed_at: string | null;
  /**
   * This transaction read by category: its parts, when one payment covers
   * several. Null when it is the ordinary single-category kind.
   */
  splits?: { category_id: number | null; amount: number }[] | null;
  /**
   * The loan this payment repays, when a rule says so.
   *
   * Derived by the server on every read rather than stored, so removing the
   * rule removes the attribution — see the server's transactionRules.ts.
   */
  repays_account_id?: string | null;
}

/** A standing instruction for what a transaction means. */
export interface TransactionRule {
  id: string;
  match_text: string;
  match_account_id: string | null;
  /** The loan these payments repay, if that is what the rule says. */
  repays_account_id: string | null;
  /** The category these go under, if that is what the rule says. */
  category_id: number | null;
}

export interface PendingTransaction extends Transaction {
  suggested_category_id: number | null;
  // "history" = the user has filed this merchant before; "ai" = a guess from
  // the categoriser that's worth a look before approving.
  suggestion_source: "rule" | "history" | "ai" | null;
}

/** One statement import, identified by exactly when it was done. */
export interface AccountImport {
  /** Doubles as the identifier: one import writes one timestamp. */
  importedAt: string;
  rows: number;
  firstDate: string;
  lastDate: string;
  total: number;
  /** Rows booked after today — the tell for a statement whose dates were misread. */
  futureDated: number;
}

export type AccountType = "current" | "savings" | "credit_card" | "loan";

export interface AdvisorMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PayoffResult {
  months: number | null;
  totalInterest: number;
  totalPaid: number;
  monthlyOutlay: number;
  neverClears: boolean;
  focusOrder: string[];
  /** Total owed at each month end, starting with today. For the curve. */
  balanceByMonth: number[];
  order: { name: string; monthCleared: number; interestPaid: number }[];
}

/** One account's payoff, simulated on its own payments. */
export interface DebtProjection {
  accountId: string;
  name: string;
  currency: string;
  balance: number;
  rate: number;
  /** Which assumption the projection used, when no payment is recorded. */
  accountType: AccountType;
  minimumPayment: number;
  /** True when no payment is recorded and a typical one is being assumed. */
  minimumIsAssumed: boolean;
  /** The extra monthly payment this projection was run with. */
  extra: number;
  minimums: PayoffResult;
  /** The same account with the extra payment aimed at it. Null when none was asked for. */
  withExtra: PayoffResult | null;
}

/** One payoff simulation behind an answer: what was asked for, and what it gave. */
export interface AdvisorWorking {
  input: unknown;
  result: unknown;
}

/** A figure read from a loan agreement, with the sentence it came from. */
export interface ExtractedField<T> {
  value: T;
  quote: string;
}

/** Anything else in the agreement worth knowing: fees, penalties, insurance. */
export interface KeyTerm {
  label: string;
  detail: string;
  quote: string;
}

export interface LoanTerms {
  principal: ExtractedField<number> | null;
  monthlyPayment: ExtractedField<number> | null;
  interestRate: ExtractedField<number> | null;
  startDate: ExtractedField<string> | null;
  endDate: ExtractedField<string> | null;
  termMonths: ExtractedField<number> | null;
  lender: string | null;
  currency: string | null;
  keyTerms: KeyTerm[];
  /** How many passes the document took to read — more than one means it was long. */
  passes: number;
  /**
   * "scan" when the document had no text in it and its pages were read as
   * images. The quotes are then a transcription rather than something matched
   * against the document's own text, which is worth saying on screen.
   */
  readFrom: "text" | "scan";
}

/**
 * Where a loan stands, read off a screenshot of the lender's own page.
 *
 * `balanceIncludesInterest` is the field to respect. A lender's "remaining
 * balance" is often the rest of the instalments rather than the outstanding
 * principal, and storing one as the other while also recording the rate
 * charges the interest twice. See server/src/services/loanStatus.ts.
 */
export interface LoanStatus {
  reference: string | null;
  lender: string | null;
  currency: string | null;
  remainingBalance: ExtractedField<number> | null;
  amountPaid: ExtractedField<number> | null;
  loanAmount: ExtractedField<number> | null;
  totalToRepay: ExtractedField<number> | null;
  monthlyPayment: ExtractedField<number> | null;
  interestRate: ExtractedField<number> | null;
  termMonths: ExtractedField<number> | null;
  startDate: ExtractedField<string> | null;
  endDate: ExtractedField<string> | null;
  nextPaymentAmount: ExtractedField<number> | null;
  nextPaymentDate: ExtractedField<string> | null;
  balanceIncludesInterest: boolean;
  readFrom: "image";
}

export interface Account {
  id: string;
  name: string;
  /** The account number the bank gave it, where there is one. */
  iban?: string | null;
  currency: string;
  source: "enablebanking" | "manual";
  /** Defaults to "current" for accounts created before types existed. */
  account_type?: AccountType;
  institution_name?: string | null;
  logo?: string | null;
  balance?: number | null;
  available_balance?: number | null;
  balance_synced_at?: string | null;
  loan_principal?: number | null;
  loan_monthly_payment?: number | null;
  /** Annual interest rate as a percentage: 11.5 means 11.5%. */
  loan_rate?: number | null;
  loan_start_date?: string | null;
  loan_end_date?: string | null;
  loan_term_months?: number | null;
  /** Set when the balance was entered by hand rather than synced from a bank. */
  balance_is_manual?: boolean;
  /** Arranged overdraft, stored positive: 45000 means the balance may reach -45000. */
  overdraft_limit?: number | null;
  /** Kept off every summary total, without deleting the account or its history. */
  hidden?: boolean;
  /** When a statement was last imported here. Null on accounts never imported to. */
  last_import_at?: string | null;
  /**
   * When the bank authorisation lapses. Ninety days from linking, which is
   * the regulatory ceiling, so every linked account needs reconnecting about
   * once a quarter.
   */
  access_valid_until?: string | null;
  /** When the nightly schedule last reached this account. */
  last_sync_at?: string | null;
  /** What went wrong the last time, if anything did. */
  last_sync_error?: string | null;
  /** The most recent transaction date any import brought in — how current the account is. */
  last_imported_date?: string | null;
}

// How a statement file's columns map onto this app's transaction shape. The
// server infers it, the user confirms or corrects it, and it comes back on
// the import request so what gets written is what they approved.
export interface StatementMapping {
  hasHeader: boolean;
  dateColumn: number;
  dateFormat: "iso" | "dmy" | "mdy";
  amountColumn: number | null;
  debitColumn: number | null;
  creditColumn: number | null;
  debitIsPositive: boolean;
  descriptionColumn: number | null;
  counterpartyColumn: number | null;
  decimalSeparator: "." | ",";
  // Flips every amount's sign — the user's correction for a statement whose
  // amounts are unsigned and money-out is implied rather than written.
  invertAmounts: boolean;
  source: "ai" | "heuristic";
  bankName: string | null;
  bankCountry: string | null;
  accountNumber: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

// Whether the statement belongs to the account it's being imported into, and
// what period it covers — neither is visible in a row-by-row preview, since
// the right statement imported into the wrong account parses perfectly.
export interface StatementCheck {
  accountNumber: string | null;
  /** Null when either side has no number — an unknown is not a mismatch. */
  accountMatches: boolean | null;
  periodStart: string | null;
  periodEnd: string | null;
  outsidePeriod: number;
}

export interface StatementPreview {
  mapping: StatementMapping;
  columns: { index: number; label: string }[];
  sample: { date: string; amount: number; description: string | null; counterparty: string | null }[];
  parsed: number;
  ignored: number;
  currency: string;
  // Counted across every parsed row, so the dialog can catch a statement that
  // came out all one direction.
  direction: { inflow: number; outflow: number };
  // The bank matched from the statement against Enable Banking's directory,
  // offered so the account can carry its real logo.
  detectedBank: { name: string; logo: string | null; country: string } | null;
  check: StatementCheck;
  // Aligned with `sample` by index: null where the row is new, otherwise the
  // transaction already on the account that it appears to repeat.
  duplicates: ({ id: string; date: string; amount: number; description: string | null } | null)[];
}

export interface Aspsp {
  name: string;
  country: string;
  logo?: string;
}

export interface FxRates {
  base: string;
  /** The ECB publication date these rates come from. */
  date: string;
  /** Units of each currency per one unit of base; the base itself is 1. */
  rates: Record<string, number>;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface BudgetProposal {
  category: string;
  /** Null when the category has no budget yet — the proposal creates one. */
  categoryId: number | null;
  monthlyLimit: number;
  currentLimit: number | null;
  /** Against what is typically spent, not against the old limit. */
  monthlySaving: number;
  typical: number;
  highest: number;
  /** What the history alone suggests, before any advice. */
  baseline: number;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface BudgetAdvice {
  summary: string;
  proposals: BudgetProposal[];
  analysis: {
    monthsCovered: string[];
    typicalIncome: number;
    typicalSpend: number;
    currency: string;
  };
  /** Currencies left out because no exchange rate was available. */
  dropped: string[];
}

export interface MonthlyPlanData {
  currency: string;
  monthsCovered: string[];
  typicalIncome: number;
  typicalSpend: number;
  /** What a typical month doesn't spend — the amount there is to allocate. */
  surplus: number;
  committedDebt: number;
  /**
   * Life policy premiums, split by whether the spending figures already saw
   * them. Only `unseen` was taken off the surplus — a premium already inside
   * typicalSpend would be charged twice if it were subtracted again.
   */
  premiums: {
    deducted: number;
    unseen: { policyId: string; name: string; monthly: number | null }[];
    alreadyInSpending: { policyId: string; name: string; monthly: number | null }[];
  };
  categories: { category: string; typical: number; volatility: number }[];
  debts: { id: string; name: string; currency: string; balance: number; rate: number; minimumPayment: number }[];
  goals: { id: number; name: string; target: number; saved: number; targetDate: string | null; remaining: number }[];
  dropped: string[];
}

/**
 * Which figure on a policy, if any, counts towards net worth.
 *
 * `surrender` is the policy's cash value — money you would actually receive,
 * and the only figure that behaves like an asset. `cover` is the sum assured,
 * which pays out on death rather than being held now; it is offered because the
 * choice is the user's, and shown with a caution wherever it is used.
 */
export type NetWorthSource = "none" | "surrender" | "cover";

export interface PolicyValuation {
  policy_id: string;
  valued_at: string;
  cover_amount: number | null;
  surrender_value: number | null;
}

export interface Policy {
  id: string;
  name: string;
  insurer: string | null;
  policy_number: string | null;
  currency: string;
  /** Sum assured — what pays out on death. Protection, not wealth. */
  cover_amount: number | null;
  /** Cash/fund value — what it is worth if cashed in today. */
  surrender_value: number | null;
  /** The statement date the two figures above were true on. */
  valued_at: string | null;
  premium: number | null;
  premium_frequency: "monthly" | "quarterly" | "annual" | null;
  start_date: string | null;
  maturity_date: string | null;
  net_worth_source: NetWorthSource;
  extract_json: string | null;
  created_at: string;
  /** Every confirmed statement, oldest first. */
  valuations: PolicyValuation[];
}

/**
 * One policy read out of a document, with the sentence each figure came from.
 *
 * A document yields a list of these: a life schedule regularly carries a death
 * benefit per life assured, and reading such a document into one set of fields
 * produced something that was neither of them — the cover of one benefit
 * beside the premium of both.
 */
export interface PolicyFacts {
  insurer: string | null;
  policyNumber: string | null;
  /** How the document names this benefit, when two share a policy number. */
  benefitName: string | null;
  currency: string | null;
  coverAmount: ExtractedField<number> | null;
  surrenderValue: ExtractedField<number> | null;
  premium: ExtractedField<number> | null;
  premiumFrequency: "monthly" | "quarterly" | "annual" | null;
  /**
   * A premium the document states only as one combined figure for several
   * benefits. Never divided between them — a schedule quoting one total has
   * not said what either costs, and splitting it would be inventing the
   * answer.
   */
  totalPremium: ExtractedField<number> | null;
  totalPremiumFrequency: "monthly" | "quarterly" | "annual" | null;
  /** How many policies the document described in all, this one included. */
  siblings: number;
  startDate: ExtractedField<string> | null;
  maturityDate: ExtractedField<string> | null;
  valuedAt: ExtractedField<string> | null;
  keyTerms: KeyTerm[];
  passes: number;
  /**
   * "scan" when the document had no text in it and its pages were read as
   * images. The quotes are then a transcription rather than something matched
   * against the document's own text, which is worth saying on screen.
   */
  readFrom: "text" | "scan";
}

export interface HoldingPrice {
  priced_at: string;
  unit_price: number;
}

export type HoldingKind = "equity" | "fund" | "bond" | "crypto" | "other";

/**
 * An investment holding. Quantity and price stay separate columns because
 * only the split says why a value moved - see utils/holdingValue.ts.
 */
export interface Holding {
  id: string;
  name: string;
  ticker: string | null;
  kind: HoldingKind;
  quantity: number;
  unit_cost: number | null;
  currency: string;
  created_at: string;
  /** Every price ever recorded, oldest first. */
  prices: HoldingPrice[];
}

export interface HouseholdShare {
  id: string;
  invited_email: string;
  role: "viewer" | "editor";
  status: string;
}

export interface HouseholdState {
  /** People you have shared your finances with. */
  shared: HouseholdShare[];
  /** People whose finances you can look at. */
  access: { owner_user_id: string; owner_name: string; role: "viewer" | "editor" }[];
  /** Whose finances you are currently looking at, if not your own. */
  viewing: string | null;
}

export interface PolicyDraft {
  name: string;
  insurer?: string | null;
  policy_number?: string | null;
  currency?: string;
  cover_amount?: number | null;
  surrender_value?: number | null;
  valued_at?: string | null;
  premium?: number | null;
  premium_frequency?: "monthly" | "quarterly" | "annual" | null;
  start_date?: string | null;
  maturity_date?: string | null;
  net_worth_source?: NetWorthSource;
  extract?: unknown;
}

export interface PlanSimulation {
  /** One entry per currency: debts in different ones are paid from different pockets. */
  debt: {
    currency: string;
    now: { months: number | null; totalInterest: number; neverClears: boolean };
    withExtra: { months: number | null; totalInterest: number; neverClears: boolean };
    monthsSaved: number | null;
    interestSaved: number;
    focusOrder: string[];
  }[];
  savings: { perMonth: number; months: number; total: number };
}

export interface Budget {
  id: number;
  category_id: number;
  category_name: string;
  monthly_limit: number;
  spent: number;
}

export interface Debt {
  id: number;
  name: string;
  balance: number;
  apr: number;
  minimum_payment: number;
}

export interface SavingsGoal {
  id: number;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
}

export interface AppUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  email_verified_at: string | null;
  /**
   * Set only while looking at somebody else's finances.
   *
   * Every figure on screen is then theirs, not yours, and the shell has to
   * say so — a partner's balance read as your own is the whole risk of
   * sharing.
   */
  viewingAs?: { ownerName: string; role: string };
  /** Who is actually signed in, when that differs from whose data this is. */
  signedInAs?: { id: string; name: string | null };
}

export interface AuthProviders {
  google: boolean;
  facebook: boolean;
}

export interface AuthIdentities {
  providers: string[];
  hasPassword: boolean;
}

/** A registered authenticator, as the management UI needs it — no key material. */
export interface Passkey {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const api = {
  getMe: () => request<AppUser>("/auth/me"),
  getAuthProviders: () => request<AuthProviders>("/auth/providers"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  signup: (email: string, password: string, name?: string) =>
    request<AppUser>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password, name }) }),
  login: (email: string, password: string) =>
    request<AppUser>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  getIdentities: () => request<AuthIdentities>("/auth/identities"),
  updateProfile: (name: string) => request<AppUser>("/auth/me", { method: "PATCH", body: JSON.stringify({ name }) }),
  setPassword: (newPassword: string, currentPassword?: string) =>
    request<void>("/auth/password", { method: "POST", body: JSON.stringify({ newPassword, currentPassword }) }),
  forgotPassword: (email: string) => request<void>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, newPassword: string) =>
    request<void>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) }),
  resendVerification: () => request<void>("/auth/resend-verification", { method: "POST" }),

  /**
   * Passkeys. The two "options" calls put a challenge in the session and the
   * matching "verify" spends it, so each pair has to run against the same
   * session — which is why they go through this helper like everything else
   * rather than a bare fetch.
   */
  /** `exclusive` is true once a passkey exists — the other methods retire then. */
  passkeysAvailable: () => request<{ available: boolean; exclusive: boolean }>("/passkeys/available"),
  /** With an email, this creates the account too — see utils/passkeys.ts. */
  passkeyRegisterOptions: (email?: string) =>
    request<unknown>("/passkeys/register/options", { method: "POST", body: JSON.stringify(email ? { email } : {}) }),
  passkeyRegisterVerify: (response: unknown, label: string) =>
    request<{ ok: true }>("/passkeys/register/verify", { method: "POST", body: JSON.stringify({ response, label }) }),
  passkeyAuthOptions: () => request<unknown>("/passkeys/authenticate/options", { method: "POST", body: "{}" }),
  passkeyAuthVerify: (response: unknown) =>
    request<AppUser>("/passkeys/authenticate/verify", { method: "POST", body: JSON.stringify({ response }) }),
  listPasskeys: () => request<Passkey[]>("/passkeys"),
  deletePasskey: (id: string) => request<void>(`/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listTransactions: (accountId?: string) =>
    request<Transaction[]>(`/transactions${accountId ? `?accountId=${accountId}` : ""}`),
  listPendingTransactions: () => request<PendingTransaction[]>("/transactions?pending=true"),

  // Keyed by transaction id, not position: the list can be re-fetched between
  // asking and applying, and an index would attach a category to the wrong row.
  categorisePending: () =>
    request<{
      suggestions: { id: string; categoryId: number | null; proposedCategory: string | null }[];
      proposed: string[];
      /** Why there are no suggestions, when there are none. Null on success. */
      note: string | null;
    }>("/transactions/categorise-pending", { method: "POST" }),
  createTransaction: (tx: Partial<Transaction>) =>
    request<Transaction>("/transactions", { method: "POST", body: JSON.stringify(tx) }),
  updateTransaction: (id: string, patch: { category_id?: number | null; description?: string }) =>
    request<Transaction>(`/transactions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  approveTransaction: (id: string, categoryId: number | null) =>
    request<Transaction>(`/transactions/${id}/approve`, { method: "POST", body: JSON.stringify({ category_id: categoryId }) }),
  bulkApproveTransactions: (items: { id: string; category_id: number | null }[]) =>
    request<{ approved: number }>("/transactions/bulk-approve", { method: "POST", body: JSON.stringify({ items }) }),
  deleteTransaction: (id: string) => request<void>(`/transactions/${id}`, { method: "DELETE" }),

  listAccounts: () => request<Account[]>("/accounts"),
  createAccount: (name: string, currency = "USD", account_type: AccountType = "current") =>
    request<Account>("/accounts", { method: "POST", body: JSON.stringify({ name, currency, account_type }) }),
  renameAccount: (id: string, name: string) =>
    request<Account>(`/accounts/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),

  // Pass null for either to clear it: a null balance hands the account back
  // to its transaction history, a null overdraft removes the facility.
  /**
   * Identifies the bank behind an account from the name it was given.
   * Writes nothing — the result is for the user to confirm.
   */
  detectAccountBank: (id: string) =>
    request<{
      name: string;
      logo: string | null;
      country: string | null;
      confidence: "high" | "medium" | "low";
      /** "directory" for a PSD2 match, otherwise the domain the logo came from. */
      source: string;
    } | null>(`/accounts/${id}/detect-bank`, { method: "POST" }),

  /**
   * Asks about paying down debt. Reads the user's accounts; writes nothing.
   *
   * `workings` is every payoff calculation the answer was built from, so a
   * figure in the reply can be checked against the simulation that produced it.
   */
  /**
   * The payoff curves, from the same simulator the adviser quotes.
   * `extras` maps an account id to an extra monthly payment aimed at it.
   */
  debtProjection: (extras: Record<string, number> = {}) =>
    request<DebtProjection[]>("/debt-advisor/projection", { method: "POST", body: JSON.stringify({ extras }) }),

  askDebtAdvisor: (messages: AdvisorMessage[]) =>
    request<{ reply: string; workings: AdvisorWorking[] }>("/debt-advisor", {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),

  /** Reads a loan agreement. Writes nothing — the terms come back for review. */
  previewLoanContract: (id: string, contentBase64: string) =>
    request<LoanTerms>(`/accounts/${id}/loan-contract/preview`, {
      method: "POST",
      body: JSON.stringify({ content_base64: contentBase64 }),
    }),

  /**
   * Reads a screenshot of a lender's loan page. Writes nothing — where the
   * loan stands comes back for review.
   */
  previewLoanStatus: (id: string, contentBase64: string) =>
    request<LoanStatus>(`/accounts/${id}/loan-status/preview`, {
      method: "POST",
      body: JSON.stringify({ content_base64: contentBase64 }),
    }),

  updateAccount: (
    id: string,
    patch: {
      balance?: number | null;
      overdraft_limit?: number | null;
      account_type?: AccountType;
      hidden?: boolean;
      logo?: string | null;
      institution_name?: string | null;
      loan_principal?: number | null;
      loan_monthly_payment?: number | null;
      loan_rate?: number | null;
      loan_term_months?: number | null;
      loan_start_date?: string | null;
      loan_end_date?: string | null;
    }
  ) =>
    request<Account>(`/accounts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteAccount: (id: string) => request<void>(`/accounts/${id}`, { method: "DELETE" }),

  // Clears an account's transactions but keeps the account. Omit `source` to
  // clear everything; pass "csv" to remove only statement imports and leave
  // bank-synced and manual history alone.
  clearAccountTransactions: (accountId: string, source?: "csv" | "enablebanking" | "manual") =>
    request<{ deleted: number }>(`/accounts/${accountId}/transactions${source ? `?source=${source}` : ""}`, {
      method: "DELETE",
    }),

  /** Every statement import done against an account, newest first. */
  listAccountImports: (accountId: string) => request<AccountImport[]>(`/accounts/${accountId}/imports`),

  /** Undoes one import, leaving the account's other imports alone. */
  deleteAccountImport: (accountId: string, importedAt: string) =>
    request<{ deleted: number }>(`/accounts/${accountId}/imports?at=${encodeURIComponent(importedAt)}`, {
      method: "DELETE",
    }),

  // ECB daily reference rates, so balances in different currencies can be
  // totalled into one figure.
  fxRates: (base = "EUR") => request<FxRates>(`/fx?base=${base}`),

  listCategories: () => request<Category[]>("/categories"),
  /** A starter set for an account with no categories. Writes nothing. */
  starterCategories: () => request<{ suggestions: string[]; hasAny: boolean }>("/categories/starter"),
  createCategory: (name: string, parentId?: number | null) =>
    request<Category>("/categories", { method: "POST", body: JSON.stringify({ name, parent_id: parentId ?? null }) }),

  listBudgets: () => request<Budget[]>("/budgets"),
  /**
   * Recommended monthly limits from spending history. Reads only — nothing is
   * applied until setBudget is called with a proposal the user accepted.
   */
  budgetAdvice: () => request<BudgetAdvice>("/budget-advisor"),

  /** Income against outgoings, with what is owed and saved towards. */
  monthlyPlan: () => request<MonthlyPlanData>("/plan"),

  /** What a given split of the spare does to the debt and the savings. */
  simulatePlan: (split: { toDebt: number; toSavings: number; months: number }) =>
    request<PlanSimulation>("/plan/simulate", { method: "POST", body: JSON.stringify(split) }),

  /**
   * Talks the budget through. Any figure settled on comes back as a proposal
   * with a button — the chat never sets a limit itself.
   */
  budgetChat: (messages: AdvisorMessage[]) =>
    request<{ reply: string; proposals: BudgetProposal[] }>("/budget-advisor/chat", {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),

  setBudget: (categoryId: number, monthlyLimit: number) =>
    request<Budget>("/budgets", { method: "POST", body: JSON.stringify({ category_id: categoryId, monthly_limit: monthlyLimit }) }),
  deleteBudget: (id: number) => request<void>(`/budgets/${id}`, { method: "DELETE" }),

  listPolicies: () => request<Policy[]>("/policies"),

  /** Reads a policy document. Writes nothing — the details come back for review. */
  previewPolicyDocument: (contentBase64: string) =>
    request<PolicyFacts[]>("/policies/preview", { method: "POST", body: JSON.stringify({ content_base64: contentBase64 }) }),

  household: () => request<HouseholdState>("/household"),
  inviteToHousehold: (email: string, role: "viewer" | "editor") =>
    request<{ ok: true }>("/household/invite", { method: "POST", body: JSON.stringify({ email, role }) }),
  acceptHouseholdInvite: (token: string) =>
    request<{ ok: true }>("/household/accept", { method: "POST", body: JSON.stringify({ token }) }),
  endHouseholdShare: (id: string) => request<void>(`/household/${id}`, { method: "DELETE" }),
  /** Passing null returns you to your own figures. */
  viewHousehold: (userId: string | null) =>
    request<{ viewing: string | null }>("/household/view", { method: "POST", body: JSON.stringify({ userId }) }),

  listHoldings: () => request<Holding[]>("/holdings"),
  createHolding: (draft: {
    name: string;
    ticker?: string | null;
    kind?: HoldingKind;
    quantity: number;
    unit_cost?: number | null;
    currency?: string;
    unit_price?: number;
    priced_at?: string;
  }) => request<Holding>("/holdings", { method: "POST", body: JSON.stringify(draft) }),
  updateHolding: (id: string, patch: Partial<{ name: string; ticker: string | null; kind: HoldingKind; quantity: number; unit_cost: number | null }>) =>
    request<Holding>(`/holdings/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  /** Appends a price, keeping every earlier one — that history is what lets the trend be honest. */
  priceHolding: (id: string, unit_price: number, priced_at?: string) =>
    request<Holding>(`/holdings/${id}/price`, { method: "POST", body: JSON.stringify({ unit_price, priced_at }) }),
  deleteHolding: (id: string) => request<void>(`/holdings/${id}`, { method: "DELETE" }),

  listRules: () => request<TransactionRule[]>("/rules"),
  createRule: (rule: {
    match_text: string;
    match_account_id: string | null;
    repays_account_id?: string;
    category_id?: number;
  }) => request<TransactionRule>("/rules", { method: "POST", body: JSON.stringify(rule) }),

  /** Files everything already uncategorized that this rule matches. */
  applyRule: (id: string) => request<{ filed: number }>(`/rules/${id}/apply`, { method: "POST" }),
  deleteRule: (id: string) => request<void>(`/rules/${id}`, { method: "DELETE" }),

  /** Replaces a transaction's splits; an empty list makes it ordinary again. */
  setSplits: (id: string, splits: { category_id: number | null; amount: number }[]) =>
    request<{ splits: { category_id: number | null; amount: number }[] | null }>(`/transactions/${id}/splits`, {
      method: "PUT",
      body: JSON.stringify({ splits }),
    }),

  createPolicy: (draft: PolicyDraft) => request<Policy>("/policies", { method: "POST", body: JSON.stringify(draft) }),
  updatePolicy: (id: string, patch: Partial<PolicyDraft>) =>
    request<Policy>(`/policies/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /**
   * Records a newer statement against a policy, keeping the earlier ones.
   *
   * `premium` is optional and updates the policy rather than the history — a
   * premium is what the policy costs from here on, not what it was worth on a
   * date. Omitted, the recorded premium is left alone.
   */
  addPolicyValuation: (
    id: string,
    valuation: {
      valued_at: string;
      cover_amount: number | null;
      surrender_value: number | null;
      premium?: number | null;
      premium_frequency?: "monthly" | "quarterly" | "annual" | null;
    }
  ) => request<Policy>(`/policies/${id}/valuations`, { method: "POST", body: JSON.stringify(valuation) }),

  deletePolicy: (id: string) => request<void>(`/policies/${id}`, { method: "DELETE" }),

  listDebts: () => request<Debt[]>("/debts"),
  createDebt: (debt: { name: string; balance: number; apr: number; minimum_payment: number }) =>
    request<Debt>("/debts", { method: "POST", body: JSON.stringify(debt) }),
  updateDebt: (id: number, patch: Partial<{ name: string; balance: number; apr: number; minimum_payment: number }>) =>
    request<Debt>(`/debts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteDebt: (id: number) => request<void>(`/debts/${id}`, { method: "DELETE" }),

  listSavingsGoals: () => request<SavingsGoal[]>("/savings"),
  createSavingsGoal: (goal: { name: string; target_amount: number; target_date?: string | null }) =>
    request<SavingsGoal>("/savings", { method: "POST", body: JSON.stringify(goal) }),
  contributeSavingsGoal: (id: number, amount: number) =>
    request<SavingsGoal>(`/savings/${id}/contribute`, { method: "POST", body: JSON.stringify({ amount }) }),
  deleteSavingsGoal: (id: number) => request<void>(`/savings/${id}`, { method: "DELETE" }),

  // Two-step statement import: preview works out (or re-applies) the layout
  // and shows what it produces without writing anything; importStatement then
  // commits using the mapping the user approved. Passing a mapping to preview
  // skips inference, so editing the mapping re-previews without another model
  // call.
  // The file goes up as base64 bytes rather than text so PDFs survive the
  // trip intact — the server decides CSV vs PDF from the content, since bank
  // exports are routinely delivered with the wrong extension or none at all.
  previewStatement: (accountId: string, contentBase64: string, mapping?: StatementMapping) =>
    request<StatementPreview>("/import/statement/preview", {
      method: "POST",
      body: JSON.stringify({ account_id: accountId, content_base64: contentBase64, mapping }),
    }),

  // Categories are sent aligned by index with the preview's rows; the server
  // re-derives the rows from the same content and mapping, so only the
  // choices travel, never the transactions.
  importStatement: (
    accountId: string,
    contentBase64: string,
    mapping: StatementMapping,
    applyBankLogo = false,
    categories: (number | null)[] = [],
    skip: boolean[] = []
  ) =>
    request<{ imported: number; skipped: number; duplicates: number; parsed: number; brandedAs: string | null }>(
      "/import/statement",
      {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          content_base64: contentBase64,
          mapping,
          apply_bank_logo: applyBankLogo,
          categories,
          skip,
        }),
      }
    ),

  categoriseStatement: (accountId: string, contentBase64: string, mapping: StatementMapping) =>
    request<{ suggestions: { categoryId: number | null; proposedCategory: string | null }[]; proposed: string[] }>(
      "/import/statement/categorise",
      {
        method: "POST",
        body: JSON.stringify({ account_id: accountId, content_base64: contentBase64, mapping }),
      }
    ),

  listInstitutions: (country: string) => request<Aspsp[]>(`/bank-link/institutions?country=${country}`),
  startBankLink: (aspspName: string, country: string, logo?: string) =>
    request<{ state: string; authorizationUrl: string }>("/bank-link/authorize", {
      method: "POST",
      body: JSON.stringify({ aspsp_name: aspspName, country, logo }),
    }),
  completeBankLink: (code: string, state: string) =>
    request<{ linkedAccounts: string[] }>("/bank-link/sessions", {
      method: "POST",
      body: JSON.stringify({ code, state }),
    }),
  /**
   * Pulls new transactions. `full` re-asks for everything the bank still
   * offers instead of starting from the newest one held — the way to fill a
   * gap left behind by a run of failed syncs. `incomplete` comes back when
   * the bank failed partway and this is only some of it.
   */
  syncAccount: (accountId: string, full = false) =>
    request<{ synced: number; totalFetched: number; incomplete?: string }>(
      `/bank-link/accounts/${accountId}/sync${full ? "?full=true" : ""}`,
      { method: "POST" }
    ),
};
