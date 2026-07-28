import { Inbox, List, Plus, Tag } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import CategoryManager from "../components/CategoryManager.js";
import CsvImport from "../components/CsvImport.js";
import TransactionForm from "../components/TransactionForm.js";
import TransactionTable from "../components/TransactionTable.js";
import CanvasCard from "../components/dashboard/CanvasCard.js";
import { STACK_BELOW } from "../dashboardWidgets.js";
import PendingReviewWidget from "../components/dashboard/PendingReviewWidget.js";
import { api, type Account, type Category, type PendingTransaction, type Transaction } from "../api/client.js";
import { MIN_WIDGET_HEIGHT, MIN_WIDGET_WIDTH } from "../dashboardWidgets.js";
import { useCanvasLayout } from "../utils/useCanvasLayout.js";

// Same widget shell and drag/resize behaviour as the dashboard — a widget
// should behave the same wherever it appears.
const WIDGETS = [
  { id: "pending", defaultWidth: 328, defaultHeight: 360 },
  { id: "categories", defaultWidth: 328, defaultHeight: 260 },
  { id: "add", defaultWidth: 328, defaultHeight: 280 },
  { id: "all", defaultWidth: 672, defaultHeight: 520 },
];

export default function Transactions() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pending, setPending] = useState<PendingTransaction[]>([]);

  // Stable identity so the layout hook doesn't re-seed on every render.
  const defs = useMemo(() => WIDGETS, []);
  const { rects, canvasRef, canvasWidth, height, move, resize } = useCanvasLayout("transactions.layout.v1", defs);
  const stacked = canvasWidth < STACK_BELOW;
  // Top to bottom then left to right, so a phone reads them in the order they
  // sit in on a wide screen.
  const ordered = [...defs].sort((a, b) => {
    const ra = rects[a.id];
    const rb = rects[b.id];
    if (!ra || !rb) return 0;
    return ra.y - rb.y || ra.x - rb.x;
  });

  const refresh = useCallback(() => {
    api.listTransactions().then(setTransactions);
    api.listPendingTransactions().then(setPending);
  }, []);

  const refreshCategories = useCallback(() => {
    api.listCategories().then(setCategories);
  }, []);

  useEffect(() => {
    api.listAccounts().then(setAccounts);
    refreshCategories();
    refresh();
  }, [refresh, refreshCategories]);

  const bodies: Record<string, { title: string; icon: typeof Inbox; accentVar: string; body: React.ReactNode }> = {
    pending: {
      title: "New transactions",
      icon: Inbox,
      accentVar: "--accent",
      body: <PendingReviewWidget transactions={pending} categories={categories} accounts={accounts} onApproved={refresh} />,
    },
    categories: {
      title: "Categories",
      icon: Tag,
      accentVar: "--accent-2",
      body: <CategoryManager onCreated={refreshCategories} />,
    },
    add: {
      title: "Add transactions",
      icon: Plus,
      accentVar: "--accent-3",
      body:
        accounts.length === 0 ? (
          <p className="empty-state">Add an account or link a bank before adding transactions.</p>
        ) : (
          <>
            <TransactionForm accounts={accounts} categories={categories} onCreated={refresh} />
            <CsvImport accounts={accounts} onImported={refresh} />
          </>
        ),
    },
    all: {
      title: "All transactions",
      icon: List,
      accentVar: "--accent-4",
      body: <TransactionTable transactions={transactions} categories={categories} accounts={accounts} onChange={refresh} />,
    },
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p className="page-header__subtitle">
            {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
            {pending.length > 0 && ` · ${pending.length} awaiting review`} — hold a card to move or resize it
          </p>
        </div>
      </div>

      {/* Same rule as the dashboard: a canvas arrangement means nothing once
          every widget is one column wide, and the stored positions only leave
          gaps where the neighbours used to be. */}
      <div ref={canvasRef} className="dashboard-canvas" style={{ position: "relative", height: stacked ? "auto" : height }}>
        {ordered.map((def) => {
          const rect = rects[def.id];
          const widget = bodies[def.id];
          if (!rect || !widget) return null;
          return (
            <CanvasCard
              key={def.id}
              title={widget.title}
              icon={widget.icon}
              accentVar={widget.accentVar}
              rect={rect}
              minWidth={MIN_WIDGET_WIDTH}
              minHeight={MIN_WIDGET_HEIGHT}
              availableWidth={canvasWidth}
              onMove={(x, y) => move(def.id, x, y)}
              onResize={(w, h) => resize(def.id, w, h)}
              stacked={stacked}
            >
              {widget.body}
            </CanvasCard>
          );
        })}
      </div>
    </div>
  );
}
