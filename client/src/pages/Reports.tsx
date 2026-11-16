import { useEffect, useMemo, useState } from "react";
import ReportView from "../components/ReportView.js";
import {
  api,
  type Account,
  type Budget,
  type Category,
  type Holding,
  type Policy,
  type Property,
  type Transaction,
} from "../api/client.js";
import {
  accountBalance,
  accountTxSums,
  accountTypeLabel,
  isLiability,
  repaymentMirrors,
  spendingTransactions,
  visibleAccounts,
  visibleTransactions,
} from "../utils/accountBalance.js";
import { useAccountScope } from "../contexts/ViewFilterContext.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { inBase, toBase, useFxRates } from "../utils/fx.js";
import { holdingValue } from "../utils/holdingValue.js";
import { countsAtCover, policyContribution } from "../utils/policyValue.js";
import { countsAtValue, propertyContribution } from "../utils/propertyMetrics.js";
import { excludeTransfers, transferCategoryIds } from "../utils/transfers.js";
import {
  annualSummary,
  budgetVsActual,
  incomeExpenseStatement,
  inPeriod,
  keyRatios,
  monthsCovered,
  netWorthStatement,
  periodOptions,
  type LineItem,
  type Period,
  type Report,
} from "../utils/reports.js";

/**
 * The statements, as opposed to the screens.
 *
 * Every other page in this app answers a question you have right now. This one
 * produces the thing you hand to somebody else — a lender, an accountant, a
 * partner — or file away and compare against next year. That changes what it
 * has to do: it needs a stated period, line items that visibly add to their
 * totals, the caveats printed alongside the figures rather than tucked into a
 * tooltip, and a way out of the app that is not retyping.
 *
 * All five reports read the same data the rest of the app reads, through the
 * same helpers. That is the point: a report that computed net worth its own
 * way would eventually disagree with the sidebar, and the version somebody
 * printed and posted is the one that cannot be corrected afterwards.
 */

const BASE = "EUR";

