import { ArrowLeftRight, BarChart3, Calculator, CreditCard, PieChart, PiggyBank, Receipt, Repeat, Store, Table, TrendingUp } from "lucide-react";
import DonutChart from "../components/dashboard/DonutChart.js";
import Subscriptions from "../components/dashboard/Subscriptions.js";
import TrendLine from "../components/dashboard/TrendLine.js";
import WidgetCanvas, { type WidgetSpec } from "../components/dashboard/WidgetCanvas.js";
import { useEffect, useState } from "react";
import CashFlowCard, { type MonthFlow } from "../components/dashboard/CashFlowCard.js";
import MagnitudeBarList from "../components/dashboard/MagnitudeBarList.js";
import StatTile from "../components/dashboard/StatTile.js";
import { api, type Account, type Category, type Transaction } from "../api/client.js";
import { visibleTransactions } from "../utils/accountBalance.js";
import { useAccountScope, useDateRange } from "../contexts/ViewFilterContext.js";
import { dateRangeLabel, rangeMonthCount, withinRange } from "../utils/dateRange.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { inBase, useFxRates } from "../utils/fx.js";
import { cleanDescription } from "../utils/cleanDescription.js";
import { detectRecurring } from "../utils/recurring.js";

const TREND_MONTHS = 12;

/** "2026-07" as "Jul 26" — a bare key is unreadable on an axis. */
function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
}

