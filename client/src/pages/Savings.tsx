import { useCallback, useEffect, useState } from "react";
import { api, type SavingsGoal } from "../api/client.js";

function GoalRow({ goal, onChanged }: { goal: SavingsGoal; onChanged: () => void }) {
  const [amount, setAmount] = useState("");
  const pct = goal.target_amount > 0 ? Math.min(100, (goal.current_amount / goal.target_amount) * 100) : 0;
  const reached = goal.current_amount >= goal.target_amount;

  async function handleContribute(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!value) return;
    await api.contributeSavingsGoal(goal.id, value);
    setAmount("");
    onChanged();
  }

  async function handleDelete() {
    await api.deleteSavingsGoal(goal.id);
    onChanged();
  }

  return (
    <div className="budget-row">
      <div className="budget-row__meta">
        <span>
          {goal.name}
          {goal.target_date ? ` · by ${goal.target_date}` : ""}
        </span>
        <span className="budget-row__amounts">
          {goal.current_amount.toFixed(2)} / {goal.target_amount.toFixed(2)}
        </span>
      </div>
      <div className="budget-row__track">
        <div className="budget-row__fill" data-status={reached ? "good" : "warning"} style={{ width: `${pct}%` }} />
      </div>
      <form onSubmit={handleContribute} style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
        <input
          type="number"
          step="0.01"
          placeholder="Add contribution"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: 140 }}
        />
        <button type="submit">Add</button>
        <button type="button" onClick={handleDelete}>
          Remove
        </button>
      </form>
    </div>
  );
}

export default function Savings() {
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const refresh = useCallback(() => {
    api.listSavingsGoals().then(setGoals);
  }, []);

  useEffect(refresh, [refresh]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !target) return;
    await api.createSavingsGoal({ name: name.trim(), target_amount: Number(target), target_date: targetDate || null });
    setName("");
    setTarget("");
    setTargetDate("");
    refresh();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Savings</h1>
          <p className="page-header__subtitle">Set goals and track progress toward them</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div className="card__header">
          <h2 className="card__title">Add a goal</h2>
        </div>
        <form onSubmit={handleCreate} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input placeholder="Goal name (e.g. Vacation)" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="number" step="0.01" min="0" placeholder="Target amount" value={target} onChange={(e) => setTarget(e.target.value)} />
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} title="Target date (optional)" />
          <button type="submit" className="btn-accent">
            Add goal
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">Your goals</h2>
        </div>
        {goals.length === 0 ? (
          <p className="empty-state">No savings goals yet.</p>
        ) : (
          goals.map((g) => <GoalRow key={g.id} goal={g} onChanged={refresh} />)
        )}
      </div>
    </div>
  );
}
