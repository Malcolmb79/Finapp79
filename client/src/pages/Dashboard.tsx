import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { useEffect, useState } from "react";
import MagnitudeBarList from "../components/dashboard/MagnitudeBarList.js";
import SortableCard from "../components/dashboard/SortableCard.js";
import StatTile from "../components/dashboard/StatTile.js";
import { api, type Account, type Category, type Transaction } from "../api/client.js";

const WIDGET_IDS = ["overview", "accounts", "category", "month"] as const;
type WidgetId = (typeof WIDGET_IDS)[number];

const STORAGE_KEY = "dashboard.widgetOrder";

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
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>(loadWidgetOrder);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    api.listTransactions().then(setTransactions);
    api.listAccounts().then(setAccounts);
    api.listCategories().then(setCategories);
  }, []);

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

  const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const spend = transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0);

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

  const byMonth = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    const month = tx.booking_date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + Math.abs(tx.amount));
  }
  const monthRows = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([label, value]) => ({ label, value }));

  const byAccount = new Map<string, number>();
  for (const tx of transactions) {
    byAccount.set(tx.account_id, (byAccount.get(tx.account_id) ?? 0) + tx.amount);
  }

  const widgetContent: Record<WidgetId, { title: string; body: React.ReactNode }> = {
    overview: {
      title: "Overview",
      body: (
        <div className="stat-row">
          <StatTile label="Net total" value={total.toFixed(2)} />
          <StatTile label="Total spend" value={spend.toFixed(2)} />
          <StatTile label="Transactions" value={String(transactions.length)} />
        </div>
      ),
    },
    accounts: {
      title: "Accounts",
      body:
        accounts.length === 0 ? (
          <p className="empty-state">No accounts yet.</p>
        ) : (
          <div>
            {accounts.map((a) => (
              <div className="account-row" key={a.id}>
                <span>{a.name}</span>
                <span className="account-row__balance">{(byAccount.get(a.id) ?? 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        ),
    },
    category: { title: "Spend by category", body: <MagnitudeBarList data={categoryRows} /> },
    month: { title: "Spend by month", body: <MagnitudeBarList data={monthRows} /> },
  };

  return (
    <div>
      <h1>Dashboard</h1>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={widgetOrder} strategy={rectSortingStrategy}>
          <div className="dashboard-grid">
            {widgetOrder.map((id) => (
              <SortableCard key={id} id={id} title={widgetContent[id].title}>
                {widgetContent[id].body}
              </SortableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
