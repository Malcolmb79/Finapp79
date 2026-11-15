import { Pencil, PiggyBank, Plus } from "lucide-react";
import WidgetCanvas, { type WidgetSpec } from "../components/dashboard/WidgetCanvas.js";
import { useCallback, useEffect, useState } from "react";
import { api, type GoalForecast, type SavingsGoal } from "../api/client.js";
import { errorMessage } from "../utils/errorMessage.js";
import { formatCurrency } from "../utils/formatCurrency.js";

/**
 * A target date is what somebody hoped for; the forecast is what the money
 * says. Shown together rather than instead of each other - the gap between
 * them is the useful part, and replacing the chosen date would hide whether
 * the plan is on course or was always optimistic.
 */
function monthName(month: string): string {
  const [year, m] = month.split("-");
  return ["January","February","March","April","May","June","July","August","September","October","November","December"][+m - 1] + " " + year;
}

function ForecastLine({
  forecast,
  currency,
  requiredPerMonth,
  targetDate,
}: {
  forecast: GoalForecast;
  currency: string;
  requiredPerMonth?: number | null;
  targetDate?: string | null;
}) {
  if (forecast.months === null) {
    return <span style={{ color: "var(--warning)" }}>{forecast.reason}</span>;
  }
  if (forecast.months === 0) return <span style={{ color: "var(--good)" }}>Already there.</span>;

  const money = (v: number) => formatCurrency(v, currency);
  const next = forecast.milestones[0];
  return (
    <>
      <span>
        On what you are putting aside now, <strong>{monthName(forecast.reachedIn!)}</strong>
        {forecast.months === 1 ? " — next month" : ` — ${forecast.months} months`}.
      </span>
      {/* The single most useful thing the projection knows: the saving is not
          flat, and the date depends on a debt finishing. */}
      {next && (
        <span style={{ color: "var(--text-muted)" }}>
          {" "}
          Clearing {next.name} takes it to {money(next.savingAfter)} a month.
        </span>
      )}
      {/* The chosen date, costed. Two numbers that disagree are a decision
          rather than a contradiction: move the date, or find the difference. */}
      {requiredPerMonth != null && targetDate && (
        <span>
          {" "}
          To hit {targetDate} instead you would need <strong>{money(requiredPerMonth)}</strong> a month.
        </span>
      )}
      {/* Said plainly, because a date that depends on months where nothing
          goes in is a different promise from one that does not. */}
      {forecast.deficitMonths > 0 && (
        <span style={{ color: "var(--warning)" }}>
          {" "}
          {forecast.deficitMonths === 1 ? "One month ahead spends" : `${forecast.deficitMonths} months ahead spend`} more
          than they bring in, so nothing goes in then.
        </span>
      )}
    </>
  );
}

