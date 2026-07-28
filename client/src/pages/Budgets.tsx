import { Plus, Sparkles, Target } from "lucide-react";
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
                      <span className="budget-row__amounts">
                        {b.spent.toFixed(2)} / {b.monthly_limit.toFixed(2)}
                      </span>
                      <button onClick={() => handleDelete(b.id)} style={{ padding: "0.1rem 0.5rem", fontSize: "0.75rem" }}>
                        Remove
                      </button>
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
