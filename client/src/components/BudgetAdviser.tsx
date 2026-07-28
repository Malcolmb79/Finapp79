import { Check, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { api, type BudgetAdvice, type BudgetProposal } from "../api/client.js";
import { formatCurrency } from "../utils/formatCurrency.js";

/**
 * Recommended monthly limits, from what has actually been spent.
 *
 * Nothing here applies itself. Each recommendation is shown against the
 * category's own history — what it typically costs, its worst month, and what
 * the figures alone would suggest before any advice — so it can be judged
 * rather than taken. A budget someone didn't choose is one they abandon.
 *
 * Not fetched on mount: it costs a model call, and a page that spends one
 * every time it is opened spends most of them on nobody looking.
 */
export default function BudgetAdviser({ onApplied }: { onApplied: () => void }) {
  const [advice, setAdvice] = useState<BudgetAdvice | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function fetchAdvice() {
    setLoading(true);
    setError(null);
    try {
      setAdvice(await api.budgetAdvice());
      setApplied(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach the adviser.");
    } finally {
      setLoading(false);
    }
  }

  async function apply(proposal: BudgetProposal) {
    if (proposal.categoryId == null) return;
    setApplying(proposal.category);
    try {
      await api.setBudget(proposal.categoryId, proposal.monthlyLimit);
      setApplied((current) => new Set(current).add(proposal.category));
      onApplied();
    } finally {
      setApplying(null);
    }
  }

  const currency = advice?.analysis.currency ?? "EUR";
  const money = (value: number) => formatCurrency(value, currency);
  // Only the ones that would actually reduce spending, and only the ones not
  // already taken — a total that includes what you've applied keeps promising
  // a saving you've already made.
  const outstanding = (advice?.proposals ?? []).filter((p) => !applied.has(p.category));
  const totalSaving = outstanding.reduce((sum, p) => sum + Math.max(0, p.monthlySaving), 0);

  return (
    <div>
      {!advice && (
        <>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 0.6rem" }}>
            Reads the last six complete months and recommends a monthly limit per category — where the spending is
            discretionary and rising, and where it's simply erratic and needs room rather than a tighter number.
          </p>
          <button className="btn-accent" onClick={fetchAdvice} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            {loading ? "Working through it…" : "Build me a plan"}
          </button>
        </>
      )}

      {error && <p style={{ fontSize: "0.8rem", color: "var(--critical)" }}>{error}</p>}

      {advice && (
        <>
          <p style={{ fontSize: "0.85rem", lineHeight: 1.5, margin: "0 0 0.6rem" }}>{advice.summary}</p>

          <div className="stat-row" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginBottom: "0.8rem" }}>
            <div>
              <p className="stat-tile__label">Typical month in</p>
              <p className="stat-tile__value" style={{ fontSize: "1.1rem" }}>
                {money(advice.analysis.typicalIncome)}
              </p>
            </div>
            <div>
              <p className="stat-tile__label">Typical month out</p>
              <p className="stat-tile__value" style={{ fontSize: "1.1rem" }}>
                {money(advice.analysis.typicalSpend)}
              </p>
            </div>
            <div>
              <p className="stat-tile__label">These changes save</p>
              <p className="stat-tile__value" style={{ fontSize: "1.1rem", color: totalSaving > 0 ? "var(--good)" : undefined }}>
                {money(totalSaving)}
              </p>
            </div>
          </div>

          {advice.dropped.length > 0 && (
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
              Excludes spending in {advice.dropped.join(", ")} — no exchange rate available.
            </p>
          )}

          {advice.proposals.length === 0 ? (
            <p className="empty-state">Nothing worth changing — the categories with real spending are already sensibly set.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {advice.proposals.map((p) => {
                const done = applied.has(p.category);
                const tighter = p.currentLimit != null && p.monthlyLimit < p.currentLimit;
                return (
                  <div key={p.category} style={{ borderTop: "1px solid var(--gridline)", paddingTop: "0.5rem" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                      <strong style={{ fontSize: "0.88rem" }}>{p.category}</strong>
                      <span style={{ fontSize: "0.85rem" }}>
                        {p.currentLimit != null ? (
                          <>
                            {money(p.currentLimit)} → <strong>{money(p.monthlyLimit)}</strong>
                          </>
                        ) : (
                          <>
                            set to <strong>{money(p.monthlyLimit)}</strong>
                          </>
                        )}
                      </span>
                      {p.monthlySaving > 0 && (
                        <span style={{ fontSize: "0.78rem", color: "var(--good)" }}>saves {money(p.monthlySaving)}/mo</span>
                      )}
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{p.confidence} confidence</span>
                    </div>

                    <p style={{ fontSize: "0.8rem", margin: "0.2rem 0" }}>{p.reason}</p>

                    {/* The history the recommendation was made from, so it can
                        be checked rather than trusted — and so a limit below
                        the worst month is visibly that. */}
                    <p style={{ fontSize: "0.73rem", color: "var(--text-muted)", margin: "0 0 0.35rem" }}>
                      Typically {money(p.typical)}/mo · worst month {money(p.highest)} · history alone suggests{" "}
                      {money(p.baseline)}
                      {p.monthlyLimit < p.highest && tighter ? " · below your worst month, so expect some months to breach it" : ""}
                    </p>

                    <button onClick={() => apply(p)} disabled={done || applying === p.category || p.categoryId == null}>
                      {done ? (
                        <>
                          <Check size={13} /> Applied
                        </>
                      ) : applying === p.category ? (
                        "Applying…"
                      ) : (
                        "Use this limit"
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <button onClick={fetchAdvice} disabled={loading} style={{ marginTop: "0.7rem", fontSize: "0.78rem" }}>
            {loading ? "Working through it…" : "Look again"}
          </button>
        </>
      )}
    </div>
  );
}
