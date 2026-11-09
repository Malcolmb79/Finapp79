import { Loader2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type Account, type Category, type TransactionRule } from "../api/client.js";

/**
 * Standing instructions for filing a merchant.
 *
 * The categoriser already guesses, and the guesses are good. What a guess
 * cannot do is settle the question: the same merchant comes back next month
 * and is guessed at again, and anything the model finds genuinely ambiguous
 * stays ambiguous forever. A rule is the owner writing the answer down once.
 *
 * Applying is a separate, explicit step. A rule written today is usually
 * written *because* of transactions that arrived months ago, so filing only
 * future ones would leave the pile it was meant to clear exactly as it was —
 * but silently rewriting history the moment a rule is saved is worse, so the
 * button says how many it would touch and waits to be pressed.
 */
export default function CategoryRules({
  categories,
  accounts,
  onApplied,
}: {
  categories: Category[];
  accounts: Account[];
  /** Transactions have been refiled, so whatever shows them needs rereading. */
  onApplied: () => void;
}) {
  const [rules, setRules] = useState<TransactionRule[]>([]);
  const [text, setText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listRules().then(setRules).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  // Repayment rules live on the Debt Planner, beside the loan they belong to.
  // Showing them here as well would invite editing a loan's plumbing from a
  // panel about categories.
  const filing = rules.filter((rule) => rule.category_id != null);

  async function add() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const rule = await api.createRule({
        match_text: text.trim(),
        match_account_id: accountId || null,
        category_id: Number(categoryId),
      });
      setText("");
      // The category and account are deliberately left as they were: filing a
      // run of merchants into one category is the common case, and resetting
      // would mean re-picking it every time.
      const { filed } = await api.applyRule(rule.id);
      setNotice(filed > 0 ? `Filed ${filed} transaction${filed === 1 ? "" : "s"}.` : "Saved — nothing uncategorized matched it yet.");
      load();
      if (filed > 0) onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that rule.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.deleteRule(id);
      // Deliberately leaves the transactions it filed where they are: the
      // categories it set are now ordinary stored values, and un-filing
      // months of history because a rule was tidied away would be a much
      // bigger act than the one being asked for.
      load();
    } finally {
      setBusy(false);
    }
  }

  async function reapply(id: string) {
    setBusy(true);
    setNotice(null);
    try {
      const { filed } = await api.applyRule(id);
      setNotice(filed > 0 ? `Filed ${filed} more.` : "Nothing uncategorized matches it.");
      if (filed > 0) onApplied();
    } finally {
      setBusy(false);
    }
  }

  if (categories.length === 0) {
    return <p className="empty-state">Add a category first — a rule needs somewhere to file things.</p>;
  }

  return (
    <div>
      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
        Anything matching the text goes to that category, now and in future.
      </p>

      <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.6rem" }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim() && categoryId) add();
          }}
          placeholder="text on the transaction, e.g. TESCO"
          aria-label="Text to match"
          style={{ fontSize: "0.82rem", flex: 1, minWidth: 150 }}
        />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="File under" style={{ fontSize: "0.82rem" }}>
          <option value="">File under…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {accounts.length > 1 && (
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="On which account" style={{ fontSize: "0.82rem" }}>
            <option value="">Any account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        <button onClick={add} disabled={busy || !text.trim() || !categoryId} className="btn-accent" style={{ fontSize: "0.82rem" }}>
          {busy ? <Loader2 size={13} className="spin" /> : "Add rule"}
        </button>
      </div>

      {error && <p style={{ fontSize: "0.78rem", color: "var(--critical)", margin: "0 0 0.5rem" }}>{error}</p>}
      {notice && <p style={{ fontSize: "0.78rem", color: "var(--good)", margin: "0 0 0.5rem" }}>{notice}</p>}

      {filing.length === 0 ? (
        <p className="empty-state">No rules yet.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.3rem" }}>
          {filing.map((rule) => (
            <div
              key={rule.id}
              style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", flexWrap: "wrap" }}
            >
              <span style={{ flex: 1, minWidth: 140 }}>
                “{rule.match_text}”
                {rule.match_account_id && (
                  <span style={{ color: "var(--text-muted)" }}> on {accountName.get(rule.match_account_id) ?? "a deleted account"}</span>
                )}
                <span style={{ color: "var(--text-muted)" }}> → </span>
                {rule.category_id != null ? (categoryName.get(rule.category_id) ?? "a deleted category") : ""}
              </span>
              <button
                onClick={() => reapply(rule.id)}
                disabled={busy}
                title="File anything uncategorized that matches this"
                style={{ fontSize: "0.75rem", padding: "0.1rem 0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
              >
                <Wand2 size={11} /> Apply
              </button>
              <button
                onClick={() => remove(rule.id)}
                disabled={busy}
                aria-label={`Remove the rule for ${rule.match_text}`}
                title="Remove"
                style={{ padding: "0.15rem", display: "flex" }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
