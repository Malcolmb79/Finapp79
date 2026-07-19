import { useCallback, useEffect, useState } from "react";
import CsvImport from "../components/CsvImport.js";
import TransactionForm from "../components/TransactionForm.js";
import TransactionTable from "../components/TransactionTable.js";
import { api, type Account, type Transaction } from "../api/client.js";

export default function Transactions() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const refresh = useCallback(() => {
    api.listTransactions().then(setTransactions);
  }, []);

  useEffect(() => {
    api.listAccounts().then(setAccounts);
    refresh();
  }, [refresh]);

  return (
    <div>
      <h1>Transactions</h1>
      {accounts.length === 0 ? (
        <p>Add an account or link a bank before adding transactions.</p>
      ) : (
        <>
          <TransactionForm accounts={accounts} onCreated={refresh} />
          <CsvImport accounts={accounts} onImported={refresh} />
        </>
      )}
      <TransactionTable transactions={transactions} onChange={refresh} />
    </div>
  );
}
