import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { ArrowDownRight, ArrowUpRight, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CashFlowCard, { type MonthFlow } from "../components/dashboard/CashFlowCard.js";
import MagnitudeBarList from "../components/dashboard/MagnitudeBarList.js";
import NetWorthCard, { type TrendPoint } from "../components/dashboard/NetWorthCard.js";
import SortableCard, { type WidgetMode, type WidgetSize } from "../components/dashboard/SortableCard.js";
import { api, type Account, type Budget, type Category, type Debt, type SavingsGoal, type Transaction } from "../api/client.js";
import { WIDGET_IDS, WIDGET_META, widgetAccentVar, type WidgetId } from "../dashboardWidgets.js";
import AccountAvatar from "../components/AccountAvatar.js";
import { budgetStatus } from "../utils/budgetStatus.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { monthsToPayoff } from "../utils/payoff.js";

interface DashboardConfig {
  enabled: WidgetId[];
  sizes: Partial<Record<WidgetId, WidgetSize>>;
  modes: Partial<Record<WidgetId, WidgetMode>>;
}

const STORAGE_KEY = "dashboard.config.v1";
const LEGACY_STORAGE_KEY = "dashboard.widgetOrder.v3";

function defaultConfig(): DashboardConfig {
  return {
    enabled: WIDGET_IDS.filter((id) => WIDGET_META[id].defaultEnabled),
    sizes: Object.fromEntries(WIDGET_IDS.map((id) => [id, WIDGET_META[id].defaultSize])),
    modes: Object.fromEntries(WIDGET_IDS.filter((id) => WIDGET_META[id].defaultMode).map((id) => [id, WIDGET_META[id].defaultMode])),
  };
}

function loadConfig(): DashboardConfig {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (stored && Array.isArray(stored.enabled)) {
      return {
        enabled: stored.enabled.filter((id: string) => (WIDGET_IDS as readonly string[]).includes(id)),
        sizes: stored.sizes ?? {},
        modes: stored.modes ?? {},
      };
    }
  } catch {
    // fall through
  }

  // Migrate the pre-configurability layout (just an order, no sizes/modes/
  // add-remove) so upgrading doesn't silently reset anyone's dashboard.
  try {
    const legacyOrder = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null");
    if (Array.isArray(legacyOrder) && legacyOrder.length > 0) {
      const enabled = legacyOrder.filter((id: string) => (WIDGET_IDS as readonly string[]).includes(id));
      const base = defaultConfig();
      return { enabled, sizes: base.sizes, modes: base.modes };
    }
  } catch {
    // fall through
  }

  return defaultConfig();
}

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [config, setConfig] = useState<DashboardConfig>(loadConfig);
  const [syncingAll, setSyncingAll] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function refresh() {
    api.listTransactions().then(setTransactions);
    api.listAccounts().then(setAccounts);
    api.listCategories().then(setCategories);
    api.listBudgets().then(setBudgets);
    api.listDebts().then(setDebts);
    api.listSavingsGoals().then(setSavingsGoals);
  }

  useEffect(refresh, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setConfig((c) => {
      const oldIndex = c.enabled.indexOf(active.id as WidgetId);
      const newIndex = c.enabled.indexOf(over.id as WidgetId);
      return { ...c, enabled: arrayMove(c.enabled, oldIndex, newIndex) };
    });
  }

  function addWidget(id: WidgetId) {
    setConfig((c) => (c.enabled.includes(id) ? c : { ...c, enabled: [...c.enabled, id] }));
    setAddMenuOpen(false);
  }

  function removeWidget(id: WidgetId) {
    setConfig((c) => ({ ...c, enabled: c.enabled.filter((x) => x !== id) }));
  }

  function setSize(id: WidgetId, size: WidgetSize) {
    setConfig((c) => ({ ...c, sizes: { ...c.sizes, [id]: size } }));
  }

  function setMode(id: WidgetId, mode: WidgetMode) {
    setConfig((c) => ({ ...c, modes: { ...c.modes, [id]: mode } }));
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

  const netWorth = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const monthDelta = transactions
    .filter((tx) => tx.booking_date.startsWith(thisMonthKey))
    .reduce((sum, tx) => sum + tx.amount, 0);

  const income = transactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const expenses = Math.abs(transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0));

  const monthKeys = [...new Set(transactions.map((tx) => tx.booking_date.slice(0, 7)))].sort().slice(-6);
  const monthFlows: MonthFlow[] = monthKeys.map((key) => {
    const monthTx = transactions.filter((tx) => tx.booking_date.startsWith(key));
    return {
      label: key.slice(5),
      income: monthTx.filter((tx) => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0),
      expenses: Math.abs(monthTx.filter((tx) => tx.amount < 0).reduce((s, tx) => s + tx.amount, 0)),
    };
  });

  const netWorthTrend: TrendPoint[] = (() => {
    const sorted = [...monthKeys];
    let running = transactions
      .filter((tx) => sorted.length > 0 && tx.booking_date < `${sorted[0]}-01`)
      .reduce((s, tx) => s + tx.amount, 0);
    return sorted.map((key) => {
      running += transactions.filter((tx) => tx.booking_date.startsWith(key)).reduce((s, tx) => s + tx.amount, 0);
      return { label: key.slice(5), value: running };
    });
  })();

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const spendByCategory = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    const name = tx.category_id != null ? (categoryNames.get(tx.category_id) ?? "Unknown") : "Uncategorized";
    spendByCategory.set(name, (spendByCategory.get(name) ?? 0) + Math.abs(tx.amount));
  }
  const categoryRows = [...spendByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));

  const byAccount = new Map<string, number>();
  for (const tx of transactions) {
    byAccount.set(tx.account_id, (byAccount.get(tx.account_id) ?? 0) + tx.amount);
  }
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));

  const currencyTotals = new Map<string, number>();
  for (const a of accounts) {
    currencyTotals.set(a.currency, (currencyTotals.get(a.currency) ?? 0) + (byAccount.get(a.id) ?? 0));
  }

  const recentTransactions = [...transactions]
    .sort((a, b) => b.booking_date.localeCompare(a.booking_date))
    .slice(0, 5);

  const linkedAccountCount = accounts.filter((a) => a.source === "enablebanking").length;

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
  const debtsByApr = [...debts].sort((a, b) => b.apr - a.apr).slice(0, 4);

  const widgetContent: Record<WidgetId, { headerExtra?: React.ReactNode; body: React.ReactNode }> = {
    netWorth: {
      body: <NetWorthCard current={netWorth} delta={monthDelta} points={netWorthTrend} mode={config.modes.netWorth} />,
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
                <span className="account-row__balance">{(byAccount.get(a.id) ?? 0).toFixed(2)}</span>
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
                <span className="account-row__balance">{formatCurrency(byAccount.get(a.id) ?? 0, a.currency)}</span>
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
      body: <CashFlowCard income={income} expenses={expenses} months={monthFlows} mode={config.modes.cashflow} />,
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
                  {tx.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        ),
    },
    category: { body: <MagnitudeBarList data={categoryRows} mode={config.modes.category} /> },
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
        debts.length === 0 ? (
          <p className="empty-state">No debts tracked yet.</p>
        ) : (
          <div>
            <p className="stat-tile__label" style={{ marginBottom: "0.2rem" }}>
              Total debt
            </p>
            <p className="stat-tile__value" style={{ fontSize: "1.6rem", marginBottom: "0.9rem" }}>
              {totalDebt.toFixed(2)}
            </p>
            {debtsByApr.map((d) => {
              const months = monthsToPayoff(d.balance, d.apr, d.minimum_payment);
              return (
                <div className="account-row" key={d.id}>
                  <div className="account-row__info">
                    <div className="account-row__name">{d.name}</div>
                    <div className="account-row__meta">
                      {d.apr.toFixed(2)}% APR · {months === null ? "won't pay off at minimum" : `~${months} mo left`}
                    </div>
                  </div>
                  <span className="account-row__balance">{d.balance.toFixed(2)}</span>
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
          <p className="page-header__subtitle">Drag cards to rearrange, or use each widget's gear icon to resize it</p>
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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={config.enabled} strategy={rectSortingStrategy}>
          <div className="dashboard-grid">
            {config.enabled.map((id) => {
              const meta = WIDGET_META[id];
              return (
                <SortableCard
                  key={id}
                  id={id}
                  title={meta.title}
                  icon={meta.icon}
                  accentVar={widgetAccentVar(id)}
                  headerExtra={widgetContent[id].headerExtra}
                  size={config.sizes[id] ?? meta.defaultSize}
                  onSizeChange={(size) => setSize(id, size)}
                  mode={meta.defaultMode ? (config.modes[id] ?? meta.defaultMode) : undefined}
                  onModeChange={meta.defaultMode ? (mode) => setMode(id, mode) : undefined}
                  onRemove={() => removeWidget(id)}
                >
                  {widgetContent[id].body}
                </SortableCard>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
