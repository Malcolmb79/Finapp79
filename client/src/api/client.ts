const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
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
}

export interface Account {
  id: string;
  name: string;
  currency: string;
  source: "enablebanking" | "manual";
}

export interface Aspsp {
  name: string;
  country: string;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface Budget {
  id: number;
  category_id: number;
  category_name: string;
  monthly_limit: number;
  spent: number;
}

export const api = {
  listTransactions: (accountId?: string) =>
    request<Transaction[]>(`/transactions${accountId ? `?accountId=${accountId}` : ""}`),
  createTransaction: (tx: Partial<Transaction>) =>
    request<Transaction>("/transactions", { method: "POST", body: JSON.stringify(tx) }),
  updateTransaction: (id: string, patch: { category_id?: number | null; description?: string }) =>
    request<Transaction>(`/transactions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTransaction: (id: string) => request<void>(`/transactions/${id}`, { method: "DELETE" }),

  listAccounts: () => request<Account[]>("/accounts"),
  createAccount: (name: string, currency = "USD") =>
    request<Account>("/accounts", { method: "POST", body: JSON.stringify({ name, currency }) }),

  listCategories: () => request<Category[]>("/categories"),
  createCategory: (name: string, parentId?: number | null) =>
    request<Category>("/categories", { method: "POST", body: JSON.stringify({ name, parent_id: parentId ?? null }) }),

  listBudgets: () => request<Budget[]>("/budgets"),
  setBudget: (categoryId: number, monthlyLimit: number) =>
    request<Budget>("/budgets", { method: "POST", body: JSON.stringify({ category_id: categoryId, monthly_limit: monthlyLimit }) }),
  deleteBudget: (id: number) => request<void>(`/budgets/${id}`, { method: "DELETE" }),

  importCsv: (accountId: string, rows: { date: string; amount: number; description?: string }[]) =>
    request<{ imported: number; skipped: number }>("/import/csv", {
      method: "POST",
      body: JSON.stringify({ account_id: accountId, rows }),
    }),

  listInstitutions: (country: string) => request<Aspsp[]>(`/bank-link/institutions?country=${country}`),
  startBankLink: (aspspName: string, country: string) =>
    request<{ state: string; authorizationUrl: string }>("/bank-link/authorize", {
      method: "POST",
      body: JSON.stringify({ aspsp_name: aspspName, country }),
    }),
  completeBankLink: (code: string, state: string) =>
    request<{ linkedAccounts: string[] }>("/bank-link/sessions", {
      method: "POST",
      body: JSON.stringify({ code, state }),
    }),
  syncAccount: (accountId: string) =>
    request<{ synced: number; totalFetched: number }>(`/bank-link/accounts/${accountId}/sync`, { method: "POST" }),
};
