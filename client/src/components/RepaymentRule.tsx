import { Link2, Loader2, X } from "lucide-react";
import { useState } from "react";
import { api, type Account, type TransactionRule } from "../api/client.js";

/**
 * Where a loan's repayments come from.
 *
 * A personal loan is paid by direct debit off whichever account funds it, and
 * nothing at all lands on the loan — so without this its balance is whatever
 * was last typed in, drifting further from the truth every month.
 *
 * The rule is written once and every future payment is attributed by it, which
 * is the whole reason it is a rule rather than a button on each transaction.
 * It names the account the money leaves as well as the text to look for,
 * because the same words on a different account mean something else: a
 * sterling loan paid from Barclays and a euro one paid from AIB can share a
 * lender's name without sharing a payment.
 */
export default function RepaymentRule({
  account,
  accounts,
  rules,
  matched,
  onChanged,
}: {
  account: Account;
  accounts: Account[];
  rules: TransactionRule[];
  /** How many transactions this rule is currently claiming. */
  matched: number;
  onChanged: () => void;
}) {
  const mine = rules.filter((rule) => rule.repays_account_id === account.id);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [fromId, setFromId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Never the loan itself: a loan cannot fund its own repayment, and offering
  // it only invites the one choice the server has to reject.
  const fundingAccounts = accounts.filter((a) => a.id !== account.id);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.createRule({ match_text: text.trim(), match_account_id: fromId || null, repays_account_id: account.id });
      setText("");
      setFromId("");
      setAdding(false);
      onChanged();
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
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const accountName = (id: string | null) => (id ? (accounts.find((a) => a.id === id)?.name ?? "a deleted account") : "any account");

  return (
    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
      {mine.map((rule) => (
        <div key={rule.id} style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
          <Link2 size={11} />
          <span>
            Repaid by “{rule.match_text}” on {accountName(rule.match_account_id)}
          </span>
          {/* What the rule is actually doing, rather than only what it says.
              A rule matching nothing looks identical to a working one until
              the count is on screen beside it. */}
          <span style={{ color: matched === 0 ? "var(--critical)" : undefined }}>
            · {matched === 0 ? "no payments matched yet" : `${matched} payment${matched === 1 ? "" : "s"}`}
          </span>
          <button
            onClick={() => remove(rule.id)}
            disabled={busy}
            aria-label="Remove this repayment rule"
            title="Remove"
            style={{ padding: "0.1rem", display: "flex", background: "transparent", border: "none", cursor: "pointer" }}
          >
            <X size={11} />
          </button>
        </div>
      ))}

      {adding ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap", marginTop: "0.2rem" }}>
          <select value={fromId} onChange={(e) => setFromId(e.target.value)} aria-label="Account the payment leaves" style={{ fontSize: "0.72rem" }}>
            <option value="">Any account</option>
            {fundingAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) add();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="text on the payment, e.g. AN POST"
            aria-label="Text to match on the payment"
            style={{ fontSize: "0.72rem", padding: "0.15rem 0.35rem", minWidth: 170 }}
          />
          <button onClick={add} disabled={busy || !text.trim()} style={{ fontSize: "0.72rem", padding: "0.15rem 0.45rem" }}>
            {busy ? <Loader2 size={11} className="spin" /> : "Save"}
          </button>
          <button onClick={() => setAdding(false)} disabled={busy} style={{ fontSize: "0.72rem", padding: "0.15rem 0.45rem" }}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{ fontSize: "0.72rem", padding: 0, background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer" }}
        >
          {mine.length === 0 ? "Where do the repayments come from?" : "Add another"}
        </button>
      )}

      {error && <div style={{ color: "var(--critical)" }}>{error}</div>}
    </div>
  );
}