function GoalRow({
  goal,
  forecast,
  requiredPerMonth,
  currency,
  onChanged,
}: {
  goal: SavingsGoal;
  forecast?: GoalForecast;
  requiredPerMonth?: number | null;
  currency: string;
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState("");
  /**
   * Editing the target in place rather than through a delete and a re-create.
   *
   * A target is a decision somebody revises - after a forecast disagrees with
   * it, or because the deposit turned out to need a buffer on top - and
   * revising it by deleting the goal would take the contributions with it.
   */
  const [editing, setEditing] = useState(false);
  const [targetDraft, setTargetDraft] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pct = goal.target_amount > 0 ? Math.min(100, (goal.current_amount / goal.target_amount) * 100) : 0;
  const reached = goal.current_amount >= goal.target_amount;

  function startEditing() {
    setTargetDraft(String(goal.target_amount));
    setDateDraft(goal.target_date ?? "");
    setError(null);
    setEditing(true);
  }

  async function saveEdits() {
    const target = Number(targetDraft.replace(/[,\s]/g, ""));
    if (!Number.isFinite(target) || target <= 0) {
      setError("A target has to be a positive amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateSavingsGoal(goal.id, { target_amount: target, target_date: dateDraft || null });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that."));
    } finally {
      setSaving(false);
    }
  }

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
        {editing ? (
          <span className="budget-row__amounts" style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
            <input
              autoFocus
              inputMode="decimal"
              value={targetDraft}
              onChange={(e) => setTargetDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdits();
                if (e.key === "Escape") setEditing(false);
              }}
              aria-label={`Target for ${goal.name}`}
              style={{ width: 100, fontSize: "0.8rem", padding: "0.1rem 0.35rem" }}
            />
            <input
              type="date"
              value={dateDraft}
              onChange={(e) => setDateDraft(e.target.value)}
              aria-label={`Target date for ${goal.name}`}
              style={{ width: 140, fontSize: "0.8rem", padding: "0.1rem 0.35rem" }}
            />
            <button onClick={saveEdits} disabled={saving} style={{ fontSize: "0.75rem", padding: "0.1rem 0.5rem" }}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} disabled={saving} style={{ fontSize: "0.75rem", padding: "0.1rem 0.5rem" }}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="budget-row__amounts"
            onClick={startEditing}
            title="Change the target or the date"
            style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
          >
            {goal.current_amount.toFixed(2)} / {goal.target_amount.toFixed(2)}
            <Pencil size={11} style={{ marginLeft: "0.3rem", verticalAlign: "-1px", color: "var(--text-muted)" }} />
          </button>
        )}
      </div>
      <div className="budget-row__track">
        <div className="budget-row__fill" data-status={reached ? "good" : "warning"} style={{ width: `${pct}%` }} />
      </div>
      {error && <p style={{ fontSize: "0.76rem", color: "var(--critical)", margin: "0.3rem 0 0" }}>{error}</p>}
      {forecast && (
        <p style={{ fontSize: "0.76rem", margin: "0.4rem 0 0", lineHeight: 1.45 }}>
          <ForecastLine
            forecast={forecast}
            currency={currency}
            requiredPerMonth={requiredPerMonth}
            targetDate={goal.target_date}
          />
        </p>
      )}
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
  // The forecast comes from the plan, where the surplus and the debts already
  // are, rather than being worked out a second time here and disagreeing.
  const [forecasts, setForecasts] = useState<Map<number, GoalForecast>>(new Map());
  const [required, setRequired] = useState<Map<number, number | null>>(new Map());
  const [currency, setCurrency] = useState("EUR");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const refresh = useCallback(() => {
    api.listSavingsGoals().then(setGoals);
    api
      .monthlyPlan()
      .then((plan) => {
        setCurrency(plan.currency);
        setForecasts(new Map(plan.goals.map((g) => [g.id, g.forecast])));
        setRequired(new Map(plan.goals.map((g) => [g.id, g.requiredPerMonth])));
      })
      // A goal still shows and still takes contributions without a projection
      // beside it; only the line is missing.
      .catch(() => setForecasts(new Map()));
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

  const widgets: WidgetSpec[] = [
    {
      id: "addGoal",
      title: "Add a goal",
      icon: Plus,
      accentVar: "--accent-3",
      defaultWidth: 672,
      defaultHeight: 180,
      render: () => (
        <form onSubmit={handleCreate} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input placeholder="Goal name (e.g. Vacation)" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="number" step="0.01" min="0" placeholder="Target amount" value={target} onChange={(e) => setTarget(e.target.value)} />
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} title="Target date (optional)" />
          <button type="submit" className="btn-accent">
            Add goal
          </button>
        </form>
      ),
    },
    {
      id: "goals",
      title: "Your goals",
      icon: PiggyBank,
      accentVar: "--accent",
      defaultWidth: 672,
      defaultHeight: 400,
      render: () =>
        goals.length === 0 ? (
          <p className="empty-state">No savings goals yet.</p>
        ) : (
          <>
            {goals.map((g) => (
              <GoalRow key={g.id} goal={g} forecast={forecasts.get(g.id)} requiredPerMonth={required.get(g.id)} currency={currency} onChanged={refresh} />
            ))}
          </>
        ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Savings</h1>
          <p className="page-header__subtitle">Set goals and track progress toward them · hold a card to move or resize it</p>
        </div>
      </div>

      <WidgetCanvas storageKey="savings.layout.v1" widgets={widgets} />
    </div>
  );
}
