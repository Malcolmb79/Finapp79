import { Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type AdvisorMessage, type AdvisorWorking } from "../api/client.js";

/**
 * Asks questions about paying down debt, against the user's own accounts.
 *
 * Every figure in a reply is computed server-side by the payoff simulator
 * rather than produced by the model, and the calls behind each answer can be
 * expanded — so a plan can be checked rather than taken on trust.
 */

const SUGGESTIONS = [
  "What's the fastest way to clear my debt?",
  "What if I paid 200 extra a month?",
  "Which account should I attack first, and why?",
  "How much interest would avalanche save over snowball?",
];

function Workings({ workings }: { workings: AdvisorWorking[] }) {
  if (workings.length === 0) return null;
  return (
    <details style={{ marginTop: "0.4rem", fontSize: "0.72rem", color: "var(--text-muted)" }}>
      <summary style={{ cursor: "pointer" }}>
        Working ({workings.length} {workings.length === 1 ? "calculation" : "calculations"})
      </summary>
      <pre
        style={{
          margin: "0.35rem 0 0",
          padding: "0.5rem",
          overflowX: "auto",
          background: "var(--surface-2, rgba(127,127,127,0.08))",
          borderRadius: 6,
          fontSize: "0.68rem",
          lineHeight: 1.5,
        }}
      >
        {JSON.stringify(workings, null, 2)}
      </pre>
    </details>
  );
}

export default function DebtAdvisor() {
  const [messages, setMessages] = useState<(AdvisorMessage & { workings?: AdvisorWorking[] })[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, sending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || sending) return;

    // The history goes to the server, so the reply has to be appended to the
    // same list the request was built from — not to whatever state arrives
    // later.
    const next = [...messages, { role: "user" as const, content: question }];
    setMessages(next);
    setDraft("");
    setError(null);
    setSending(true);

    try {
      const { reply, workings } = await api.askDebtAdvisor(next.map(({ role, content }) => ({ role, content })));
      setMessages([...next, { role: "assistant", content: reply, workings }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach the adviser.");
      // The question stays in the box so it isn't lost to a failed request.
      setMessages(messages);
      setDraft(question);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: "1.25rem" }}>
      <div className="card__header">
        <h2 className="card__title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <Sparkles size={15} />
          Ask about your debt
        </h2>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
          Works from your real balances and rates. Every figure is calculated, not guessed — open the working under any
          answer to check it.
        </p>
      </div>

      {messages.length === 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", padding: "0.5rem 0" }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)} style={{ fontSize: "0.78rem" }}>
              {s}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem", maxHeight: 420, overflowY: "auto", padding: "0.25rem 0" }}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                justifySelf: m.role === "user" ? "end" : "start",
                maxWidth: "90%",
                padding: "0.5rem 0.7rem",
                borderRadius: 10,
                background: m.role === "user" ? "var(--accent-soft, rgba(127,127,127,0.12))" : "var(--surface-2, rgba(127,127,127,0.06))",
                fontSize: "0.85rem",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
              {m.role === "assistant" && m.workings && <Workings workings={m.workings} />}
            </div>
          ))}
          {sending && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              <Loader2 size={14} className="spin" />
              Working it out…
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {error && <p style={{ fontSize: "0.8rem", color: "var(--critical)", margin: "0.4rem 0" }}>{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask anything about clearing your debt…"
          disabled={sending}
          style={{ flex: 1, fontSize: "0.85rem" }}
        />
        <button type="submit" className="btn-accent" disabled={sending || !draft.trim()} aria-label="Send">
          {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
        </button>
      </form>
    </div>
  );
}
