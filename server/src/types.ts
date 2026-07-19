export interface Account {
  id: string;
  bank_connection_id: string | null;
  name: string;
  iban: string | null;
  currency: string;
  source: "enablebanking" | "manual";
  created_at: string;
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
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface Budget {
  id: number;
  category_id: number;
  monthly_limit: number;
  created_at: string;
}

export interface Debt {
  id: number;
  name: string;
  balance: number;
  apr: number;
  minimum_payment: number;
  created_at: string;
}

export interface SavingsGoal {
  id: number;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  created_at: string;
}

export interface BankConnection {
  id: string;
  institution_id: string;
  institution_name: string;
  country: string;
  status: "pending" | "linked" | "expired" | "error";
  created_at: string;
}
