import { Check, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, type CoachProposal } from "../api/client.js";
import { errorMessage } from "../utils/errorMessage.js";
import { useRefresh } from "../contexts/RefreshContext.js";

/**
 * A coach you can ask anything, on the pages where money decisions get made.
 *
 * Mounted once in the shell rather than placed on each page, for two reasons.
 * A conversation that resets when you walk from the debt planner to the
 * savings page is a conversation you stop having — the second question is
 * usually about the first page while looking at the second. And a card on a
 * drag-and-drop canvas competes for the space the figures need, where the
 * whole point of asking is to keep looking at them while you do.
 *
 * It appears only where it has something to be grounded in. Everywhere else
 * it would be a chat window over a page it knows nothing about, which is the
 * thing that makes an assistant feel bolted on.
 *
 * Everything it says comes from tools reading the real rows, and nothing it
 * suggests is applied until a button here is pressed — see
 * server/src/routes/coach.ts for why both of those are non-negotiable.
 */

/** Where the coach is offered, and the page name the server focuses on. */
const PAGES: Record<string, { page: string; title: string; starters: string[] }> = {
  "/": {
    page: "dashboard",
    title: "Coach",
    starters: ["Where is my money actually going?", "What should I deal with first?", "Can I afford €300 a month more?"],
  },
  "/debt-planner": {
    page: "debt",
    title: "Coach · debts",
    starters: ["Which debt should I clear first?", "What would €200 extra a month buy me?", "Is it worth refinancing?"],
  },
  "/savings": {
    page: "savings",
    title: "Coach · savings",
    starters: ["Are my goals realistic?", "What do I need to save each month?", "Where should the next €100 go?"],
  },
  "/buy-to-let": {
    page: "btl",
    title: "Coach · the deal",
    starters: ["Does this deal actually work?", "What would break it?", "Personal or company here?"],
  },
};

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export default function Coach({ context }: { context?: string }) {
  const { pathname } = useLocation();
  const config = PAGES[pathname];

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [proposals, setProposals] = useState<CoachProposal[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const { refresh } = useRefresh();

  // Pinned to the newest turn, which is the one you are waiting for.
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  if (!config) return null;

  async function send(text: string) {
    const question = text.trim();
    if (!question || sending) return;

    const next: Turn[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setDraft("");
    setSending(true);
    setError(null);

    try {
      const answer = await api.coachChat({ messages: next, page: config.page, context });
      setMessages([...next, { role: "assistant", content: answer.reply }]);
      // Replaces rather than accumulates: a figure argued down over three
      // turns should leave one button, showing where it landed.
      if (answer.proposals.length > 0) setProposals(answer.proposals);
    } catch (err) {
      setError(errorMessage(err, "The coach couldn't answer just then."));
      setMessages(next);
    } finally {
      setSending(false);
    }
  }

  async function apply(proposal: CoachProposal) {
    setApplying(proposal.label);
    setError(null);
    try {
      if (proposal.kind === "budget_limit" && proposal.budgetLimit) {
        await api.setBudget(proposal.budgetLimit.categoryId, proposal.budgetLimit.monthly_limit);
      } else if (proposal.kind === "savings_goal" && proposal.savingsGoal) {
        const goal = proposal.savingsGoal;
        if (goal.id == null) {
          await api.createSavingsGoal({ name: goal.name, target_amount: goal.target_amount, target_date: goal.target_date });
        } else {
          await api.updateSavingsGoal(goal.id, { target_amount: goal.target_amount, target_date: goal.target_date });
        }
      }
      setApplied((current) => new Set(current).add(proposal.label));
      // The page it changed is usually the page you are on, and a figure that
      // does not move when you press the button reads as the button failing.
      refresh();
    } catch (err) {
      setError(errorMessage(err, "Couldn't apply that."));
    } finally {
      setApplying(null);
    }
  }

  if (!open) {
    return (
      <button type="button" className="coach-launch" onClick={() => setOpen(true)} aria-label="Ask the coach">
        <MessageCircle size={16} aria-hidden="true" />
        <span>Ask the coach</span>
      </button>
    );
  }

  return (
    <aside className="coach" aria-label={config.title}>
      <header className="coach__header">
        <span>
          <Sparkles size={13} aria-hidden="true" /> {config.title}
        </span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close the coach">
          <X size={14} />
        </button>
      </header>

      <div className="coach__thread" ref={thread}>
        {messages.length === 0 && (
          <p className="coach__intro">
            I can look up your real figures — balances, what you spend, what the debts cost, whether a goal lands on
            time. I quote what I find rather than estimating, and anything I suggest arrives as a button you press.
            {/* Said once, here, rather than as a disclaimer on every answer. */}
            <span className="coach__caveat">Not a regulated adviser — nothing here is a product recommendation.</span>
          </p>
        )}

        {messages.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "coach__said coach__said--mine" : "coach__said"}>
            {turn.content}
          </div>
        ))}

        {sending && (
          <span className="coach__thinking">
            <Loader2 size={13} className="spin" /> Looking it up…
          </span>
        )}

        {proposals.map((proposal) => {
          const done = applied.has(proposal.label);
          return (
            <div key={proposal.label} className="coach__proposal">
              <strong>{proposal.label}</strong>
              <p>{proposal.reason}</p>
              {/* What it replaces, so a proposal can be judged rather than
                  taken. A limit with nothing beside it is a number; a limit
                  beside the one it replaces is a decision. */}
              {proposal.kind === "budget_limit" && proposal.budgetLimit?.currentLimit != null && (
                <p className="coach__was">Currently {proposal.budgetLimit.currentLimit} a month</p>
              )}
              {proposal.kind === "savings_goal" && proposal.savingsGoal?.current != null && (
                <p className="coach__was">{proposal.savingsGoal.current} saved so far</p>
              )}
              <button type="button" onClick={() => apply(proposal)} disabled={done || applying !== null}>
                {done ? (
                  <>
                    <Check size={12} /> Applied
                  </>
                ) : applying === proposal.label ? (
                  <Loader2 size={12} className="spin" />
                ) : (
                  "Do it"
                )}
              </button>
            </div>
          );
        })}

        {error && <p className="coach__error">{error}</p>}
      </div>

      {/* Kept available throughout rather than only on an empty thread: "what
          would that cost me" is a reply, not an opening line. */}
      <div className="coach__starters">
        {config.starters.map((starter) => (
          <button key={starter} type="button" onClick={() => send(starter)} disabled={sending}>
            {starter}
          </button>
        ))}
      </div>

      <form
        className="coach__ask"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about your money…"
          aria-label="Ask the coach"
          disabled={sending}
        />
        <button type="submit" className="btn-accent" disabled={sending || !draft.trim()} aria-label="Send">
          {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
        </button>
      </form>
    </aside>
  );
}
