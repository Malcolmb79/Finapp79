import { ArrowDownRight, ArrowUpRight, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CashFlowCard, { type MonthFlow } from "../components/dashboard/CashFlowCard.js";
import MagnitudeBarList from "../components/dashboard/MagnitudeBarList.js";
import NetWorthCard, { type TrendPoint } from "../components/dashboard/NetWorthCard.js";
import PendingReviewWidget from "../components/dashboard/PendingReviewWidget.js";
import CanvasCard, { type WidgetMode } from "../components/dashboard/CanvasCard.js";
import {
  api,
  type Account,
  type Budget,
  type Category,
  type PendingTransaction,
  type SavingsGoal,
  type Transaction,
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
import { computeCanvasHeight, type CanvasRect } from "../utils/useCanvasItem.js";
import { useMeasuredWidth } from "../utils/useMeasuredWidth.js";
import AccountAvatar from "../components/AccountAvatar.js";
import { accountBalance, amountDrawn, isBorrowing, accountTxSums, visibleAccounts, visibleTransactions } from "../utils/accountBalance.js";
import { budgetStatus } from "../utils/budgetStatus.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { monthsToPayoff } from "../utils/payoff.js";

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

export default function Dashboard() {
  const [allTransactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);
  const [allAccounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [config, setConfig] = useState<DashboardConfig>(loadConfig);
  const [syncingAll, setSyncingAll] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [canvasRef, canvasWidth] = useMeasuredWidth(WIDE_WIDTH);
  const rates = useFxRates("EUR");
  // Hidden accounts leave every total on this page, and their transactions
  // leave with them.
  const accounts = visibleAccounts(allAccounts);
  const transactions = visibleTransactions(allTransactions, allAccounts);

  function refresh() {
    api.listTransactions().then(setTransactions);
    api.listPendingTransactions().then(setPendingTransactions);
    api.listAccounts().then(setAccounts);
    api.listCategories().then(setCategories);
    api.listBudgets().then(setBudgets);
    api.listSavingsGoals().then(setSavingsGoals);
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
  const { converted: netWorth, unconvertible } = sumInBase(balances, rates);
  // Currencies missing a rate are named wherever they affect a total, so a
  // combined figure is never shown as complete when part of it was dropped.
  const thisMonthKey = new Date().toISOString().slice(0, 7);

  // Every aggregate below combines accounts, so all of them work from
  // transactions restated in one currency. Adding a ZAR amount to a EUR one
  // gives a figure in no currency at all — confident and meaningless.
  const { items: convertedTx, dropped: droppedCurrencies } = inBase(transactions, rates);
  const missingRates = [...new Set([...unconvertible, ...droppedCurrencies])];

  const monthDelta = convertedTx
    .filter((tx) => tx.booking_date.startsWith(thisMonthKey))
    .reduce((sum, tx) => sum + tx.amount, 0);

  const income = convertedTx.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const expenses = Math.abs(convertedTx.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0));

  const monthKeys = [...new Set(convertedTx.map((tx) => tx.booking_date.slice(0, 7)))].sort().slice(-6);
  const monthFlows: MonthFlow[] = monthKeys.map((key) => {
    const monthTx = convertedTx.filter((tx) => tx.booking_date.startsWith(key));
    return {
      label: monthLabel(key),
      income: monthTx.filter((tx) => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0),
      expenses: Math.abs(monthTx.filter((tx) => tx.amount < 0).reduce((s, tx) => s + tx.amount, 0)),
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
   */
  const netWorthTrend: TrendPoint[] = (() => {
    if (convertedTx.length === 0) return [];

    const sorted = [...convertedTx].sort((a, b) => a.booking_date.localeCompare(b.booking_date));
    const total = sorted.reduce((sum, tx) => sum + tx.amount, 0);
    // What the accounts held before any of this was recorded.
    const opening = netWorth - total;

    const cumulative = new Map<string, number>();
    let running = opening;
    for (const tx of sorted) {
      running += tx.amount;
      cumulative.set(tx.booking_date, running);
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
  const categoryTx = categoryRange === "month" ? convertedTx.filter((tx) => tx.booking_date.startsWith(thisMonthKey)) : convertedTx;

  const spendByCategory = new Map<string, number>();
  for (const tx of categoryTx) {
    if (tx.amount >= 0) continue;
    const name = tx.category_id != null ? (categoryNames.get(tx.category_id) ?? "Unknown") : "Uncategorized";
    spendByCategory.set(name, (spendByCategory.get(name) ?? 0) + Math.abs(tx.amount));
  }
  const categoryRows = [...spendByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));

  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));

  const currencyTotals = new Map<string, number>();
  for (const a of accounts) {
    currencyTotals.set(a.currency, (currencyTotals.get(a.currency) ?? 0) + accountBalance(a, byAccount.get(a.id) ?? 0));
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
      body: <CashFlowCard income={income} expenses={expenses} months={monthFlows} currency={rates?.base ?? null} mode={config.modes.cashflow} />,
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
              <div className="tx-row" key={tx.id}>
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
              </div>
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
    </div>
  );
}
