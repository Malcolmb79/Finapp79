import { useCallback, useEffect, useState } from "react";
import CategoryManager from "../components/CategoryManager.js";
import CsvImport from "../components/CsvImport.js";
import TransactionForm from "../components/TransactionForm.js";
import TransactionTable from "../components/TransactionTable.js";
import { api, type Account, type Category, type Transaction } from "../api/client.js";

export default function Transactions() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const refresh = useCallback(() => {
    api.listTransactions().then(setTransactions);
  }, []);

  const refreshCategories = useCallback(() => {
    api.listCategories().then(setCategories);
  }, []);

  useEffect(() => {
    api.listAccounts().then(setAccounts);
    refreshCategories();
    refresh();
  }, [refresh, refreshCategories]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p className="page-header__subtitle">{transactions.length} transaction{transactions.length === 1 ? "" : "s"}</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div className="card__header">
          <h2 className="card__title">Categories</h2>
        </div>
        <CategoryManager onCreated={refreshCategories} />
      </div>

      {accounts.length === 0 ? (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <p className="empty-state">Add an account or link a bank before adding transactions.</p>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="card__header">
            <h2 className="card__title">Add transactions</h2>
          </div>
          <TransactionForm accounts={accounts} categories={categories} onCreated={refresh} />
          <CsvImport accounts={accounts} onImported={refresh} />
        </div>
      )}

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">All transactions</h2>
        </div>
        <TransactionTable transactions={transactions} categories={categories} onChange={refresh} />
      </div>
    </div>
  );
}