export default function Reports() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  const { scope } = useAccountScope();
  const rates = useFxRates(BASE);
  const periods = useMemo(() => periodOptions(), []);
  // Last 12 months rather than this month: a statement of a part-month is a
  // statement of very little, and somebody arriving here wants a span.
  const [periodIndex, setPeriodIndex] = useState(4);
  const period: Period = periods[periodIndex];

  useEffect(() => {
    Promise.all([
      api.listAccounts(),
      api.listTransactions(),
      api.listCategories(),
      api.listBudgets(),
      api.listHoldings().catch(() => []),
      api.listPolicies().catch(() => []),
      api.listProperties().catch(() => []),
    ])
      .then(([a, t, c, b, h, p, prop]) => {
        setAccounts(a);
        setTransactions(t);
        setCategories(c);
        setBudgets(b);
        setHoldings(h);
        setPolicies(p);
        setProperties(prop);
      })
      .finally(() => setLoading(false));
  }, []);

  const money = (value: number) => formatCurrency(value, BASE);
  const categoryName = useMemo(() => {
    const names = new Map(categories.map((c) => [c.id, c.name]));
    return (id: number | null) => (id === null ? "" : (names.get(id) ?? ""));
  }, [categories]);

  /**
   * One reading of the data, shared by every report below.
   *
   * Built once rather than per report so the five of them cannot disagree
   * about which accounts exist, which transactions are spending, or what a
   * rand is worth today.
   */
  const data = useMemo(() => {
    const visible = visibleAccounts(accounts, scope);
    const scoped = visibleTransactions(transactions, accounts, scope);
    const sums = accountTxSums(visible, scoped);

    // Assets and liabilities are the same accounts read on different sides,
    // decided by what the balance actually is rather than what the account is
    // called — an overdrawn current account is borrowing however it is typed.
    const assets: LineItem[] = [];
    const liabilities: LineItem[] = [];
    const unconvertible = new Set<string>();
    let liquid = 0;
    let monthlyDebtPayments = 0;

    for (const account of visible) {
      const native = accountBalance(account, sums.get(account.id) ?? 0);
      const value = toBase(native, account.currency, rates);
      if (value === null) {
        unconvertible.add(account.currency);
        continue;
      }
      const detail = account.institution_name
        ? `${accountTypeLabel(account)} · ${account.institution_name}`
        : accountTypeLabel(account);

      if (value < 0) liabilities.push({ label: account.name, detail, amount: -value });
      else if (value > 0) assets.push({ label: account.name, detail, amount: value });

      const type = account.account_type ?? "current";
      if (value > 0 && (type === "current" || type === "savings")) liquid += value;

      // A loan states its payment; a card does not, so what is being paid on
      // it is unknown rather than zero and is left out of the ratio instead of
      // being guessed at. The note on the report says so.
      if (isLiability(account) && account.loan_monthly_payment) {
        const payment = toBase(account.loan_monthly_payment, account.currency, rates);
        if (payment !== null) monthlyDebtPayments += payment;
      }
    }

    let investments = 0;
    for (const holding of holdings) {
      const native = holdingValue(holding);
      if (native === null) continue;
      const value = toBase(native, holding.currency, rates);
      if (value === null) {
        unconvertible.add(holding.currency);
        continue;
      }
      investments += value;
      assets.push({ label: holding.name, detail: holding.ticker ?? holding.kind, amount: value });
    }

    for (const policy of policies) {
      const native = policyContribution(policy);
      if (native === 0) continue;
      const value = toBase(native, policy.currency, rates);
      if (value === null) {
        unconvertible.add(policy.currency);
        continue;
      }
      // Named as a sum assured where it is one. A policy counted at cover is
      // money that pays out rather than money held, and a balance sheet that
      // let that disappear into "assets" would be overstating itself.
      assets.push({
        label: policy.name,
        detail: countsAtCover(policy) ? "Policy — cover amount, pays out rather than held" : "Policy — surrender value",
        amount: value,
      });
    }

    // Property, at whichever figure each one was set to count at. A
    // statement that left it out would disagree with the sidebar about the
    // same household.
    for (const property of properties) {
      const native = propertyContribution(property);
      if (native === 0) continue;
      const value = toBase(native, property.currency, rates);
      if (value === null) {
        unconvertible.add(property.currency);
        continue;
      }
      assets.push({
        label: property.address,
        detail: countsAtValue(property)
          ? "Property — full value, mortgage counted as a loan account"
          : "Property — equity, value less its mortgage",
        amount: value,
      });
    }

    // Spending excludes loan repayments: the money became equity in a debt
    // rather than leaving the picture, and counting it as expenditure would
    // show the same money going out and net worth improving by it.
    //
    // And transfers between your own accounts, for the same kind of reason:
    // one move to savings is two rows, and an income statement counting both
    // reports money earned that was already yours. The balance sheet above is
    // unaffected — it reads account balances, which need both halves.
    const { items: entries } = inBase(
      excludeTransfers(spendingTransactions(scoped), transferCategoryIds(categories)),
      rates
    );

    return {
      assets: assets.sort((a, b) => b.amount - a.amount),
      liabilities: liabilities.sort((a, b) => b.amount - a.amount),
      unconvertible: [...unconvertible],
      entries,
      liquid,
      investments,
      monthlyDebtPayments,
      // Net worth needs both halves of a repayment or it falls by the payment
      // on the day the debt shrinks by it. Unused here, but the same list the
      // sidebar builds — kept so the two cannot drift apart.
      mirrored: repaymentMirrors(scoped).length,
    };
  }, [accounts, transactions, holdings, policies, properties, categories, scope, rates]);

  const reports: Report[] = useMemo(() => {
    if (!rates) return [];

    const within = inPeriod(data.entries, period);
    const spentByCategory = new Map<string, number>();
    for (const entry of within) {
      if (entry.amount >= 0) continue;
      const name = categoryName(entry.category_id) || "Uncategorised";
      spentByCategory.set(name, (spentByCategory.get(name) ?? 0) + Math.abs(entry.amount));
    }

    // The ratios are a standing position, so they read the last twelve months
    // whatever window the statements above are showing. A debt-to-income
    // computed from one month would swing with a single bonus.
    const year = periods.find((p) => p.label === "Last 12 months") ?? period;
    const yearly = inPeriod(data.entries, year);
    const months = Math.max(1, monthsCovered(year, yearly).length);
    const income = yearly.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
    const spend = yearly.filter((e) => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);

    const totalAssets = data.assets.reduce((sum, a) => sum + a.amount, 0);
    const totalLiabilities = data.liabilities.reduce((sum, l) => sum + l.amount, 0);

    const ratios = keyRatios(
      {
        totalAssets,
        totalLiabilities,
        monthlyIncome: income / months,
        monthlyExpenses: spend / months,
        monthlyDebtPayments: data.monthlyDebtPayments,
        liquidAssets: data.liquid,
        investments: data.investments,
      },
      money
    );
    ratios.notes.push(
      "Monthly debt payments count the scheduled payment on each loan. A card with no payment recorded is left out rather than guessed at."
    );

    return [
      netWorthStatement(
        { assets: data.assets, liabilities: data.liabilities, unconvertible: data.unconvertible },
        money,
        new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
      ),
      incomeExpenseStatement(data.entries, period, categoryName, money),
      annualSummary(data.entries, period, money),
      budgetVsActual(
        budgets.filter((b) => b.currency === BASE).map((b) => ({ category: b.category_name, monthlyLimit: b.monthly_limit })),
        spentByCategory,
        period,
        money
      ),
      ratios,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, budgets, period, periods, categoryName, rates]);

  if (loading) return <p className="empty-state">Loading…</p>;

  return (
    <div className="reports-page">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="page-header__subtitle">
            Statements you can file, print or hand to somebody · figures in {BASE}
          </p>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" }}>
          <span className="report__period-label">Period</span>
          <select value={periodIndex} onChange={(e) => setPeriodIndex(Number(e.target.value))}>
            {periods.map((option, index) => (
              <option key={option.label} value={index}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!rates && (
        <p className="empty-state">
          Exchange rates haven&apos;t loaded, so nothing has been totalled yet — a figure added across currencies without
          them would be wrong rather than missing.
        </p>
      )}

      {/* A balance sheet is dated and the rest are windowed, so the period
          control above deliberately does not touch the first one. Said on the
          report itself rather than here. */}
      <div className="reports-page__list">
        {reports.map((report) => (
          <ReportView key={report.id} report={report} />
        ))}
      </div>
    </div>
  );
}
