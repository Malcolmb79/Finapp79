import { useEffect, useState } from "react";
import { api, type Account, type Category, type Transaction } from "../api/client.js";

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <div style={{ background: "#eee", height: 8, borderRadius: 4 }}>
        <div style={{ width: `${pct}%`, background: "#3b6", height: 8, borderRadius: 4 }} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    api.listTransactions().then(setTransactions);
    api.listAccounts().then(setAccounts);
    api.listCategories().then(setCategories);
  }, []);

  const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const spend = transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0);

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const spendByCategory = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    const name = tx.category_id != null ? (categoryNames.get(tx.category_id) ?? "Unknown") : "Uncategorized";
    spendByCategory.set(name, (spendByCategory.get(name) ?? 0) + Math.abs(tx.amount));
  }
  const categoryRows = [...spendByCategory.entries()].sort((a, b) => b[1] - a[1]);
  const maxCategorySpend = Math.max(0, ...categoryRows.map(([, v]) => v));

  const byMonth = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    const month = tx.booking_date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + Math.abs(tx.amount));
  }
  const monthRows = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
  const maxMonthSpend = Math.max(0, ...monthRows.map(([, v]) => v));

  const byAccount = new Map<string, number>();
  for (const tx of transactions) {
    byAccount.set(tx.account_id, (byAccount.get(tx.account_id) ?? 0) + tx.amount);
  }
  const accountRows = accounts.map((a) => ({ name: a.name, balance: byAccount.get(a.id) ?? 0 }));

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Net total: {total.toFixed(2)}</p>
      <p>Total spend: {spend.toFixed(2)}</p>
      <p>{transactions.length} transactions recorded.</p>

      {accountRows.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Accounts</h2>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {accountRows.map((a) => (
                <tr key={a.name}>
                  <td style={{ paddingRight: "1rem" }}>{a.name}</td>
                  <td align="right">{a.balance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {categoryRows.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Spend by category</h2>
          {categoryRows.map(([name, value]) => (
            <BarRow key={name} label={name} value={value} max={maxCategorySpend} />
          ))}
        </section>
      )}

      {monthRows.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Spend by month</h2>
          {monthRows.map(([month, value]) => (
            <BarRow key={month} label={month} value={value} max={maxMonthSpend} />
          ))}
        </section>
      )}
    </div>
  );
}
