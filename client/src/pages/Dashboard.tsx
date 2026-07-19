import { useEffect, useState } from "react";
import { api, type Transaction } from "../api/client.js";

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    api.listTransactions().then(setTransactions);
  }, []);

  const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const spend = transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0);

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Net total: {total.toFixed(2)}</p>
      <p>Total spend: {spend.toFixed(2)}</p>
      <p>{transactions.length} transactions recorded.</p>
    </div>
  );
}
