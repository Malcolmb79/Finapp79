import { Flame, GitBranch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import WidgetCanvas, { type WidgetSpec } from "../components/dashboard/WidgetCanvas.js";
import FireCalculator from "../components/FireCalculator.js";
import ScenarioPlanner from "../components/ScenarioPlanner.js";
import { api, type Account, type Category, type Holding, type Policy, type Property, type Transaction } from "../api/client.js";
import {
  accountBalance,
  accountTxSums,
  spendingTransactions,
  visibleAccounts,
  visibleTransactions,
} from "../utils/accountBalance.js";
import { useAccountScope } from "../contexts/ViewFilterContext.js";
import { inBase, toBase, useFxRates } from "../utils/fx.js";
import { holdingValue } from "../utils/holdingValue.js";
import { policyContribution } from "../utils/policyValue.js";
import { propertyContribution } from "../utils/propertyMetrics.js";
import { excludeTransfers, transferCategoryIds } from "../utils/transfers.js";
import { monthsCovered, periodOptions, inPeriod } from "../utils/reports.js";

/**
 * What might happen, kept apart from what has.
 *
 * Reports state the position; this projects from it. They are deliberately
 * different pages because they are different kinds of claim, and a figure that
 * is a projection sitting in a table of figures that are facts is a figure
 * that will be quoted as a fact.
 *
 * Both widgets run off the same baseline, built once here: the pot that could
 * actually be drawn on, and the income and spending the household has averaged
 * over the last twelve months. Twelve rather than this month, because a single
 * bonus or a single quiet month would otherwise move a retirement date by
 * years.
 */

const BASE = "EUR";

export default function Future() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  const { scope } = useAccountScope();
  const rates = useFxRates(BASE);

  useEffect(() => {
    Promise.all([
      api.listAccounts(),
      api.listTransactions(),
      api.listHoldings().catch(() => []),
      api.listPolicies().catch(() => []),
      api.listProperties().catch(() => []),
      api.listCategories().catch(() => []),
    ])
      .then(([a, t, h, p, prop, cats]) => {
        setAccounts(a);
        setTransactions(t);
        setHoldings(h);
        setPolicies(p);
        setProperties(prop);
        setCategories(cats);
      })
      .finally(() => setLoading(false));
  }, []);

  const baseline = useMemo(() => {
    const visible = visibleAccounts(accounts, scope);
    const scoped = visibleTransactions(transactions, accounts, scope);
    const sums = accountTxSums(visible, scoped);

    let netWorth = 0;
    let investable = 0;

    for (const account of visible) {
      const value = toBase(accountBalance(account, sums.get(account.id) ?? 0), account.currency, rates);
      if (value === null) continue;
      netWorth += value;
      // Only what could be reached. An overdrawn account is not a negative
      // pot — the borrowing is already in net worth, and subtracting it here
      // too would have the debt reduce the retirement fund twice.
      const type = account.account_type ?? "current";
      if (value > 0 && (type === "current" || type === "savings")) investable += value;
    }

    for (const holding of holdings) {
      const native = holdingValue(holding);
      if (native === null) continue;
      const value = toBase(native, holding.currency, rates);
      if (value === null) continue;
      netWorth += value;
      investable += value;
    }

    // Policies count towards net worth exactly as the sidebar counts them, and
    // never towards the pot. A sum assured pays out on death, which is not a
    // retirement anybody is planning for.
    for (const policy of policies) {
      const value = toBase(policyContribution(policy), policy.currency, rates);
      if (value !== null) netWorth += value;
    }

    // Property counts towards net worth and never towards the pot, for the
    // same reason the home is excluded from it: equity in a building does not
    // pay for groceries unless it is sold, and a rental's equity is not
    // reachable without ending the rent that made it worth holding.
    for (const property of properties) {
      const value = toBase(propertyContribution(property), property.currency, rates);
      if (value !== null) netWorth += value;
    }

    const year = periodOptions().find((p) => p.label === "Last 12 months")!;
    // Transfers out: a standing move to savings is not spending, and
    // counting it would have the projection assume a household that both
    // saves more and can afford less than it can.
    const { items } = inBase(excludeTransfers(spendingTransactions(scoped), transferCategoryIds(categories)), rates);
    const yearly = inPeriod(items, year);
    const months = Math.max(1, monthsCovered(year, yearly).length);
    const income = yearly.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
    const spend = yearly.filter((e) => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);

    return {
      netWorth,
      investable,
      monthlyIncome: income / months,
      monthlyExpenses: spend / months,
      monthsOfHistory: months,
    };
  }, [accounts, transactions, holdings, policies, properties, categories, scope, rates]);

  const widgets: WidgetSpec[] = [
    {
      id: "fire",
      title: "When work becomes optional",
      icon: Flame,
      accentVar: "--accent-3",
      defaultWidth: 672,
      defaultHeight: 700,
      render: () => (
        <FireCalculator
          investable={baseline.investable}
          monthlyIncome={baseline.monthlyIncome}
          monthlyExpenses={baseline.monthlyExpenses}
          currency={BASE}
        />
      ),
    },
    {
      id: "scenarios",
      title: "What if",
      icon: GitBranch,
      accentVar: "--accent-2",
      defaultWidth: 1360,
      defaultHeight: 640,
      render: () => <ScenarioPlanner baseline={baseline} currency={BASE} />,
    },
  ];

  if (loading) return <p className="empty-state">Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Future</h1>
          <p className="page-header__subtitle">
            Projections, not statements · built from your last {baseline.monthsOfHistory} months
          </p>
        </div>
      </div>

      {!rates && (
        <p className="empty-state">
          Exchange rates haven&apos;t loaded, so nothing has been totalled yet.
        </p>
      )}

      {baseline.monthsOfHistory < 3 && (
        <p className="empty-state">
          Only {baseline.monthsOfHistory} month{baseline.monthsOfHistory === 1 ? "" : "s"} of transactions so far. These
          projections will say something once there is more history behind them — a retirement date drawn from one month is
          a date drawn from one month.
        </p>
      )}

      <WidgetCanvas storageKey="future.layout.v1" widgets={widgets} />
    </div>
  );
}
