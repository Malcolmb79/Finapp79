import { ArrowLeftRight, BarChart3, Calculator, CreditCard, PieChart, PiggyBank, Receipt, Repeat, Store, Table, TrendingUp } from "lucide-react";
import DonutChart from "../components/dashboard/DonutChart.js";
import PriceRises from "../components/dashboard/PriceRises.js";
import Subscriptions from "../components/dashboard/Subscriptions.js";
import TrendLine from "../components/dashboard/TrendLine.js";
import WidgetCanvas, { type WidgetSpec } from "../components/dashboard/WidgetCanvas.js";
import { useEffect, useState } from "react";
import CashFlowCard, { type MonthFlow } from "../components/dashboard/CashFlowCard.js";
import { monthlyFlow, type FlowKind } from "../utils/monthlyFlow.js";
import { categorySpend } from "../utils/categorySpend.js";
import RefundNote from "../components/RefundNote.js";
import MagnitudeBarList from "../components/dashboard/MagnitudeBarList.js";
import StatTile from "../components/dashboard/StatTile.js";
import { api, type Account, type Category, type Policy, type Transaction, type TransactionRule } from "../api/client.js";
import { spendingTransactions, visibleTransactions } from "../utils/accountBalance.js";
import { useAccountScope, useDateRange } from "../contexts/ViewFilterContext.js";
import { dateRangeLabel, rangeMonthCount, withinRange } from "../utils/dateRange.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { inBase, useFxRates } from "../utils/fx.js";
import { cleanDescription } from "../utils/cleanDescription.js";
import { detectPriceRises } from "../utils/priceRises.js";
import { recurringRepayments, subscriptions } from "../utils/recurring.js";
import { unclaimedRepayments } from "../utils/loanRepayments.js";
import { classifyCommitments } from "../utils/commitments.js";
import { excludeTransfers, transferCategoryIds } from "../utils/transfers.js";

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
  // Which loans already have their repayments named, so the subscriptions
  // card can offer to name the ones that don't.
  const [rules, setRules] = useState<TransactionRule[]>([]);
  // Loaded to tell an insurance premium from a subscription: a policy the
  // owner holds is the strongest evidence the app has for what a payment is.
  const [policies, setPolicies] = useState<Policy[]>([]);
  function refresh() {
    api.listTransactions().then(setTransactions);
    api.listCategories().then(setCategories);
    api.listAccounts().then(setAccounts);
    api.listRules().then(setRules).catch(() => {});
    api.listPolicies().then(setPolicies).catch(() => {});
  }
  useEffect(refresh, []);

  const { scope } = useAccountScope();
  const { range } = useDateRange();
  const rates = useFxRates("EUR");
  // Every figure on this page totals transactions from accounts that may be
  // in different currencies, so all of it works from amounts restated in one.
  const scopedTx = visibleTransactions(allTransactions, accounts, scope);
  const { items: convertedTx, dropped } = inBase(withinRange(scopedTx, range), rates);
  /**
   * Transfers between your own accounts are not income and not spending.
   *
   * One €2,000 move to savings is two real rows; counted as both, the month
   * reads as €2,000 better off and €2,000 worse off at once, and the savings
   * rate built on those two figures is wrong in the numerator and the
   * denominator together.
   */
  const transferIds = transferCategoryIds(categories);
  const flowTx = excludeTransfers(convertedTx, transferIds);

  /**
   * What a category is, for every figure that has to tell money that was
   * earned from money that merely arrived.
   *
   * The same reading the Dashboard uses, so the two pages cannot report
   * different incomes for one month.
   */
  const byCategoryId = new Map(categories.map((c) => [c.id, c]));
  const categoryKind = (id: number | null): FlowKind | null => {
    if (id == null) return null;
    const found = byCategoryId.get(id);
    return found ? { countsAsIncome: !!found.counts_as_income, isTransfer: !!found.is_transfer } : null;
  };
  const anyIncomeCategory = categories.some((c) => c.counts_as_income);

  /**
   * The same transactions with the date range lifted off, for the widgets
   * that look for a rhythm.
   *
   * A rhythm cannot be found inside a window shorter than the rhythm. With
   * the range set to thirty days a monthly subscription has charged once, and
   * once is not a pattern — so Subscriptions and Price Rises went silently
   * empty for anybody who had ever touched the range picker, which reads as
   * "you have no subscriptions" rather than as "ask over a longer period".
   *
   * The account scope still applies: looking at one account should show that
   * account's commitments. It is only the window that has to go.
   */
  const { items: fullHistoryTx } = inBase(scopedTx, rates);
  const money = (value: number) => (rates ? formatCurrency(value, rates.base) : value.toFixed(2));

  // The months the bars are drawn from: the ones inside the chosen window,
  // and at most twelve of them. Capped because a bar per month over a long
  // history is unreadable, not because the window is twelve months - the
  // header's range decides that, and the card now names it.
  const monthKeys = [...new Set(convertedTx.map((tx) => tx.booking_date.slice(0, 7)))].sort().slice(-TREND_MONTHS);
  const monthFlows: MonthFlow[] = monthKeys.map((key) => {
    // The flow list, not the balance one — a transfer in is not income.
    const monthTx = flowTx.filter((tx) => tx.booking_date.startsWith(key));
    // Spending only on the expenses side: a loan repayment leaves the account
    // but is not money spent — see spendingTransactions.
    const monthSpend = spendingTransactions(monthTx);
    const flow = monthlyFlow({ flow: monthTx, spending: monthSpend }, categoryKind);
    return {
      label: monthLabel(key),
      income: flow.income,
      otherIn: flow.otherIn,
      expenses: flow.expenses,
    };
  });

  // Driven by the header's period filter rather than a control of its own:
  // this page had its own, and two date pickers filtering one page is a way
  // to be confidently wrong about which one a chart obeyed.
  //
  // `withinRange` above is the whole of that cut. Totals used to be narrowed
  // a second time, to the last N *calendar months* of what it returned, which
  // is a different window: on the 12th, "last 30 days" kept November and threw
  // away the eighteen days of October the header had just promised. A salary
  // paid on the 23rd vanished from income while sitting in the transaction
  // list two screens away, and the savings rate was then worked out against
  // the income that survived - so the page disagreed with itself rather than
  // simply being short.
  //
  // Every total built from this is about spending, so loan repayments are out
  // of all of them.
  const rangedTx = spendingTransactions(flowTx);

  /**
   * Income is the declared thing, not the positive thing.
   *
   * Every credit used to count, which put a household's own refunds in the
   * denominator of its savings rate. `monthlyFlow` reads `counts_as_income`
   * and nets a refund against the category it came back to, so what was saved
   * is unchanged — only what the figures claim about themselves moved.
   */
  const totals = monthlyFlow({ flow: flowTx, spending: rangedTx }, categoryKind);
  const totalIncome = totals.income;
  const totalExpenses = totals.expenses;
  // Per month of window, not per month the data happens to touch: a 30-day
  // span is one month even when it straddles two, and dividing by the two it
  // touches would halve every average on the page.
  const windowMonths = rangeMonthCount(range) ?? Math.max(1, monthKeys.length);
  // Everything that arrived, earned or not. The savings rate divides by this
  // rather than by declared income alone: the question it answers is what
  // share of the money that came in stayed, and a rate over 100% — which
  // dividing by income alone would produce for a month of large refunds —
  // answers no question at all.
  const totalArrived = totals.income + totals.otherIn;
  const avgMonthlyIncome = (anyIncomeCategory ? totalIncome : totalArrived) / windowMonths;
  const avgMonthlyExpenses = totalExpenses / windowMonths;

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  /**
   * What each category cost, which is not the same as what was paid out of it.
   *
   * These cards totalled the debits and ignored the credits, so the page
   * printed €453.97 of category spending above a €417.65 expenses headline
   * with nothing on it saying why the two disagreed — and the gap was a
   * refund the reader had no way to see. `categorySpend` nets a refund
   * against the category it came back to and reports what it took off, so the
   * shares add up to the expenses figure beside them without hiding anything.
   */
  const spendByCategory = categorySpend(rangedTx, (id) => (id == null ? "Uncategorized" : (categoryNames.get(id) ?? "Unknown")), categoryKind);
  const totalSpend = spendByCategory.total;
  const categoryRows = spendByCategory.rows;

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
  const savingsRate = totalArrived > 0 ? (totals.saved / totalArrived) * 100 : null;
  const monthlySavings = monthFlows.map((m) => {
    const arrived = m.income + (m.otherIn ?? 0);
    return {
      label: m.label,
      rate: arrived > 0 ? ((arrived - m.expenses) / arrived) * 100 : null,
      saved: arrived - m.expenses,
    };
  });
  const bestMonth = [...monthlySavings].filter((m) => m.rate != null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];

  // This month against last, by category. A total tells you what you spent;
  // the change tells you what moved, which is what a monthly review is
  // actually looking for.
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const lastMonthDate = new Date();
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonthKey = lastMonthDate.toISOString().slice(0, 7);

  /**
   * The same netting as the cards above, which matters more here than
   * anywhere: this one reports a *change*, and a refund landing in one of the
   * two months moves the figure by its whole value. A €120 return in October
   * and nothing else different reads as November costing €120 more.
   */
  const spendIn = (monthKey: string) => {
    // Flow list: a transfer out is not this month spending more on anything.
    const month = flowTx.filter((tx) => tx.booking_date.startsWith(monthKey));
    const spend = categorySpend(month, (id) => (id == null ? "Uncategorized" : (categoryNames.get(id) ?? "Unknown")), categoryKind);
    return new Map(spend.rows.map((row) => [row.name, row.total]));
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
  //
  // Loan repayments are out of it for the same reason they are out of every
  // other spending total on this page: the money buys down a balance rather
  // than going out of the picture, and a repayment cannot be cancelled, which
  // is the question a subscriptions list exists to answer.
  const recurringHistory = excludeTransfers(fullHistoryTx, transferIds);
  const recurring = subscriptions(recurringHistory);
  const recurringRepaid = recurringRepayments(recurringHistory);
  const unclaimed = unclaimedRepayments(recurring, accounts, rules);
  // What kind each one is, from the category it was filed under — never from
  // a list of merchants.
  const commitments = classifyCommitments(recurring, { policies, categories });
  // Deliberately from the full history rather than the chosen range: a price
  // rise is established by what came before it, and a three-month window can
  // easily hold the new price and none of the old.
  //
  // A loan's instalment moving is a rate change, not a price rise — there is
  // no provider to ring about it — so repayments leave this too.
  const priceRises = detectPriceRises(spendingTransactions(fullHistoryTx));
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
      title: "Income vs. expenses",
      headerExtra: <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{dateRangeLabel(range).toLowerCase()}</span>,
      icon: ArrowLeftRight,
      accentVar: "--accent",
      defaultWidth: 672,
      defaultHeight: 340,
      render: () => (
        <CashFlowCard
          income={totalIncome}
          otherIn={totals.otherIn}
          expenses={totalExpenses}
          months={monthFlows}
          currency={rates?.base ?? null}
          anyIncomeCategory={anyIncomeCategory}
        />
      ),
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
              {money(totals.saved)} kept of {money(totalArrived)} in
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
      render: () => (
        <>
          <DonutChart data={categoryRows.map((r) => ({ label: r.name, value: r.total }))} currency={rates?.base ?? null} />
          <RefundNote spend={spendByCategory} money={money} />
        </>
      ),
    },
    {
      id: "categoryBars",
      title: "Spend by category",
      icon: BarChart3,
      accentVar: "--accent-4",
      defaultWidth: 328,
      defaultHeight: 320,
      render: () => (
        <>
          <MagnitudeBarList data={categoryRows.map((r) => ({ label: r.name, value: r.total }))} currency={rates?.base ?? null} />
          <RefundNote spend={spendByCategory} money={money} />
        </>
      ),
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
      title: "Standing commitments",
      icon: CreditCard,
      accentVar: "--accent-2",
      defaultWidth: 672,
      defaultHeight: 460,
      render: () => (
        <Subscriptions
          payments={recurring}
          currency={rates?.base ?? "EUR"}
          repayments={recurringRepaid}
          unclaimed={unclaimed}
          commitments={commitments}
          categories={categories}
          onFile={async (_payment, categoryId, matchText) => {
            const rule = await api.createRule({ match_text: matchText, match_account_id: null, category_id: categoryId });
            await api.applyRule(rule.id);
            refresh();
          }}
          onAttribute={async (hit) => {
            await api.createRule({
              match_text: hit.matchText,
              match_account_id: hit.fromAccountId,
              repays_account_id: hit.account.id,
            });
            refresh();
          }}
        />
      ),
    },
    {
      id: "priceRises",
      title: "Price rises",
      icon: TrendingUp,
      accentVar: "--critical",
      defaultWidth: 328,
      defaultHeight: 320,
      render: () => <PriceRises rises={priceRises} currency={rates?.base ?? "EUR"} />,
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
          {/* "Avg income" over a figure containing refunds was the same wrong
              claim as the card above it. With nothing declared there is no
              income figure to print, only what arrived. */}
          <StatTile label={anyIncomeCategory ? "Avg income" : "Avg money in"} value={money(avgMonthlyIncome)} />
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
              {categoryRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.count}</td>
                  <td>{money(row.total)}</td>
                  <td>{totalSpend > 0 ? ((row.total / totalSpend) * 100).toFixed(1) : "0.0"}%</td>
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
