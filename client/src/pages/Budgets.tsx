import { Pencil, Plus, Sparkles, Target, Wallet } from "lucide-react";
import BudgetAdviser from "../components/BudgetAdviser.js";
import WidgetCanvas, { type WidgetSpec } from "../components/dashboard/WidgetCanvas.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import EnvelopeBudget from "../components/EnvelopeBudget.js";
import { Link } from "react-router-dom";
import { api, type Account, type Budget, type Category, type Transaction } from "../api/client.js";
import { budgetStatus } from "../utils/budgetStatus.js";
import { formatCurrency } from "../utils/formatCurrency.js";

/**
 * The first of the current month, matching the window `GET /api/budgets`
 * counts `spent` over — so a drill-through from a budget opens exactly the
 * transactions that figure is made of.
 */
function monthStart(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export default function Budgets() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  // The envelopes need the history, not just this month: a carried balance
  // is the result of every month before the one on screen.
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [limit, setLimit] = useState("");
  /**
   * Which currency's budget is on screen.
   *
   * Everything else on this page converts to one base and shows a single
   * total, which is right for net worth and wrong for a budget: after a move
   * between countries the sterling accounts keep running alongside the euro
   * ones, and a cap converted into the other currency moves with the exchange
   * rate rather than with spending. So the page shows one currency at a time
   * and never adds the two together.
   */
  const [currency, setCurrency] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.listBudgets().then(setBudgets);
  }, []);

  useEffect(() => {
    api.listCategories().then(setCategories);
    api.listTransactions().then(setTransactions);
    api.listAccounts().then(setAccounts);
    refresh();
  }, [refresh]);

  // The currencies offered are the ones money is actually held in, rather than
  // a fixed list: an account closed is a tab that stops appearing.
  const currencies = useMemo(() => {
    const held = new Set<string>();
    for (const a of accounts) if (a.currency) held.add(a.currency);
    for (const b of budgets) if (b.currency) held.add(b.currency);
    return [...held].sort();
  }, [accounts, budgets]);

  // Settle on one once the accounts are known, preferring the base currency
  // the rest of the app reports in so the page opens where it did before.
  const active = currency ?? (currencies.includes("EUR") ? "EUR" : currencies[0]) ?? "EUR";

  const money = (value: number) => formatCurrency(value, active);
  const inCurrency = useMemo(() => budgets.filter((b) => b.currency === active), [budgets, active]);
  // The envelopes read the same slice: a sterling card's transactions have no
  // business against a euro envelope.
  const txInCurrency = useMemo(() => transactions.filter((t) => t.currency === active), [transactions, active]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId || !limit) return;
    await api.setBudget(Number(categoryId), Number(limit), active);
    setLimit("");
    refresh();
  }

  async function handleDelete(id: number) {
    await api.deleteBudget(id);
    refresh();
  }

  // Which budget's limit is being edited, and the figure being typed. Held as
  // a string so it can be cleared mid-edit without snapping back to the old
  // value on every keystroke.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [limitDraft, setLimitDraft] = useState("");

  async function saveLimit(categoryId: number) {
    const parsed = Number(limitDraft.replace(/,/g, "").trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setEditingId(null);
      return;
    }
    await api.setBudget(categoryId, parsed, active);
    setEditingId(null);
    refresh();
  }

  const nearLimitCount = inCurrency.filter((b) => budgetStatus(b.spent, b.monthly_limit) !== "good").length;
  // Per currency, so a category already budgeted in euros can still be given a
  // separate sterling cap.
  const budgetedCategoryIds = new Set(inCurrency.map((b) => b.category_id));
  const availableCategories = categories.filter((c) => !budgetedCategoryIds.has(c.id));

  const widgets: WidgetSpec[] = [
    {
      id: "envelopes",
      title: "Envelopes",
      icon: Wallet,
      accentVar: "--accent-2",
      defaultWidth: 672,
      defaultHeight: 480,
      render: () => <EnvelopeBudget transactions={txInCurrency} categories={categories} currency={active} />,
    },
    {
      id: "adviser",
      title: "Budget adviser",
      icon: Sparkles,
      accentVar: "--accent-2",
      defaultWidth: 672,
      defaultHeight: 460,
      render: () => <BudgetAdviser onApplied={refresh} />,
    },
    {
      id: "setBudget",
      title: "Set a budget",
      icon: Plus,
      accentVar: "--accent-3",
      defaultWidth: 672,
      defaultHeight: 200,
      render: () => (
        <>
            {availableCategories.length === 0 && categories.length > 0 ? (
              <p className="empty-state">Every category already has a budget — edit one below to change its limit.</p>
            ) : categories.length === 0 ? (
              <p className="empty-state">Create a category on the Transactions page first.</p>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Select category</option>
                  {availableCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Monthly limit"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
                <button type="submit" className="btn-accent">
                  Set budget
                </button>
              </form>
            )}
        </>
      ),
    },
    {
      id: "thisMonth",
      title: "This month",
      icon: Target,
      accentVar: "--accent",
      defaultWidth: 672,
      defaultHeight: 400,
      render: () => (
        <>
            {nearLimitCount > 0 && (
              <div className="budget-alert">
                ⚠ {nearLimitCount} budget{nearLimitCount === 1 ? "" : "s"} near or over limit
              </div>
            )}
            {inCurrency.length === 0 ? (
              <p className="empty-state">No {active} budgets set yet.</p>
            ) : (
              inCurrency.map((b) => {
                const status = budgetStatus(b.spent, b.monthly_limit);
                const pct = Math.min(100, (b.spent / b.monthly_limit) * 100);
                return (
                  <div className="budget-row" key={b.id}>
                    <div className="budget-row__meta">
                      {/* Windowed to this month, because that is what `spent`
                          counts. Linking to the category's whole history would
                          open a list adding up to a different number than the
                          one it was clicked from. */}
                      <Link
                        to={`/transactions?category=${b.category_id}&from=${monthStart()}`}
                        style={{ color: "inherit", textDecoration: "none", borderBottom: "1px dotted var(--text-muted)" }}
                        title={`Show this month's ${b.category_name} transactions`}
                      >
                        {b.category_name}
                      </Link>
                      {/* The limit is editable in place: a figure agreed with
                          the adviser is a starting point, and changing it
                          shouldn't mean deleting the budget and setting it
                          again from the form above. */}
                      {editingId === b.id ? (
                        <span className="budget-row__amounts" style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                          {money(b.spent)} /
                          <input
                            autoFocus
                            inputMode="decimal"
                            value={limitDraft}
                            onChange={(e) => setLimitDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveLimit(b.category_id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            aria-label={`Monthly limit for ${b.category_name}`}
                            style={{ width: 90, fontSize: "0.8rem", padding: "0.1rem 0.35rem" }}
                          />
                          <button onClick={() => saveLimit(b.category_id)} style={{ padding: "0.1rem 0.5rem", fontSize: "0.75rem" }}>
                            Save
                          </button>
                          <button onClick={() => setEditingId(null)} style={{ padding: "0.1rem 0.5rem", fontSize: "0.75rem" }}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <>
                          <button
                            className="budget-row__amounts"
                            onClick={() => {
                              setEditingId(b.id);
                              setLimitDraft(String(b.monthly_limit));
                            }}
                            title="Change this limit"
                            style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
                          >
                            {money(b.spent)} / {money(b.monthly_limit)}
                            <Pencil size={11} style={{ marginLeft: "0.3rem", verticalAlign: "-1px", color: "var(--text-muted)" }} />
                          </button>
                          <button onClick={() => handleDelete(b.id)} style={{ padding: "0.1rem 0.5rem", fontSize: "0.75rem" }}>
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                    <div className="budget-row__track">
                      <div className="budget-row__fill" data-status={status} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
        </>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Budgets</h1>
          <p className="page-header__subtitle">
            Monthly spending limits per category · hold a card to move or resize it
          </p>
        </div>
        {/* Shown only when there is a choice to make. One currency is the
            ordinary case, and a lone tab that cannot be switched is furniture. */}
        {currencies.length > 1 && (
          <div role="group" aria-label="Budget currency" style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {currencies.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setCurrency(code)}
                aria-pressed={code === active}
                className={code === active ? "btn-accent" : undefined}
                style={{ fontSize: "0.8rem", padding: "0.25rem 0.7rem" }}
              >
                {code}
              </button>
            ))}
          </div>
        )}
      </div>

      <WidgetCanvas storageKey="budgets.layout.v1" widgets={widgets} />
    </div>
  );
}
