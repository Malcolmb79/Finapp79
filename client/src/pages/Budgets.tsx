import { Pencil, Plus, Sparkles, Target } from "lucide-react";
import BudgetAdviser from "../components/BudgetAdviser.js";
import WidgetCanvas, { type WidgetSpec } from "../components/dashboard/WidgetCanvas.js";
import { useCallback, useEffect, useState } from "react";
import { api, type Budget, type Category } from "../api/client.js";
import { budgetStatus } from "../utils/budgetStatus.js";

export default function Budgets() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [limit, setLimit] = useState("");

  const refresh = useCallback(() => {
    api.listBudgets().then(setBudgets);
  }, []);

  useEffect(() => {
    api.listCategories().then(setCategories);
    refresh();
  }, [refresh]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId || !limit) return;
    await api.setBudget(Number(categoryId), Number(limit));
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
    await api.setBudget(categoryId, parsed);
    setEditingId(null);
    refresh();
  }

  const nearLimitCount = budgets.filter((b) => budgetStatus(b.spent, b.monthly_limit) !== "good").length;
  const budgetedCategoryIds = new Set(budgets.map((b) => b.category_id));
  const availableCategories = categories.filter((c) => !budgetedCategoryIds.has(c.id));

  const widgets: WidgetSpec[] = [
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
            {budgets.length === 0 ? (
              <p className="empty-state">No budgets set yet.</p>
            ) : (
              budgets.map((b) => {
                const status = budgetStatus(b.spent, b.monthly_limit);
                const pct = Math.min(100, (b.spent / b.monthly_limit) * 100);
                return (
                  <div className="budget-row" key={b.id}>
                    <div className="budget-row__meta">
                      <span>{b.category_name}</span>
                      {/* The limit is editable in place: a figure agreed with
                          the adviser is a starting point, and changing it
                          shouldn't mean deleting the budget and setting it
                          again from the form above. */}
                      {editingId === b.id ? (
                        <span className="budget-row__amounts" style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                          {b.spent.toFixed(2)} /
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
                            {b.spent.toFixed(2)} / {b.monthly_limit.toFixed(2)}
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
          <p className="page-header__subtitle">Monthly spending limits per category · hold a card to move or resize it</p>
        </div>
      </div>

      <WidgetCanvas storageKey="budgets.layout.v1" widgets={widgets} />
    </div>
  );
}
