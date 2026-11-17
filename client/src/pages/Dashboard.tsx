import { ArrowDownRight, ArrowUpRight, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SummaryStrip from "../components/dashboard/SummaryStrip.js";
import ExpenseTrend from "../components/dashboard/ExpenseTrend.js";
import IncomeSources from "../components/dashboard/IncomeSources.js";
import NotesWidget from "../components/dashboard/NotesWidget.js";
import QuickAdd from "../components/dashboard/QuickAdd.js";
import Subscriptions from "../components/dashboard/Subscriptions.js";
import { recurringRepayments, subscriptions } from "../utils/recurring.js";
import { unclaimedRepayments } from "../utils/loanRepayments.js";
import { classifyCommitments } from "../utils/commitments.js";
import { dailySpend, incomeBySource, summaryFigures } from "../utils/dashboardSummary.js";
import { excludeTransfers, transferCategoryIds } from "../utils/transfers.js";
import CashFlowCard, { type MonthFlow } from "../components/dashboard/CashFlowCard.js";
import CashFlowForecast from "../components/dashboard/CashFlowForecast.js";
import UpcomingBills from "../components/dashboard/UpcomingBills.js";
import { addDaysIso, forecastBalance, today, upcomingBills } from "../utils/forecast.js";
import MagnitudeBarList from "../components/dashboard/MagnitudeBarList.js";
import NetWorthCard, { type TrendPoint } from "../components/dashboard/NetWorthCard.js";
import PendingReviewWidget from "../components/dashboard/PendingReviewWidget.js";
import StatementsDue from "../components/dashboard/StatementsDue.js";
import CanvasCard, { type WidgetMode } from "../components/dashboard/CanvasCard.js";
import {
  api,
  type Account,
  type Budget,
  type Category,
  type PendingTransaction,
  type Holding,
  type Policy,
  type Property,
  type SavingsGoal,
  type Transaction,
  type TransactionRule,
} from "../api/client.js";
import {
  LAYOUT_GAP,
  MIN_WIDGET_HEIGHT,
  MIN_WIDGET_WIDTH,
  STACK_BELOW,
  WIDE_WIDTH,
  WIDGET_IDS,
  WIDGET_META,
  widgetAccentVar,
  type WidgetId,
} from "../dashboardWidgets.js";
import { inBase, sumInBase, useFxRates } from "../utils/fx.js";
import { useAccountScope, useDateRange } from "../contexts/ViewFilterContext.js";
import { withinRange } from "../utils/dateRange.js";
import { computeCanvasHeight, type CanvasRect } from "../utils/useCanvasItem.js";
import { useMeasuredWidth } from "../utils/useMeasuredWidth.js";
import AccountAvatar from "../components/AccountAvatar.js";
import TransactionDetailModal from "../components/TransactionDetailModal.js";
import CashFlowSankey from "../components/dashboard/CashFlowSankey.js";
import type { FlowCategory } from "../utils/cashFlowSankey.js";
import { monthlyFlow } from "../utils/monthlyFlow.js";
import SpendingCalendar from "../components/dashboard/SpendingCalendar.js";
import MonthComparison from "../components/dashboard/MonthComparison.js";
import { accountBalance, amountDrawn, isBorrowing, accountTxSums, isLiability, repaymentMirrors, spendingTransactions, visibleAccounts, visibleTransactions } from "../utils/accountBalance.js";
import { budgetStatus } from "../utils/budgetStatus.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { monthsToPayoff } from "../utils/payoff.js";
import { countsAtCover, policyContribution, policyContributions, policyContributionsAt } from "../utils/policyValue.js";
import { holdingContributions, holdingContributionsAt } from "../utils/holdingValue.js";
import { propertyContribution, propertyContributions, propertyContributionsAt } from "../utils/propertyMetrics.js";

/** How far back a widget looks, where that is a choice rather than a fixed span. */
type WidgetRange = "month" | "3m" | "6m" | "1y" | "all";

const RANGE_LABELS: Record<WidgetRange, string> = {
  month: "1 month",
  "3m": "3 months",
  "6m": "6 months",
  "1y": "1 year",
  all: "All time",
};

/** The earliest date a range covers, or null for all of it. */
function rangeStart(range: WidgetRange): string | null {
  if (range === "all") return null;
  const date = new Date();
  if (range === "month") date.setMonth(date.getMonth() - 1);
  if (range === "3m") date.setMonth(date.getMonth() - 3);
  if (range === "6m") date.setMonth(date.getMonth() - 6);
  if (range === "1y") date.setFullYear(date.getFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

interface DashboardConfig {
  enabled: WidgetId[];
  rects: Partial<Record<WidgetId, CanvasRect>>;
  modes: Partial<Record<WidgetId, WidgetMode>>;
  ranges: Partial<Record<WidgetId, WidgetRange>>;
}

const STORAGE_KEY = "dashboard.config.v2";
// v1 stored an ordered list plus coarse 1-or-2-column sizes; v0 stored just
// an order. Both predate free positioning, so they're migrated by laying
// their order out on the canvas rather than being discarded.
const V1_STORAGE_KEY = "dashboard.config.v1";
const LEGACY_STORAGE_KEY = "dashboard.widgetOrder.v3";

// Packs widgets left-to-right into a two-column canvas, wrapping when the
// next one doesn't fit and starting a new row for full-width widgets. Only
// ever used to seed a layout (fresh install, migration, or a widget added
// after the fact) — once a widget has a stored rect, that wins.
function autoLayout(enabled: WidgetId[], existing: Partial<Record<WidgetId, CanvasRect>> = {}): Partial<Record<WidgetId, CanvasRect>> {
  const rects: Partial<Record<WidgetId, CanvasRect>> = { ...existing };
  let cursorX = 0;
  let rowY = 0;
  let rowHeight = 0;

  for (const id of enabled) {
    if (rects[id]) continue;
    const meta = WIDGET_META[id];
    const width = meta.defaultWidth;
    const height = meta.defaultHeight;

    if (cursorX > 0 && cursorX + width > WIDE_WIDTH) {
      cursorX = 0;
      rowY += rowHeight + LAYOUT_GAP;
      rowHeight = 0;
    }

    rects[id] = { x: cursorX, y: rowY, width, height };
    cursorX += width + LAYOUT_GAP;
    rowHeight = Math.max(rowHeight, height);
  }

  return rects;
}

/** "2026-07" as "Jul 26" — a month number alone is unreadable on an axis. */
function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
}

function defaultConfig(): DashboardConfig {
  const enabled = WIDGET_IDS.filter((id) => WIDGET_META[id].defaultEnabled);
  return {
    enabled,
    rects: autoLayout(enabled),
    modes: Object.fromEntries(WIDGET_IDS.filter((id) => WIDGET_META[id].defaultMode).map((id) => [id, WIDGET_META[id].defaultMode])),
    ranges: {},
  };
}

function readEnabled(raw: unknown): WidgetId[] | null {
  if (!raw || typeof raw !== "object") return null;
  const enabled = (raw as { enabled?: unknown }).enabled;
  if (!Array.isArray(enabled)) return null;
  return enabled.filter((id: string) => (WIDGET_IDS as readonly string[]).includes(id)) as WidgetId[];
}

function loadConfig(): DashboardConfig {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const enabled = readEnabled(stored);
    if (enabled) {
      // autoLayout fills in anything without a stored rect, so a widget added
      // by a later release lands somewhere sensible instead of at 0,0 on top
      // of an existing one.
      return { enabled, rects: autoLayout(enabled, stored.rects ?? {}), modes: stored.modes ?? {}, ranges: stored.ranges ?? {} };
    }
  } catch {
    // fall through
  }

  // Migrate a pre-canvas layout so upgrading doesn't silently reset anyone's
  // dashboard: the widget set and modes carry over, and their order becomes
  // the starting arrangement on the canvas.
  for (const key of [V1_STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "null");
      const enabled = readEnabled(stored) ?? (Array.isArray(stored) ? (stored.filter((id: string) => (WIDGET_IDS as readonly string[]).includes(id)) as WidgetId[]) : null);
      if (enabled && enabled.length > 0) {
        return { enabled, rects: autoLayout(enabled), modes: stored?.modes ?? defaultConfig().modes, ranges: {} };
      }
    } catch {
      // fall through
    }
  }

  return defaultConfig();
}

