import { useEffect, useState } from "react";
import { api, type MonthlyPlanData, type PlanSimulation } from "../api/client.js";
import { formatCurrency } from "../utils/formatCurrency.js";

/**
 * What a month has spare, and what splitting it does.
 *
 * Income against outgoings answers "how am I doing". This is the question
 * after it: given the difference, what happens if it goes at the debt versus
 * into savings. Both sides are worked out properly rather than divided — an
 * extra payment aimed at the dearest debt moves the payoff date and the
 * interest by quite different amounts, and a plan that assumed otherwise
 * would promise a date it can't meet.
 *
 * The split is the user's to make. Nothing here recommends one.
 */

const HORIZONS = [12, 24, 36, 60];

export default function MonthlyPlan() {
  const [plan, setPlan] = useState<MonthlyPlanData | null>(null);
  const [simulation, setSimulation] = useState<PlanSimulation | null>(null);
  const [toDebtShare, setToDebtShare] = useState(50);
  const [horizon, setHorizon] = useState(24);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .monthlyPlan()
      .then(setPlan)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the figures."));
  }, []);

  const surplus = Math.max(0, plan?.surplus ?? 0);
  const toDebt = Math.round((surplus * toDebtShare) / 100);
  const toSavings = Math.round(surplus - toDebt);

  // Debounced: dragging the split would otherwise re-simulate on every pixel.
  useEffect(() => {
    if (!plan) return;
    const timer = setTimeout(() => {
      api
        .simulatePlan({ toDebt, toSavings, months: horizon })
        .then(setSimulation)
        .catch(() => setSimulation(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [plan, toDebt, toSavings, horizon]);

  if (error) return <p style={{ fontSize: "0.82rem", color: "var(--critical)" }}>{error}</p>;
  if (!plan) return <p className="empty-state">Working out where the money goes…</p>;

  const money = (value: number) => formatCurrency(value, plan.currency);
  const goalsRemaining = plan.goals.reduce((sum, g) => sum + g.remaining, 0);

  return (
    <div>
      <div className="stat-row" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginBottom: "0.7rem" }}>
        <div>
          <p className="stat-tile__label">Typical month in</p>
          <p className="stat-tile__value" style={{ fontSize: "1.2rem" }}>
            {money(plan.typicalIncome)}
          </p>
        </div>
        <div>
          <p className="stat-tile__label">Typical month out</p>
          <p className="stat-tile__value" style={{ fontSize: "1.2rem" }}>
            {money(plan.typicalSpend)}
          </p>
        </div>
        <div>
          <p className="stat-tile__label">Spare</p>
          <p
            className="stat-tile__value"
            style={{ fontSize: "1.2rem", color: plan.surplus >= 0 ? "var(--good)" : "var(--critical)" }}
          >
            {money(plan.surplus)}
          </p>
        </div>
      </div>

      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 0.7rem" }}>
        From {plan.monthsCovered.length} complete month{plan.monthsCovered.length === 1 ? "" : "s"}; the current month is
        excluded as incomplete. Debt payments already made are inside the outgoings, so the spare figure is simply what
        didn&apos;t go out.
        {plan.dropped.length > 0 && ` Excludes ${plan.dropped.join(", ")} — no exchange rate available.`}
      </p>

      {plan.surplus <= 0 ? (
        // Splitting nothing between two things is not a plan, and pretending
        // otherwise is how a planner stops being believed.
        <p className="empty-state">
          A typical month spends more than it brings in, so there is nothing spare to allocate yet. The budget adviser is
          the place to start — freeing something up here is what makes this view worth using.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <label style={{ fontSize: "0.8rem", color: "var(--text-muted)", whiteSpace: "nowrap" }} htmlFor="plan-split">
              Split the spare
            </label>
            <input
              id="plan-split"
              type="range"
              min={0}
              max={100}
              step={5}
              value={toDebtShare}
              onChange={(e) => setToDebtShare(Number(e.target.value))}
              style={{ flex: 1, minWidth: 140 }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginBottom: "0.8rem" }}>
            <span style={{ fontSize: "0.85rem" }}>
              <strong>{money(toDebt)}</strong>
              <span style={{ color: "var(--text-muted)" }}> a month at the debt</span>
            </span>
            <span style={{ fontSize: "0.85rem", textAlign: "right" }}>
              <strong>{money(toSavings)}</strong>
              <span style={{ color: "var(--text-muted)" }}> a month into savings</span>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.6rem" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Over</span>
            {HORIZONS.map((months) => (
              <button
                key={months}
                onClick={() => setHorizon(months)}
                aria-pressed={horizon === months}
                style={{ fontSize: "0.75rem", padding: "0.15rem 0.45rem", fontWeight: horizon === months ? 600 : 400 }}
              >
                {months / 12}y
              </button>
            ))}
          </div>

          {simulation && (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {simulation.debt.length === 0 ? (
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>No debts to pay down — all of it can go to savings.</p>
              ) : (
                simulation.debt.map((d) => (
                  <div key={d.currency} style={{ borderTop: "1px solid var(--gridline)", paddingTop: "0.45rem" }}>
                    <p style={{ fontSize: "0.83rem", margin: 0 }}>
                      <strong>{d.currency} debt</strong>
                      {d.now.neverClears && !d.withExtra.neverClears ? (
                        <> — clears in {d.withExtra.months} months instead of never</>
                      ) : d.withExtra.neverClears ? (
                        <> — still doesn&apos;t clear at this payment</>
                      ) : (
                        <>
                          {" "}
                          — {d.withExtra.months} months instead of {d.now.months}
                          {d.monthsSaved != null && d.monthsSaved > 0 && `, ${d.monthsSaved} sooner`}
                        </>
                      )}
                    </p>
                    {d.interestSaved > 0 && (
                      <p style={{ fontSize: "0.78rem", color: "var(--good)", margin: "0.1rem 0 0" }}>
                        {formatCurrency(d.interestSaved, d.currency)} less interest
                      </p>
                    )}
                    {d.focusOrder.length > 0 && (
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.1rem 0 0" }}>
                        The extra goes at {d.focusOrder.join(", then ")}
                      </p>
                    )}
                  </div>
                ))
              )}

              <div style={{ borderTop: "1px solid var(--gridline)", paddingTop: "0.45rem" }}>
                <p style={{ fontSize: "0.83rem", margin: 0 }}>
                  <strong>Savings</strong> — {money(simulation.savings.total)} put by over {horizon / 12} year
                  {horizon === 12 ? "" : "s"}
                </p>
                {goalsRemaining > 0 && (
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.1rem 0 0" }}>
                    {simulation.savings.total >= goalsRemaining
                      ? `Covers the ${money(goalsRemaining)} still needed across your goals.`
                      : `${money(goalsRemaining - simulation.savings.total)} short of the ${money(goalsRemaining)} your goals still need.`}
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
