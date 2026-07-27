import { useEffect, useState } from "react";
import CashFlowCard, { type MonthFlow } from "../components/dashboard/CashFlowCard.js";
import MagnitudeBarList from "../components/dashboard/MagnitudeBarList.js";
import StatTile from "../components/dashboard/StatTile.js";
import { api, type Category, type Transaction } from "../api/client.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { inBase, useFxRates } from "../utils/fx.js";

const TREND_MONTHS = 12;

export default function Analytics() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    api.listTransactions().then(setTransactions);
    api.listCategories().then(setCategories);
  }, []);

  const rates = useFxRates("EUR");
  // Every figure on this page totals transactions from accounts that may be
  // in different currencies, so all of it works from amounts restated in one.
  const { items: convertedTx, dropped } = inBase(transactions, rates);
  const money = (value: number) => (rates ? formatCurrency(value, rates.base) : value.toFixed(2));

  const monthKeys = [...new Set(convertedTx.map((tx) => tx.booking_date.slice(0, 7)))].sort().slice(-TREND_MONTHS);
  const monthFlows: MonthFlow[] = monthKeys.map((key) => {
    const monthTx = convertedTx.filter((tx) => tx.booking_date.startsWith(key));
    return {
      label: key,
      income: monthTx.filter((tx) => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0),
      expenses: Math.abs(monthTx.filter((tx) => tx.amount < 0).reduce((s, tx) => s + tx.amount, 0)),
    };
  });

  const totalIncome = monthFlows.reduce((s, m) => s + m.income, 0);
  const totalExpenses = monthFlows.reduce((s, m) => s + m.expenses, 0);
  const avgMonthlyIncome = monthFlows.length > 0 ? totalIncome / monthFlows.length : 0;
  const avgMonthlyExpenses = monthFlows.length > 0 ? totalExpenses / monthFlows.length : 0;

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const totalSpend = convertedTx.filter((tx) => tx.amount < 0).reduce((s, tx) => s + Math.abs(tx.amount), 0);

  const categoryStats = new Map<string, { total: number; count: number }>();
  for (const tx of convertedTx) {
    if (tx.amount >= 0) continue;
    const name = tx.category_id != null ? (categoryNames.get(tx.category_id) ?? "Unknown") : "Uncategorized";
    const entry = categoryStats.get(name) ?? { total: 0, count: 0 };
    entry.total += Math.abs(tx.amount);
    entry.count += 1;
    categoryStats.set(name, entry);
  }
  const categoryRows = [...categoryStats.entries()].sort((a, b) => b[1].total - a[1].total);

  const merchantStats = new Map<string, { total: number; count: number }>();
  for (const tx of convertedTx) {
    if (tx.amount >= 0 || !tx.description) continue;
    const entry = merchantStats.get(tx.description) ?? { total: 0, count: 0 };
    entry.total += Math.abs(tx.amount);
    entry.count += 1;
    merchantStats.set(tx.description, entry);
  }
  const topMerchants = [...merchantStats.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p className="page-header__subtitle">
            Trends across the last {monthFlows.length || 0} month{monthFlows.length === 1 ? "" : "s"}
            {rates ? ` · converted to ${rates.base}` : ""}
            {/* Named rather than quietly omitted: a chart that silently drops
                a currency under-reports without ever looking wrong. */}
            {dropped.length > 0 ? ` · excludes ${dropped.join(", ")}, no rate available` : ""}
          </p>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card card--span-2">
          <div className="card__header">
            <h2 className="card__title">Income vs. expenses</h2>
          </div>
          <CashFlowCard income={totalIncome} expenses={totalExpenses} months={monthFlows} currency={rates?.base ?? null} />
        </div>

        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Monthly averages</h2>
          </div>
          <div className="stat-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <StatTile label="Avg income" value={money(avgMonthlyIncome)} />
            <StatTile label="Avg expenses" value={money(avgMonthlyExpenses)} />
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Spend by category</h2>
          </div>
          <MagnitudeBarList data={categoryRows.map(([label, s]) => ({ label, value: s.total }))} currency={rates?.base ?? null} />
        </div>

        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Category breakdown</h2>
          </div>
          {categoryRows.length === 0 ? (
            <p className="empty-state">Nothing to show yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Transactions</th>
                  <th>Total</th>
                  <th>% of spend</th>
                </tr>
              </thead>
              <tbody>
                {categoryRows.map(([name, s]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{s.count}</td>
                    <td>{money(s.total)}</td>
                    <td>{totalSpend > 0 ? ((s.total / totalSpend) * 100).toFixed(1) : "0.0"}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Top merchants</h2>
          </div>
          {topMerchants.length === 0 ? (
            <p className="empty-state">Nothing to show yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Transactions</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {topMerchants.map(([name, s]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{s.count}</td>
                    <td>{money(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