/**
 * Two months out. Long enough to cross the next payday and show the month
 * that follows it, short enough that the projection is still made of
 * commitments rather than guesses.
 */
const FORECAST_DAYS = 60;

export default function Dashboard() {
  const [allTransactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);
  const [allAccounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [allPolicies, setPolicies] = useState<Policy[]>([]);
  const [allHoldings, setHoldings] = useState<Holding[]>([]);
  const [allProperties, setProperties] = useState<Property[]>([]);
  // Loaded only to know which loans already have their repayments named, so
  // the subscriptions list offers to name the ones that don't.
  const [rules, setRules] = useState<TransactionRule[]>([]);
  // The transaction whose detail card is open, from the recent list.
  const [openTransaction, setOpenTransaction] = useState<Transaction | null>(null);
  const [config, setConfig] = useState<DashboardConfig>(loadConfig);
  const [syncingAll, setSyncingAll] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [canvasRef, canvasWidth] = useMeasuredWidth(WIDE_WIDTH);
  const { scope } = useAccountScope();
  const { range } = useDateRange();
  const rates = useFxRates("EUR");
  // Hidden accounts leave every total on this page, and their transactions
  // leave with them.
  const accounts = visibleAccounts(allAccounts, scope);
  const transactions = visibleTransactions(allTransactions, allAccounts, scope);

  function refresh() {
    api.listTransactions().then(setTransactions);
    api.listPendingTransactions().then(setPendingTransactions);
    api.listAccounts().then(setAccounts);
    api.listCategories().then(setCategories);
    api.listBudgets().then(setBudgets);
    api.listSavingsGoals().then(setSavingsGoals);
    api.listPolicies().then(setPolicies);
    api.listHoldings().then(setHoldings).catch(() => {});
    api.listProperties().then(setProperties).catch(() => {});
    api.listRules().then(setRules).catch(() => {});
  }

  useEffect(refresh, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  function addWidget(id: WidgetId) {
    setConfig((c) => {
      if (c.enabled.includes(id)) return c;
      const enabled = [...c.enabled, id];
      // Existing rects are passed through untouched, so a newly added widget
      // is the only one that gets placed.
      return { ...c, enabled, rects: autoLayout(enabled, c.rects) };
    });
    setAddMenuOpen(false);
  }

  function removeWidget(id: WidgetId) {
    setConfig((c) => ({ ...c, enabled: c.enabled.filter((x) => x !== id) }));
  }

  function moveWidget(id: WidgetId, x: number, y: number) {
    setConfig((c) => {
      const rect = c.rects[id];
      if (!rect) return c;
      return { ...c, rects: { ...c.rects, [id]: { ...rect, x, y } } };
    });
  }

  function resizeWidget(id: WidgetId, width: number, height: number) {
    setConfig((c) => {
      const rect = c.rects[id];
      if (!rect) return c;
      return { ...c, rects: { ...c.rects, [id]: { ...rect, width, height } } };
    });
  }

  function setMode(id: WidgetId, mode: WidgetMode) {
    setConfig((c) => ({ ...c, modes: { ...c.modes, [id]: mode } }));
  }

  function setRange(id: WidgetId, range: WidgetRange) {
    setConfig((c) => ({ ...c, ranges: { ...c.ranges, [id]: range } }));
  }

  async function handleSyncAll() {
    const linked = accounts.filter((a) => a.source === "enablebanking");
    if (linked.length === 0) return;
    setSyncingAll(true);
    try {
      await Promise.all(linked.map((a) => api.syncAccount(a.id)));
      refresh();
    } finally {
      setSyncingAll(false);
    }
  }

  // Counted from the point each balance was set, so a hand-set figure
  // is an opening balance that transactions move rather than a frozen
  // number — see accountTxSums.
  const byAccount = accountTxSums(accounts, transactions);

  // Linked accounts contribute their real bank balance (not a sum of the
  // 90-day synced transaction window); manual accounts have no other
  // source of truth, so they still derive from their transaction history.
  // Balances are summed in a single currency rather than added as bare
  // numbers: an account in ZAR and one in EUR are not the same unit, and
  // totalling them raw produced a net worth that meant nothing.
  const balances = accounts.map((a) => ({ amount: accountBalance(a, byAccount.get(a.id) ?? 0), currency: a.currency }));
  // A scope narrows to one account, and a policy is not that account, so
  // policies drop out entirely while one is set — the same reasoning that keeps
  // a hidden account's transactions out with it.
  const policies = scope ? [] : allPolicies;
  // Same reasoning as policies: a scope narrows to one account, and a holding
  // is not that account, so investments drop out entirely while one is set.
  const holdings = scope ? [] : allHoldings;
  const properties = scope ? [] : allProperties;

  // Accounts alone, kept apart from the headline because the trend below needs
  // it: the line is anchored on this figure and walked backwards through the
  // transactions, and a policy's value is not something the transactions move.
  const { converted: accountsNetWorth, unconvertible: accountsUnconvertible } = sumInBase(balances, rates);
  const { converted: policyTotal, unconvertible: policyUnconvertible } = sumInBase(policyContributions(policies), rates);
  const { converted: holdingTotal, unconvertible: holdingUnconvertible } = sumInBase(holdingContributions(holdings), rates);
  // Property on the same terms, and for the same reason: a figure here that
  // left it out would disagree with the sidebar about one household.
  const { converted: propertyTotal, unconvertible: propertyUnconvertible } = sumInBase(
    propertyContributions(properties),
    rates
  );
  const netWorth = accountsNetWorth + policyTotal + holdingTotal + propertyTotal;

  const unconvertible = [
    ...new Set([...accountsUnconvertible, ...policyUnconvertible, ...holdingUnconvertible, ...propertyUnconvertible]),
  ];
  // Named so the reason net worth exceeds the accounts stays visible. A cover
  // amount pays out on death rather than being held now; counting it is the
  // user's call, but it should never become an anonymous part of a total.
  const coveredAtCover = policies.filter(countsAtCover);
  // Currencies missing a rate are named wherever they affect a total, so a
  // combined figure is never shown as complete when part of it was dropped.
  const thisMonthKey = new Date().toISOString().slice(0, 7);

  // Every aggregate below combines accounts, so all of them work from
  // transactions restated in one currency. Adding a ZAR amount to a EUR one
  // gives a figure in no currency at all — confident and meaningless.
  const { items: convertedTx, dropped: droppedCurrencies } = inBase(withinRange(transactions, range), rates);
  /**
   * The same transactions without the date range, for anything that has to
   * find a repeating charge before it can say anything.
   *
   * The forecast and the upcoming bills are both built entirely out of
   * detected rhythms. Handed a thirty-day window they detect nothing, and a
   * projection with no bills in it is not a cautious projection — it is a
   * line that only ever goes up. Scope still applies; only the window goes.
   */
  const { items: fullHistoryTx } = inBase(transactions, rates);
  const missingRates = [...new Set([...unconvertible, ...droppedCurrencies])];

  /**
   * Two readings of the same transactions, because the two questions differ.
   *
   * `worthTx` carries both halves of a loan repayment, so paying a debt nets
   * to zero rather than looking like a loss. `spendTx` carries neither half,
   * because money that went into a debt was not spent. Using one list for both
   * gets one of them wrong whichever way round it is done.
   */
  const worthTx = [...convertedTx, ...repaymentMirrors(convertedTx)];
  /**
   * Transfers between your own accounts leave the flow figures and stay in
   * the balance ones.
   *
   * Moving €2,000 to savings is one event in two rows. Both are needed for
   * the balances — the current account really is €2,000 lighter — and
   * counting them as income and spending reports a month in which €2,000
   * more was earned and €2,000 more was spent than actually happened.
   *
   * So: `worthTx` keeps everything, and everything that totals income or
   * spending comes off `flowTx`. Same split the app already makes for a loan
   * repayment, generalised.
   */
  const transferIds = transferCategoryIds(categories);
  const flowTx = excludeTransfers(convertedTx, transferIds);
  const spendTx = spendingTransactions(flowTx);

  /**
   * What a category is, for every figure that has to tell money that was
   * earned from money that merely arrived.
   *
   * Resolved once and handed to all of them — the cash-flow totals, the month
   * bars and the flow chart. Three separate readings of "is this income" is
   * three chances for one page to disagree with itself, which is how refunds
   * came to sit on the income side of one card while another had already
   * stopped counting them.
   */
  const byCategoryId = new Map(categories.map((c) => [c.id, c]));
  const categoryKind = (id: number | null): FlowCategory | null => {
    if (id == null) return null;
    const found = byCategoryId.get(id);
    return found ? { name: found.name, countsAsIncome: !!found.counts_as_income, isTransfer: !!found.is_transfer } : null;
  };
  // Nothing marked is a setup state rather than a month that earned nothing,
  // and the card has to be able to say which.
  const anyIncomeCategory = categories.some((c) => c.counts_as_income);

  /**
   * Where the balance goes next, from what repeats.
   *
   * Anchored on spendable accounts rather than net worth, which is the whole
   * difference between this and every other figure on the page. A €1,152 loan
   * balance is real debt and belongs in net worth, but it is not money leaving
   * the current account before payday — starting the line €1,152 lower would
   * answer a question nobody asked. What is due on that loan arrives here the
   * same way every other commitment does: as a repayment that has charged
   * before.
   */
  const spendable = accounts
    .filter((a) => !isLiability(a))
    .map((a) => ({ amount: accountBalance(a, byAccount.get(a.id) ?? 0), currency: a.currency }));
  const { converted: spendableTotal } = sumInBase(spendable, rates);
  const forecastFrom = today();
  // Categories the owner has marked as regular income. Declared beats
  // detected: the projection otherwise needs three matching credits before it
  // believes in a salary, so a new job, a changed employer or pay from more
  // than one place leaves a line that only ever falls.
  //
  // Occasional income is excluded here and nowhere else. A tax refund is
  // income and every total says so, but a projection that repeats it monthly
  // is drawing a line through money that is not coming.
  const incomeCategories = new Set(
    categories.filter((c) => c.counts_as_income && !c.income_is_occasional).map((c) => c.id)
  );
  /**
   * Money arriving from your own accounts is not money arriving.
   *
   * The line opens at `spendableTotal`, which is every spendable account
   * added together — so a transfer between two of them is already inside the
   * opening figure on both sides. Projecting the inflow leg as income adds
   * money that was always there, every month, forever.
   *
   * The outflow leg is deliberately kept. It usually nets out the same way,
   * but not always: a transfer to a credit card leaves the spendable total
   * for a liability account that is not in it. So the two sides are treated
   * differently on purpose, and each errs the same way — towards a lower
   * balance, which is the direction a "will there be enough" projection
   * should be wrong in.
   */
  const forecastTx = excludeTransfers(fullHistoryTx, transferIds);
  const forecast = forecastBalance(fullHistoryTx, spendableTotal, {
    from: forecastFrom,
    days: FORECAST_DAYS,
    isIncomeCategory: (id) => id != null && incomeCategories.has(id),
    incomeFrom: forecastTx,
  });
  const bills = upcomingBills(fullHistoryTx, { from: forecastFrom, until: addDaysIso(forecastFrom, FORECAST_DAYS) });

  const monthDelta = worthTx
    .filter((tx) => tx.booking_date.startsWith(thisMonthKey))
    .reduce((sum, tx) => sum + tx.amount, 0);

  /**
   * Income is the declared thing, not the positive thing.
   *
   * A credit used to be income by virtue of being a credit, which reported a
   * household earning money from its own bus fares and divided the savings
   * rate by a denominator containing its own refunds. `monthlyFlow` reads
   * `counts_as_income` instead and nets a refund against the category it came
   * back to, so what was saved comes out exactly as it did before — the
   * figures stopped claiming the wrong thing without any of them moving.
   */
  const { income, otherIn, expenses } = monthlyFlow({ flow: flowTx, spending: spendTx }, categoryKind);

  const monthKeys = [...new Set(convertedTx.map((tx) => tx.booking_date.slice(0, 7)))].sort().slice(-6);
  const monthFlows: MonthFlow[] = monthKeys.map((key) => {
    // The flow list, not the balance one: a transfer in is not a month of
    // better income, and drawn on this chart it would be a green bar for
    // money that was already yours.
    const monthTx = flowTx.filter((tx) => tx.booking_date.startsWith(key));
    const monthSpend = spendTx.filter((tx) => tx.booking_date.startsWith(key));
    const flow = monthlyFlow({ flow: monthTx, spending: monthSpend }, categoryKind);
    return {
      label: monthLabel(key),
      income: flow.income,
      otherIn: flow.otherIn,
      expenses: flow.expenses,
      // What the bar is made of, so clicking it opens exactly that.
      month: key,
    };
  });

  const netWorthRange = config.ranges.netWorth ?? "6m";

  /**
   * Net worth at each point in time, ending at today's figure.
   *
   * Anchored to the real net worth and worked backwards through the
   * transactions, rather than accumulating them from zero: the headline number
   * comes from account balances, and a line that starts at nothing ends
   * somewhere else entirely and quietly contradicts the figure above it.
   *
   * Daily points over a short range, month-ends over a long one — a year of
   * daily points is 365 dots of noise, and a month of month-ends is one.
   *
   * Policies are added per point rather than folded into the anchor. Walking
   * back from a total that already contains them would carry today's policy
   * value across every earlier point too, quietly raising last year's net worth
   * by an amount there was no record of holding — so each point instead takes
   * the figure from the statement in effect on that date, and nothing at all
   * before a policy's first one.
   */
  const netWorthTrend: TrendPoint[] = (() => {
    if (worthTx.length === 0) return [];

    const sorted = [...worthTx].sort((a, b) => a.booking_date.localeCompare(b.booking_date));
    const total = sorted.reduce((sum, tx) => sum + tx.amount, 0);
    // What the accounts held before any of this was recorded. Accounts only —
    // the policies are put back per point below.
    const opening = accountsNetWorth - total;

    // Cached per date: a busy month puts dozens of transactions on the same
    // day, and the policy figure is identical for every one of them.
    const policyOnDate = new Map<string, number>();
    const policiesOn = (date: string) => {
      let value = policyOnDate.get(date);
      if (value === undefined) {
        // Holdings join the trend the same way policies do: worth what they
        // were priced at then, and absent before their first price rather
        // than projected backwards at today it.
        value =
          sumInBase(policyContributionsAt(policies, date), rates).converted +
          sumInBase(holdingContributionsAt(holdings, date), rates).converted +
          // Property joins from the date it was bought, at today's figure.
          // There is no valuation history behind a property the way there is
          // behind a policy, so its part of the line is flat — an
          // approximation that is visibly one, rather than a house appearing
          // in years it was not owned.
          sumInBase(propertyContributionsAt(properties, date), rates).converted;
        policyOnDate.set(date, value);
      }
      return value;
    };

    const cumulative = new Map<string, number>();
    let running = opening;
    for (const tx of sorted) {
      running += tx.amount;
      cumulative.set(tx.booking_date, running + policiesOn(tx.booking_date));
    }

    /**
     * The line ends today, not at the last transaction.
     *
     * Everything that is not a transaction — a policy's valuation, a holding's
     * price, a property — is dated independently of the account history, so
     * anything valued since the last payment never reached the end of the
     * line. The card then printed one figure above a chart that finished at a
     * different one, on the same card. The balance has not moved since the
     * last transaction, so carrying `running` forward is not an assumption;
     * the only thing this adds is the part of today's figure that was already
     * being shown above it.
     */
    const todayIso = new Date().toISOString().slice(0, 10);
    const lastBooked = sorted[sorted.length - 1]?.booking_date;
    if (sorted.length > 0 && lastBooked && todayIso > lastBooked) {
      cumulative.set(todayIso, running + policiesOn(todayIso));
    }

    const start = rangeStart(netWorthRange);
    const dates = [...cumulative.keys()].filter((date) => !start || date >= start);
    if (dates.length === 0) return [];

    const first = dates[0];
    const last = dates[dates.length - 1];
    const spanDays = (Date.parse(last) - Date.parse(first)) / 86_400_000;
    const byMonth = spanDays > 100;

    if (!byMonth) {
      return dates.map((date) => ({
        label: new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }),
        value: cumulative.get(date) ?? opening,
      }));
    }

    // One point per month, taking where it stood at the month's last
    // recorded movement.
    const months = new Map<string, number>();
    for (const date of dates) months.set(date.slice(0, 7), cumulative.get(date) ?? opening);
    return [...months.entries()].map(([key, value]) => ({ label: monthLabel(key), value }));
  })();

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  // All time by default: a fresh dashboard on the 1st of the month would
  // otherwise show an empty chart and look broken.
  const categoryRange = config.ranges.category ?? "all";
  const categoryTx = categoryRange === "month" ? spendTx.filter((tx) => tx.booking_date.startsWith(thisMonthKey)) : spendTx;

  const spendByCategory = new Map<string, number>();
  for (const tx of categoryTx) {
    if (tx.amount >= 0) continue;
    const name = tx.category_id != null ? (categoryNames.get(tx.category_id) ?? "Unknown") : "Uncategorized";
    spendByCategory.set(name, (spendByCategory.get(name) ?? 0) + Math.abs(tx.amount));
  }
  // The chart is keyed by name because that is what it shows; the link needs
  // the id back. "Uncategorized" is the one row with no id and the one most
  // worth clicking, so it gets the sentinel the table understands.
  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
  const categoryRows = [...spendByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => {
      const id = categoryIdByName.get(label);
      const filter = label === "Uncategorized" ? "none" : id != null ? String(id) : null;
      // "Unknown" — a category id with no matching row — has nothing to
      // filter by, so it stays unclickable rather than linking nowhere.
      return { label, value, href: filter ? `/transactions?category=${encodeURIComponent(filter)}` : undefined };
    });

  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));

  const currencyTotals = new Map<string, number>();
  for (const a of accounts) {
    currencyTotals.set(a.currency, (currencyTotals.get(a.currency) ?? 0) + accountBalance(a, byAccount.get(a.id) ?? 0));
  }
  // Policies belong in the per-currency breakdown for the same reason they
  // belong in the headline: leaving them out would make the currencies add up
  // to less than the total sitting above them.
  for (const policy of policies) {
    const contribution = policyContribution(policy);
    if (contribution === 0) continue;
    currencyTotals.set(policy.currency, (currencyTotals.get(policy.currency) ?? 0) + contribution);
  }
  for (const property of properties) {
    const contribution = propertyContribution(property);
    if (contribution === 0) continue;
    currencyTotals.set(property.currency, (currencyTotals.get(property.currency) ?? 0) + contribution);
  }

  const recentTransactions = [...transactions]
    .sort((a, b) => b.booking_date.localeCompare(a.booking_date))
    .slice(0, 5);

  const linkedAccountCount = accounts.filter((a) => a.source === "enablebanking").length;

  // Borrowing comes from the accounts themselves rather than a separate list
  // typed in by hand: an overdrawn account is debt whatever it's called, and
  // maintaining the same figure in two places only creates a disagreement.
  const borrowing = accounts
    .filter((a) => isBorrowing(a, byAccount.get(a.id) ?? 0))
    .sort((a, b) => amountDrawn(b, byAccount.get(b.id) ?? 0) - amountDrawn(a, byAccount.get(a.id) ?? 0));
  const { converted: totalDebt } = sumInBase(
    borrowing.map((a) => ({ amount: amountDrawn(a, byAccount.get(a.id) ?? 0), currency: a.currency })),
    rates
  );


  /**
   * The month the glance widgets describe.
   *
   * Fixed to the calendar month rather than following the range picker: "this
   * month at a glance" is a claim about a month, and a strip of figures
   * covering the last ninety days under that heading would be a different
   * claim wearing the same words.
   */
  const glanceMonth = thisMonthKey;
  const previousMonthKey = new Date(Date.UTC(Number(glanceMonth.slice(0, 4)), Number(glanceMonth.slice(5, 7)) - 2, 1))
    .toISOString()
    .slice(0, 7);

  // Spending rather than every movement: a loan repayment leaves the account
  // but the money became equity in a debt, and counting it as spending here
  // would disagree with every other spending figure in the app.
  const glanceEntries = spendTx.map((tx) => ({
    amount: tx.amount,
    booking_date: tx.booking_date,
    category_id: tx.category_id,
  }));

  const budgetedTotal = budgets
    .filter((b) => !rates || b.currency === rates.base)
    .reduce((sum, b) => sum + b.monthly_limit, 0);
  const savedTotal = savingsGoals.reduce((sum, goal) => sum + goal.current_amount, 0);

  const glanceFigures = summaryFigures({
    entries: glanceEntries,
    // Credits off the full list, debits off the spending one — the same split
    // the cash-flow card makes, so the strip and the card cannot report
    // different incomes for the same month.
    flow: flowTx.map((tx) => ({ amount: tx.amount, booking_date: tx.booking_date, category_id: tx.category_id })),
    kind: categoryKind,
    anyIncomeCategory,
    month: glanceMonth,
    budgeted: budgetedTotal,
    debt: totalDebt,
    saved: savedTotal,
  });
  const glanceDays = dailySpend(glanceEntries, glanceMonth);
  const previousDays = dailySpend(glanceEntries, previousMonthKey);
  /**
   * Every category the owner has called income, occasional or not.
   *
   * Wider than `incomeCategories` above on purpose: that set drives the
   * balance projection, which must not draw a bonus or a tax refund forward
   * as if it repeated. A card reporting where the month's income came from
   * has the opposite requirement — a bonus is income, and leaving it out
   * would make the month read as though it never arrived.
   */
  const declaredIncome = new Set(categories.filter((c) => c.counts_as_income).map((c) => c.id));
  const glanceSources = incomeBySource(
    glanceEntries,
    glanceMonth,
    (id) => (id === null ? "" : (categoryNames.get(id) ?? "")),
    (id) => id != null && declaredIncome.has(id)
  );
  // The full history, for the same reason Analytics uses it: a rhythm cannot
  // be found inside a window shorter than the rhythm.
  //
  // Repayments are out of it: a loan instalment comes back every month and is
  // not a subscription, because it buys down a balance rather than paying for
  // something and cannot be stopped. `subscriptionRepayments` is what was left
  // out, so the card can say so rather than quietly totalling less.
  const dashboardHistory = excludeTransfers(fullHistoryTx, transferIds);
  const dashboardSubscriptions = subscriptions(dashboardHistory);
  const subscriptionRepayments = recurringRepayments(dashboardHistory);
  // A loan whose balance nothing is moving, beside a payment carrying that
  // loan's own name. Offered under the row, never applied unasked.
  const unclaimed = unclaimedRepayments(dashboardSubscriptions, allAccounts, rules);
  // What kind each one is, from the category it was filed under — never from
  // a list of merchants, which is what `recurring.ts` deliberately does
  // without and what would need a new entry every time a household pays for
  // something nobody thought of.
  const commitments = classifyCommitments(dashboardSubscriptions, { policies: allPolicies, categories });

  // Below the breakpoint the canvas stacks. Reading order follows the
  // arrangement on a wide screen — top to bottom, then left to right — so the
  // phone shows the same sequence rather than the order they were added in.
  const stacked = canvasWidth < STACK_BELOW;
  const orderedWidgets = [...config.enabled].sort((a, b) => {
    const ra = config.rects[a];
    const rb = config.rects[b];
    if (!ra || !rb) return 0;
    return ra.y - rb.y || ra.x - rb.x;
  });

  const widgetContent: Record<WidgetId, { headerExtra?: React.ReactNode; body: React.ReactNode }> = {
    netWorth: {
      headerExtra: (
        <select
          value={netWorthRange}
          onChange={(e) => setRange("netWorth", e.target.value as WidgetRange)}
          aria-label="Trend range"
          style={{ fontSize: "0.72rem", padding: "0.1rem 0.3rem" }}
        >
          {(Object.keys(RANGE_LABELS) as WidgetRange[]).map((range) => (
            <option key={range} value={range}>
              {RANGE_LABELS[range]}
            </option>
          ))}
        </select>
      ),
      body: (
        <NetWorthCard
          current={netWorth}
          delta={monthDelta}
          points={netWorthTrend}
          mode={config.modes.netWorth}
          currency={rates?.base}
          unconvertible={missingRates}
          countedAtCover={coveredAtCover.map((p) => p.name)}
        />
      ),
    },
    accounts: {
      headerExtra: (
        <Link to="/accounts" className="card__link">
          Manage ›
        </Link>
      ),
      body:
        accounts.length === 0 ? (
          <p className="empty-state">No accounts yet.</p>
        ) : (
          <div>
            {accounts.map((a) => (
              <div className="account-row" key={a.id}>
                <AccountAvatar name={a.name} logo={a.logo} />
                <div className="account-row__info">
                  <div className="account-row__name">{a.name}</div>
                  <div className="account-row__meta">
                    <span className="status-dot" />
                    {a.source === "enablebanking" ? "Linked" : "Manual"}
                  </div>
                </div>
                <span className="account-row__balance">
                  {formatCurrency(accountBalance(a, byAccount.get(a.id) ?? 0), a.currency)}
                </span>
              </div>
            ))}
          </div>
        ),
    },
    balances: {
      headerExtra: (
        <Link to="/accounts" className="card__link">
          Manage ›
        </Link>
      ),
      body:
        accounts.length === 0 ? (
          <p className="empty-state">No accounts yet.</p>
        ) : (
          <div>
            {accounts.map((a) => (
              <div className="account-row" key={a.id}>
                <AccountAvatar name={a.name} logo={a.logo} />
                <div className="account-row__info">
                  <div className="account-row__name">{a.name}</div>
                </div>
                <span className="account-row__balance">{formatCurrency(accountBalance(a, byAccount.get(a.id) ?? 0), a.currency)}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--border)", marginTop: "0.4rem", paddingTop: "0.4rem" }}>
              {[...currencyTotals.entries()].map(([currency, total]) => (
                <div className="account-row" key={currency} style={{ fontWeight: 600 }}>
                  <div className="account-row__info">
                    <div className="account-row__name">Total ({currency})</div>
                  </div>
                  <span className="account-row__balance">{formatCurrency(total, currency)}</span>
                </div>
              ))}
            </div>
          </div>
        ),
    },
    cashflow: {
      body: (
        <CashFlowCard
          income={income}
          otherIn={otherIn}
          expenses={expenses}
          months={monthFlows}
          currency={rates?.base ?? null}
          mode={config.modes.cashflow}
          anyIncomeCategory={anyIncomeCategory}
        />
      ),
    },
    spendingCalendar: {
      // The month on screen, not a fixed "this month": the page has a range
      // filter and a calendar that ignored it would disagree with every
      // other widget beside it.
      body: <SpendingCalendar transactions={spendTx} month={thisMonthKey} currency={rates?.base ?? null} />,
    },
    monthCompare: {
      body: (
        <MonthComparison
          transactions={spendTx}
          categoryName={(id) => (id == null ? null : (categoryNames.get(id) ?? null))}
          currency={rates?.base ?? null}
          today={forecastFrom}
        />
      ),
    },
    moneyFlow: {
      // The same transactions the cash-flow bars use, so the two agree: this
      // one is the same month broken open rather than a different reading of
      // it. `spendTx` is deliberately not used — it strips transfers and
      // repayments, which belong in a picture of where the money went.
      body: (
        <CashFlowSankey
          transactions={convertedTx}
          // The whole category, not just its name: whether a credit is income
          // cannot be read off the amount, and grouping by name alone put
          // refunds on the income side as "Transport" and "Miscellaneous".
          // The same reading the cash-flow totals use, so the card and the
          // picture of it cannot disagree.
          category={categoryKind}
          currency={rates?.base ?? null}
        />
      ),
    },
    forecast: {
      body: <CashFlowForecast forecast={forecast} currency={rates?.base ?? null} horizonDays={FORECAST_DAYS} />,
    },
    upcomingBills: {
      body: <UpcomingBills bills={bills} currency={rates?.base ?? null} from={forecastFrom} horizonDays={FORECAST_DAYS} />,
    },
    pendingReview: {
      body: (
        <PendingReviewWidget
          transactions={pendingTransactions}
          categories={categories}
          accounts={accounts}
          onApproved={refresh}
        />
      ),
    },
    transactions: {
      headerExtra: (
        <Link to="/transactions" className="card__link">
          All ›
        </Link>
      ),
      body:
        recentTransactions.length === 0 ? (
          <p className="empty-state">No transactions yet.</p>
        ) : (
          <div>
            {recentTransactions.map((tx) => (
              // A button rather than a div: this opens the same detail card
              // the transactions table opens, so it should be reachable by
              // keyboard and announce itself as something that acts.
              <button
                type="button"
                className="tx-row"
                key={tx.id}
                onClick={() => setOpenTransaction(tx)}
                style={{
                  width: "100%",
                  background: "none",
                  border: "none",
                  textAlign: "left",
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                }}
              >
                <div className="tx-row__icon">
                  {tx.amount >= 0 ? (
                    <ArrowDownRight size={15} color="var(--good)" />
                  ) : (
                    <ArrowUpRight size={15} color="var(--text-muted)" />
                  )}
                </div>
                <div className="tx-row__info">
                  <div className="tx-row__name">{tx.description || accountNames.get(tx.account_id) || "Transaction"}</div>
                  <div className="tx-row__meta">{tx.category_id != null ? categoryNames.get(tx.category_id) : "Uncategorized"}</div>
                </div>
                <span className={`tx-row__amount${tx.amount >= 0 ? " tx-row__amount--positive" : ""}`}>
                  {tx.amount >= 0 ? "+" : ""}
                  {formatCurrency(tx.amount, tx.currency)}
                </span>
              </button>
            ))}
          </div>
        ),
    },
    category: {
      headerExtra: (
        <div style={{ display: "flex", gap: "0.2rem" }}>
          {/* Which span is being totalled changes the meaning of every figure
              below it, so it is stated on the card rather than assumed. */}
          {(["month", "all"] as const).map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setRange("category", range)}
              aria-pressed={categoryRange === range}
              style={{
                fontSize: "0.7rem",
                padding: "0.15rem 0.4rem",
                fontWeight: categoryRange === range ? 600 : 400,
                opacity: categoryRange === range ? 1 : 0.6,
              }}
            >
              {range === "month" ? "This month" : "All time"}
            </button>
          ))}
        </div>
      ),
      body: <MagnitudeBarList data={categoryRows} currency={rates?.base ?? null} mode={config.modes.category} />,
    },
    budgets: {
      headerExtra: (
        <Link to="/budgets" className="card__link">
          Manage ›
        </Link>
      ),
      body:
        budgets.length === 0 ? (
          <p className="empty-state">No budgets set yet.</p>
        ) : (
          <div>
            {(() => {
              const nearLimit = budgets.filter((b) => budgetStatus(b.spent, b.monthly_limit) !== "good").length;
              return (
                nearLimit > 0 && (
                  <div className="budget-alert">
                    ⚠ {nearLimit} budget{nearLimit === 1 ? "" : "s"} near or over limit
                  </div>
                )
              );
            })()}
            {budgets.map((b) => {
              const status = budgetStatus(b.spent, b.monthly_limit);
              const pct = Math.min(100, (b.spent / b.monthly_limit) * 100);
              return (
                <div className="budget-row" key={b.id}>
                  <div className="budget-row__meta">
                    <span>{b.category_name}</span>
                    <span className="budget-row__amounts">
                      {b.spent.toFixed(2)} / {b.monthly_limit.toFixed(2)}
                    </span>
                  </div>
                  <div className="budget-row__track">
                    <div className="budget-row__fill" data-status={status} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ),
    },
    debts: {
      headerExtra: (
        <Link to="/debt-planner" className="card__link">
          Manage ›
        </Link>
      ),
      body:
        borrowing.length === 0 ? (
          <p className="empty-state">Nothing borrowed.</p>
        ) : (
          <div>
            <p className="stat-tile__label" style={{ marginBottom: "0.2rem" }}>
              Total borrowed
            </p>
            <p className="stat-tile__value" style={{ fontSize: "1.6rem", marginBottom: "0.9rem" }}>
              {rates ? formatCurrency(totalDebt, rates.base) : totalDebt.toFixed(2)}
            </p>
            {borrowing.slice(0, 4).map((a) => {
              const owed = amountDrawn(a, byAccount.get(a.id) ?? 0);
              const payment = a.loan_monthly_payment ?? 0;
              const months = owed > 0 && payment > 0 ? monthsToPayoff(owed, a.loan_rate ?? 0, payment) : null;
              return (
                <div className="account-row" key={a.id}>
                  <div className="account-row__info">
                    <div className="account-row__name">{a.name}</div>
                    <div className="account-row__meta">
                      {[
                        a.loan_rate != null ? `${a.loan_rate.toFixed(2)}%` : null,
                        months === null ? null : months === 0 ? "paid off" : `~${months} mo left`,
                        owed === 0 && a.overdraft_limit ? "facility not drawn" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No terms recorded"}
                    </div>
                  </div>
                  <span className="account-row__balance">{formatCurrency(owed, a.currency)}</span>
                </div>
              );
            })}
          </div>
        ),
    },
    savings: {
      headerExtra: (
        <Link to="/savings" className="card__link">
          Manage ›
        </Link>
      ),
      body:
        savingsGoals.length === 0 ? (
          <p className="empty-state">No savings goals yet.</p>
        ) : (
          <div>
            {savingsGoals.map((g) => {
              const pct = g.target_amount > 0 ? Math.min(100, (g.current_amount / g.target_amount) * 100) : 0;
              const reached = g.current_amount >= g.target_amount;
              return (
                <div className="budget-row" key={g.id}>
                  <div className="budget-row__meta">
                    <span>{g.name}</span>
                    <span className="budget-row__amounts">
                      {g.current_amount.toFixed(2)} / {g.target_amount.toFixed(2)}
                    </span>
                  </div>
                  <div className="budget-row__track">
                    <div className="budget-row__fill" data-status={reached ? "good" : "warning"} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ),
    },
    summary: {
      body: <SummaryStrip figures={glanceFigures} money={(value) => (rates ? formatCurrency(value, rates.base) : value.toFixed(2))} />,
    },
    expenseTrend: {
      body: (
        <ExpenseTrend
          points={glanceDays}
          lastMonth={previousDays}
          money={(value) => (rates ? formatCurrency(value, rates.base) : value.toFixed(2))}
        />
      ),
    },
    incomeSources: {
      body: (
        <IncomeSources
          sources={glanceSources}
          anyIncomeCategory={declaredIncome.size > 0}
          money={(value) => (rates ? formatCurrency(value, rates.base) : value.toFixed(2))}
        />
      ),
    },
    subscriptions: {
      headerExtra: (
        <Link to="/analytics" className="card__link">
          All ›
        </Link>
      ),
      body: (
        <Subscriptions
          payments={dashboardSubscriptions}
          currency={rates?.base ?? "EUR"}
          repayments={subscriptionRepayments}
          unclaimed={unclaimed}
          commitments={commitments}
          categories={categories}
          onFile={async (_payment, categoryId, matchText) => {
            // A rule rather than a one-off edit, for the same reason the
            // repayment is: written once and every future charge is filed by
            // it. Applying it fills blanks only, so it can never overwrite a
            // category somebody chose by hand.
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
    notes: { body: <NotesWidget /> },
    quickAdd: {
      body: (
        <QuickAdd
          accounts={accounts}
          categories={categories}
          onAdded={() => {
            api.listTransactions().then(setTransactions);
          }}
        />
      ),
    },
    // `accounts` already carries last_import_at and last_imported_date from
    // the accounts list, so this widget needs no fetch of its own.
    statementsDue: { body: <StatementsDue accounts={accounts} today={forecastFrom} /> },
  };

  const availableWidgets = WIDGET_IDS.filter((id) => !config.enabled.includes(id));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-header__subtitle">Hold a card to edit it, then drag ⠿ to move or ⌟ to resize</p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", position: "relative" }}>
          {availableWidgets.length > 0 && (
            <>
              <button className="btn-accent" onClick={() => setAddMenuOpen((v) => !v)} aria-expanded={addMenuOpen}>
                <Plus size={15} />
                Add widget
              </button>
              {addMenuOpen && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={() => setAddMenuOpen(false)} />
                  <div className="add-widget-menu">
                    {availableWidgets.map((id) => {
                      const meta = WIDGET_META[id];
                      const Icon = meta.icon;
                      return (
                        <button key={id} className="add-widget-menu__item" onClick={() => addWidget(id)}>
                          <span className="widget-icon" style={{ background: `var(${widgetAccentVar(id)})` }}>
                            <Icon size={13} />
                          </span>
                          <span>
                            <div>{meta.title}</div>
                            <div className="add-widget-menu__item-meta">{meta.module}</div>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
          <button className="btn-accent" onClick={handleSyncAll} disabled={syncingAll || linkedAccountCount === 0}>
            <RefreshCw size={15} className={syncingAll ? "spin" : undefined} />
            Sync all
          </button>
        </div>
      </div>
      {/* Absolutely-positioned children don't contribute to their parent's
          height, so the canvas is sized explicitly to fit the lowest widget.
          Its measured width is passed to each card, which clamps itself to
          fit rather than hanging off the edge on a narrow window. */}
      <div
        ref={canvasRef}
        className="dashboard-canvas"
        style={{
          position: "relative",
          height: stacked ? "auto" : computeCanvasHeight(Object.values(config.rects).filter(Boolean) as CanvasRect[]),
        }}
      >
        {orderedWidgets.map((id) => {
          const meta = WIDGET_META[id];
          const rect = config.rects[id];
          if (!rect) return null;
          return (
            <CanvasCard
              key={id}
              title={meta.title}
              icon={meta.icon}
              accentVar={widgetAccentVar(id)}
              headerExtra={widgetContent[id].headerExtra}
              rect={rect}
              minWidth={MIN_WIDGET_WIDTH}
              minHeight={MIN_WIDGET_HEIGHT}
              availableWidth={canvasWidth}
              onMove={(x, y) => moveWidget(id, x, y)}
              onResize={(width, height) => resizeWidget(id, width, height)}
              mode={meta.defaultMode ? (config.modes[id] ?? meta.defaultMode) : undefined}
              onModeChange={meta.defaultMode ? (mode) => setMode(id, mode) : undefined}
              onRemove={() => removeWidget(id)}
              stacked={stacked}
            >
              {widgetContent[id].body}
            </CanvasCard>
          );
        })}
      </div>

      {/* The same detail card the transactions table opens, so a transaction
          looks and behaves the same wherever it is clicked — and it is where
          a category gets set, which is the usual reason for opening one. */}
      {openTransaction && (
        <TransactionDetailModal
          transaction={openTransaction}
          account={accounts.find((a) => a.id === openTransaction.account_id)}
          categories={categories}
          siblings={allTransactions}
          onClose={() => setOpenTransaction(null)}
          onChange={() => {
            setOpenTransaction(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
