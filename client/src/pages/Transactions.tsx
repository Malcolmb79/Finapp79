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
      <h1>Transactions</h1>
      <CategoryManager onCreated={refreshCategories} />
      {accounts.length === 0 ? (
        <p>Add an account or link a bank before adding transactions.</p>
      ) : (
        <>
          <TransactionForm accounts={accounts} categories={categories} onCreated={refresh} />
          <CsvImport accounts={accounts} onImported={refresh} />
        </>
      )}
      <TransactionTable transactions={transactions} categories={categories} onChange={refresh} />
    </div>
  );
}
