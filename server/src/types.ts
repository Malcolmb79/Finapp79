export interface Account {
  id: string;
  bank_connection_id: string | null;
  name: string;
  iban: string | null;
  currency: string;
  source: "gocardless" | "manual";
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
  source: "gocardless" | "manual" | "csv";
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface BankConnection {
  id: string;
  institution_id: string;
  institution_name: string;
  status: "pending" | "linked" | "expired" | "error";
  created_at: string;
}