export default function Analytics() {
  const [allTransactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  // Loaded only to know which accounts are hidden: their spending has to leave
  // these figures with them, or the page reports spending from an account the
  // rest of the app has been told to ignore.
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    api.listTransactions().then(setTransactions);
    api.listCategories().then(setCategories);
    api.listAccounts().then(setAccounts);
  }, []);

  const { scope } = useAccountScope();
  const { range } = useDateRange();
  const rates = useFxRates("EUR");
  // Every figure on this page totals transactions from accounts that may be
  // in different currencies, so all of it works from amounts restated in one.
  const { items: convertedTx, dropped } = inBase(withinRange(visibleTransactions(allTransactions, accounts, scope), range), rates);
  const money = (value: number) => (rates ? formatCurrency(value, rates.base) : value.toFixed(2));

  // The twelve-month series the trend charts are drawn from. Deliberately not
  // cut to the range: a line or a bar chart over a single month is one point,
  // and the two trend widgets would go blank on the default view.
  const monthKeys = [...new Set(convertedTx.map((tx) => tx.booking_date.slice(0, 7)))].sort().slice(-TREND_MONTHS);
  const monthFlows: MonthFlow[] = monthKeys.map((key) => {
    const monthTx = convertedTx.filter((tx) => tx.booking_date.startsWith(key));
    return {
      label: monthLabel(key),
      income: monthTx.filter((tx) => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0),
      expenses: Math.abs(monthTx.filter((tx) => tx.amount < 0).reduce((s, tx) => s + tx.amount, 0)),
    };
  });

  // Driven by the header's period filter rather than a control of its own:
  // this page had its own, and two date pickers filtering one page is a way
  // to be confidently wrong about which one a chart obeyed.
  const selectedMonths = rangeMonthCount(range);
  // Everything that is a total — spend, share, largest, recurring — is cut to
  // the chosen span. Trends keep their full series and say so.
  const rangeMonths = selectedMonths == null ? monthKeys : monthKeys.slice(-selectedMonths);
  const inRange = (date: string) => selectedMonths == null || rangeMonths.includes(date.slice(0, 7));
  const rangedTx = convertedTx.filter((tx) => inRange(tx.booking_date));
  // Matched on the month keys rather than the labels, which are now formatted
  // for reading and no longer look like "2026-07".
  const rangedFlows = monthFlows.filter((_, i) => selectedMonths == null || rangeMonths.includes(monthKeys[i]));

  const totalIncome = rangedFlows.reduce((s, m) => s + m.income, 0);
  const totalExpenses = rangedFlows.reduce((s, m) => s + m.expenses, 0);
  const avgMonthlyIncome = rangedFlows.length > 0 ? totalIncome / rangedFlows.length : 0;
  const avgMonthlyExpenses = rangedFlows.length > 0 ? totalExpenses / rangedFlows.length : 0;

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const totalSpend = rangedTx.filter((tx) => tx.amount < 0).reduce((s, tx) => s + Math.abs(tx.amount), 0);

  const categoryStats = new Map<string, { total: number; count: number }>();
  for (const tx of rangedTx) {
    if (tx.amount >= 0) continue;
    const name = tx.category_id != null ? (categoryNames.get(tx.category_id) ?? "Unknown") : "Uncategorized";
    const entry = categoryStats.get(name) ?? { total: 0, count: 0 };
    entry.total += Math.abs(tx.amount);
    entry.count += 1;
    categoryStats.set(name, entry);
  }
  const categoryRows = [...categoryStats.entries()].sort((a, b) => b[1].total - a[1].total);

  const merchantStats = new Map<string, { total: number; count: number }>();
  for (const tx of rangedTx) {
    if (tx.amount >= 0 || !tx.description) continue;
    const entry = merchantStats.get(tx.description) ?? { total: 0, count: 0 };
    entry.total += Math.abs(tx.amount);
    entry.count += 1;
    merchantStats.set(tx.description, entry);
  }
  const topMerchants = [...merchantStats.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);

  // Savings rate: the share of what came in that didn't go out. The headline
  // number most personal finance tools lead with, and the one that says
  // whether a month worked — a high income month with higher spending is not
  // a good month, and neither total alone shows that.
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : null;
  const monthlySavings = monthFlows.map((m) => ({
    label: m.label,
    rate: m.income > 0 ? ((m.income - m.expenses) / m.income) * 100 : null,
    saved: m.income - m.expenses,
  }));
  const bestMonth = [...monthlySavings].filter((m) => m.rate != null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];

  // This month against last, by category. A total tells you what you spent;
  // the change tells you what moved, which is what a monthly review is
  // actually looking for.
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const lastMonthDate = new Date();
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonthKey = lastMonthDate.toISOString().slice(0, 7);

  const spendIn = (monthKey: string) => {
    const totals = new Map<string, number>();
    for (const tx of convertedTx) {
      if (tx.amount >= 0 || !tx.booking_date.startsWith(monthKey)) continue;
      const name = tx.category_id != null ? (categoryNames.get(tx.category_id) ?? "Unknown") : "Uncategorized";
      totals.set(name, (totals.get(name) ?? 0) + Math.abs(tx.amount));
    }
    return totals;
  };
  const thisMonthSpend = spendIn(thisMonthKey);
  const lastMonthSpend = spendIn(lastMonthKey);
  const movers = [...new Set([...thisMonthSpend.keys(), ...lastMonthSpend.keys()])]
    .map((name) => {
      const now = thisMonthSpend.get(name) ?? 0;
      const before = lastMonthSpend.get(name) ?? 0;
      return { name, now, before, change: now - before };
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 8);

  // Recurrence needs the full history to find a rhythm — three charges
  // inside one month is not a monthly subscription.
  const recurring = detectRecurring(convertedTx);
  const recurringAnnual = recurring.reduce((sum, r) => sum + r.annualised, 0);

  // The individual charges worth a second look. A category total hides a
  // single large payment inside a month of small ones.
  const largest = [...rangedTx]
    .filter((tx) => tx.amount < 0)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 8);

  // Each entry is a widget the page offers: what it is called, how big it
  // starts, and what it draws. Adding a report here is all it takes for it to
  // appear in the Add widget menu.
  const widgets: WidgetSpec[] = [
    {
      id: "cashflow",
      title: "Income vs. expenses — last 12 months",
      icon: ArrowLeftRight,
      accentVar: "--accent",
      defaultWidth: 672,
      defaultHeight: 340,
      render: () => <CashFlowCard income={totalIncome} expenses={totalExpenses} months={monthFlows} currency={rates?.base ?? null} />,
    },
    {
      id: "savingsRate",
      title: "Savings rate",
      headerExtra: <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{dateRangeLabel(range).toLowerCase()}</span>,
      icon: PiggyBank,
      accentVar: "--accent-2",
      defaultWidth: 328,
      defaultHeight: 320,
      render: () =>
        savingsRate == null ? (
          <p className="empty-state">No income recorded yet.</p>
        ) : (
          <>
            <p className="stat-tile__value" style={{ fontSize: "1.8rem", color: savingsRate >= 0 ? "var(--good)" : "var(--critical)" }}>
              {savingsRate.toFixed(1)}%
            </p>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
              {money(totalIncome - totalExpenses)} kept of {money(totalIncome)}
              {bestMonth?.rate != null && ` · best ${bestMonth.label} at ${bestMonth.rate.toFixed(0)}%`}
            </p>
            <TrendLine points={monthlySavings.map((m) => ({ label: m.label, value: m.rate }))} format={(v) => `${v.toFixed(1)}%`} />
          </>
        ),
    },
    {
      id: "categoryShare",
      title: "Share of spending",
      icon: PieChart,
      accentVar: "--accent-3",
      defaultWidth: 328,
      defaultHeight: 320,
      render: () => <DonutChart data={categoryRows.map(([label, s]) => ({ label, value: s.total }))} currency={rates?.base ?? null} />,
    },
    {
      id: "categoryBars",
      title: "Spend by category",
      icon: BarChart3,
      accentVar: "--accent-4",
      defaultWidth: 328,
      defaultHeight: 320,
      render: () => <MagnitudeBarList data={categoryRows.map(([label, s]) => ({ label, value: s.total }))} currency={rates?.base ?? null} />,
    },
    {
      id: "movers",
      title: "What moved this month",
      icon: TrendingUp,
      accentVar: "--accent-2",
      defaultWidth: 328,
      defaultHeight: 320,
      render: () =>
        movers.length === 0 ? (
          <p className="empty-state">Nothing to compare yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Now</th>
                <th>Was</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {movers.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td>{money(m.now)}</td>
                  <td>{money(m.before)}</td>
                  <td style={{ color: m.change > 0 ? "var(--critical)" : "var(--good)" }}>
                    {m.change > 0 ? "+" : ""}
                    {money(m.change)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
    },
    {
      id: "subscriptions",
      title: "Subscriptions",
      icon: CreditCard,
      accentVar: "--accent-2",
      defaultWidth: 672,
      defaultHeight: 460,
      render: () => <Subscriptions payments={recurring} currency={rates?.base ?? "EUR"} />,
    },
    {
      id: "recurring",
      title: "Recurring payments",
      icon: Repeat,
      accentVar: "--accent",
      defaultWidth: 672,
      defaultHeight: 340,
      // The same findings as Subscriptions above, as a flat table. Offered
      // rather than shown, since two views of one thing on by default is
      // clutter.
      optional: true,
      render: () =>
        recurring.length === 0 ? (
          <p className="empty-state">Nothing charging on a regular rhythm yet.</p>
        ) : (
          <>
            <p style={{ fontSize: "0.8rem", margin: "0 0 0.5rem" }}>
              <strong>{money(recurringAnnual)}</strong> a year committed across {recurring.length}
              {recurring.length === 1 ? " payment" : " payments"}
            </p>
            <table>
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Every</th>
                  <th>Amount</th>
                  <th>A year</th>
                </tr>
              </thead>
              <tbody>
                {recurring.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>{r.cadence}</td>
                    <td>{money(r.amount)}</td>
                    <td>{money(r.annualised)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ),
    },
    {
      id: "averages",
      title: "Monthly averages",
      icon: Calculator,
      accentVar: "--accent-3",
      defaultWidth: 328,
      defaultHeight: 200,
      render: () => (
        <div className="stat-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <StatTile label="Avg income" value={money(avgMonthlyIncome)} />
          <StatTile label="Avg expenses" value={money(avgMonthlyExpenses)} />
        </div>
      ),
    },
    {
      id: "largest",
      title: "Largest payments",
      icon: Receipt,
      accentVar: "--accent-4",
      defaultWidth: 328,
      defaultHeight: 320,
      render: () =>
        largest.length === 0 ? (
          <p className="empty-state">Nothing to show yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Payment</th>
                <th>Date</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {largest.map((tx) => (
                <tr key={tx.id}>
                  <td>{cleanDescription(tx.description) || tx.counterparty || "Transaction"}</td>
                  <td>{tx.booking_date}</td>
                  <td>{money(Math.abs(tx.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
    },
    {
      id: "categoryTable",
      title: "Category breakdown",
      icon: Table,
      accentVar: "--accent-2",
      defaultWidth: 672,
      defaultHeight: 360,
      // Offered rather than shown by default: the same figures as the chart,
      // in a form for reading off rather than scanning.
      optional: true,
      render: () =>
        categoryRows.length === 0 ? (
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
        ),
    },
    {
      id: "merchants",
      title: "Top merchants",
      icon: Store,
      accentVar: "--accent-3",
      defaultWidth: 328,
      defaultHeight: 320,
      optional: true,
      render: () =>
        topMerchants.length === 0 ? (
          <p className="empty-state">Nothing to show yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Count</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {topMerchants.map(([name, s]) => (
                <tr key={name}>
                  <td>{cleanDescription(name)}</td>
                  <td>{s.count}</td>
                  <td>{money(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p className="page-header__subtitle">
            {/* The span is stated rather than assumed: the same chart means
                something different over a month and over a year. */}
            {dateRangeLabel(range)}
            {rates ? ` · converted to ${rates.base}` : ""}
            {/* Named rather than quietly omitted: a chart that silently drops
                a currency under-reports without ever looking wrong. */}
            {dropped.length > 0 ? ` · excludes ${dropped.join(", ")}, no rate available` : ""}
            {" · hold a card to move or resize it"}
          </p>
        </div>
      </div>

      <WidgetCanvas storageKey="analytics.layout.v1" widgets={widgets} />
    </div>
  );
}
