import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { ArrowDownRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CashFlowCard, { type MonthFlow } from "../components/dashboard/CashFlowCard.js";
import MagnitudeBarList from "../components/dashboard/MagnitudeBarList.js";
import NetWorthCard, { type TrendPoint } from "../components/dashboard/NetWorthCard.js";
import SortableCard from "../components/dashboard/SortableCard.js";
import { api, type Account, type Budget, type Category, type Transaction } from "../api/client.js";
import { avatarColorVar, initials } from "../utils/avatarColor.js";
import { budgetStatus } from "../utils/budgetStatus.js";

const WIDGET_IDS = ["netWorth", "accounts", "cashflow", "transactions", "category", "budgets"] as const;
type WidgetId = (typeof WIDGET_IDS)[number];

const STORAGE_KEY = "dashboard.widgetOrder.v3";

function loadWidgetOrder(): WidgetId[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (Array.isArray(stored) && WIDGET_IDS.every((id) => stored.includes(id)) && stored.length === WIDGET_IDS.length) {
      return stored;
    }
  } catch {
    // fall through to default
  }
  return [...WIDGET_IDS];
}

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>(loadWidgetOrder);
  const [syncingAll, setSyncingAll] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function refresh() {
    api.listTransactions().then(setTransactions);
    api.listAccounts().then(setAccounts);
    api.listCategories().then(setCategories);
    api.listBudgets().then(setBudgets);
  }

  useEffect(refresh, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgetOrder));
  }, [widgetOrder]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWidgetOrder((order) => {
      const oldIndex = order.indexOf(active.id as WidgetId);
      const newIndex = order.indexOf(over.id as WidgetId);
      return arrayMove(order, oldIndex, newIndex);
    });
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

  const recentTransactions = [...transactions]
    .sort((a, b) => b.booking_date.localeCompare(a.booking_date))
    .slice(0, 5);

  const linkedAccountCount = accounts.filter((a) => a.source === "enablebanking").length;

  const widgetContent: Record<WidgetId, { title: string; span?: 2; headerExtra?: React.ReactNode; body: React.ReactNode }> = {
    netWorth: {
      title: "Net worth",
      span: 2,
      body: <NetWorthCard current={netWorth} delta={monthDelta} points={netWorthTrend} />,
    },
    accounts: {
      title: "Accounts",
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
                <div className="avatar-chip" style={{ background: avatarColorVar(a.name) }}>
                  {initials(a.name)}
                </div>
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
    cashflow: {
      title: "Monthly cash flow",
      span: 2,
      body: <CashFlowCard income={income} expenses={expenses} months={monthFlows} />,
    },
    transactions: {
      title: "Recent transactions",
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
    category: { title: "Spending by category", body: <MagnitudeBarList data={categoryRows} /> },
    budgets: {
      title: "Budgets",
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
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-header__subtitle">Drag cards to rearrange</p>
        </div>
        <button className="btn-accent" onClick={handleSyncAll} disabled={syncingAll || linkedAccountCount === 0}>
          <RefreshCw size={15} className={syncingAll ? "spin" : undefined} />
          Sync all
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={widgetOrder} strategy={rectSortingStrategy}>
          <div className="dashboard-grid">
            {widgetOrder.map((id) => (
              <SortableCard key={id} id={id} title={widgetContent[id].title} span={widgetContent[id].span} headerExtra={widgetContent[id].headerExtra}>
                {widgetContent[id].body}
              </SortableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
