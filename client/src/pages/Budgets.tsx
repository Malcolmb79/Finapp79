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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Budgets</h1>
          <p className="page-header__subtitle">Monthly spending limits per category</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div className="card__header">
          <h2 className="card__title">Set a budget</h2>
        </div>
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
      </div>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">This month</h2>
        </div>
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
      </div>
    </div>
  );
}
