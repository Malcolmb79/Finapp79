import { Check, Loader2, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { api, type AdvisorMessage, type BudgetAdvice, type BudgetProposal } from "../api/client.js";
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
  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

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

  /**
   * A figure settled in conversation replaces the one recommended outright.
   * Two buttons for the same category — one from the plan, one from talking
   * it down — is the argument left visible on screen with no way to tell
   * which is current.
   */
  async function send(text: string) {
    const question = text.trim();
    if (!question || sending) return;
    const next = [...messages, { role: "user" as const, content: question }];
    setMessages(next);
    setDraft("");
    setSending(true);
    try {
      const { reply, proposals } = await api.budgetChat(next);
      setMessages([...next, { role: "assistant", content: reply }]);
      if (proposals.length > 0) {
        setAdvice((current) => {
          const base = current ?? { summary: "", proposals: [], analysis: { monthsCovered: [], typicalIncome: 0, typicalSpend: 0, currency: "EUR" }, dropped: [] };
          const merged = [...base.proposals];
          for (const proposal of proposals) {
            const index = merged.findIndex((p) => p.category === proposal.category);
            if (index >= 0) merged[index] = proposal;
            else merged.push(proposal);
          }
          return { ...base, proposals: merged };
        });
        // A category re-agreed after being applied is no longer applied.
        setApplied((current) => {
          const nextApplied = new Set(current);
          for (const proposal of proposals) nextApplied.delete(proposal.category);
          return nextApplied;
        });
      }
    } catch (err) {
      setMessages(messages);
      setDraft(question);
      setError(err instanceof Error ? err.message : "Couldn't reach the adviser.");
    } finally {
      setSending(false);
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

      {/* Available before a plan is built as well as after: "what am I
          actually spending on groceries" is a fair first question, and
          answering it doesn't need a full set of recommendations first. */}
      <div style={{ borderTop: "1px solid var(--gridline)", marginTop: "0.8rem", paddingTop: "0.6rem" }}>
        {messages.length === 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.5rem" }}>
            {["Where can I realistically cut?", "That's too tight — what else could give?", "Which limit should I set first?"].map((q) => (
              <button key={q} onClick={() => send(q)} style={{ fontSize: "0.76rem" }} disabled={sending}>
                {q}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem", maxHeight: 260, overflowY: "auto", marginBottom: "0.5rem" }}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  justifySelf: m.role === "user" ? "end" : "start",
                  maxWidth: "90%",
                  padding: "0.45rem 0.65rem",
                  borderRadius: 10,
                  background: m.role === "user" ? "var(--accent-soft, rgba(127,127,127,0.12))" : "var(--surface-2, rgba(127,127,127,0.06))",
                  fontSize: "0.83rem",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.content}
              </div>
            ))}
            {sending && (
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                <Loader2 size={13} className="spin" /> Thinking it through…
              </span>
            )}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          style={{ display: "flex", gap: "0.4rem" }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Talk it through — argue a number down, ask what a category costs…"
            disabled={sending}
            style={{ flex: 1, fontSize: "0.83rem" }}
          />
          <button type="submit" className="btn-accent" disabled={sending || !draft.trim()} aria-label="Send">
            {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          </button>
        </form>
      </div>
    </div>
  );
}
