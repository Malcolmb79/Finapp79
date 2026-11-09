import { Loader2 } from "lucide-react";
import { useState } from "react";
import { api, type Account } from "../api/client.js";
import { isLiability } from "../utils/accountBalance.js";

/**
 * The terms of a debt, by hand.
 *
 * Everything here could already be read off an agreement, and that is still
 * the better route when there is one — it comes with the sentence each figure
 * was read from. But an agreement is not always to hand, a rate moves between
 * statements, and a figure read wrong has to be correctable without
 * re-uploading anything. So every term the payoff maths uses is editable, in
 * the place the payoff maths is shown.
 *
 * Blank means "not recorded" rather than zero, which is a real distinction
 * here: a loan with no rate recorded is projected differently from one that
 * genuinely charges nothing, and writing 0 would quietly assert the second.
 */

/** What the field holds, or undefined to leave the column alone. */
function parse(draft: string, original: number | null | undefined): number | null | undefined {
  const trimmed = draft.trim().replace(/[,\s]/g, "");
  if (trimmed === "") return original == null ? undefined : null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDate(draft: string, original: string | null | undefined): string | null | undefined {
  if (draft === "") return original == null ? undefined : null;
  return /^\d{4}-\d{2}-\d{2}$/.test(draft) ? draft : undefined;
}

export default function LoanTermsEditor({
  account,
  owed,
  onSaved,
  onCancel,
}: {
  account: Account;
  /** What is owed right now, positive — the figure shown on the row. */
  owed: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [owedDraft, setOwed] = useState(owed ? String(owed.toFixed(2)) : "");
  const [rate, setRate] = useState(account.loan_rate != null ? String(account.loan_rate) : "");
  const [payment, setPayment] = useState(account.loan_monthly_payment != null ? String(account.loan_monthly_payment) : "");
  const [principal, setPrincipal] = useState(account.loan_principal != null ? String(account.loan_principal) : "");
  const [term, setTerm] = useState(account.loan_term_months != null ? String(account.loan_term_months) : "");
  const [start, setStart] = useState(account.loan_start_date ?? "");
  const [end, setEnd] = useState(account.loan_end_date ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const enteredOwed = parse(owedDraft, owed);
      // A debt is stored negative — that convention is what makes net worth
      // come out right by plain addition — and entered positive, the way a
      // statement quotes it. The sign goes back on here, as it does on the
      // Accounts page.
      const balance =
        enteredOwed === undefined ? undefined : enteredOwed === null ? null : isLiability(account) ? -enteredOwed : enteredOwed;

      await api.updateAccount(account.id, {
        ...(balance !== undefined ? { balance } : {}),
        ...(parse(rate, account.loan_rate) !== undefined ? { loan_rate: parse(rate, account.loan_rate) } : {}),
        ...(parse(payment, account.loan_monthly_payment) !== undefined
          ? { loan_monthly_payment: parse(payment, account.loan_monthly_payment) }
          : {}),
        ...(parse(principal, account.loan_principal) !== undefined
          ? { loan_principal: parse(principal, account.loan_principal) }
          : {}),
        ...(parse(term, account.loan_term_months) !== undefined ? { loan_term_months: parse(term, account.loan_term_months) } : {}),
        ...(parseDate(start, account.loan_start_date) !== undefined ? { loan_start_date: parseDate(start, account.loan_start_date) } : {}),
        ...(parseDate(end, account.loan_end_date) !== undefined ? { loan_end_date: parseDate(end, account.loan_end_date) } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save those terms.");
    } finally {
      setSaving(false);
    }
  }

  const fields: { label: string; value: string; set: (v: string) => void; type?: string; suffix?: string; hint?: string }[] = [
    { label: "Owed now", value: owedDraft, set: setOwed, suffix: account.currency },
    { label: "Interest rate", value: rate, set: setRate, suffix: "% a year" },
    { label: "Monthly payment", value: payment, set: setPayment, suffix: account.currency },
    { label: "Original amount", value: principal, set: setPrincipal, suffix: account.currency, hint: "what was borrowed" },
    { label: "Term", value: term, set: setTerm, suffix: "months" },
    { label: "Started", value: start, set: setStart, type: "date" },
    { label: "Ends", value: end, set: setEnd, type: "date", hint: "beats the computed payoff date" },
  ];

  return (
    <div style={{ display: "grid", gap: "0.3rem", marginTop: "0.3rem" }}>
      {fields.map((field) => (
        <label key={field.label} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.76rem" }}>
          <span style={{ minWidth: 118, color: "var(--text-muted)" }}>{field.label}</span>
          <input
            type={field.type ?? "text"}
            inputMode={field.type === "date" ? undefined : "decimal"}
            value={field.value}
            onChange={(e) => field.set(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") onCancel();
            }}
            placeholder="not recorded"
            aria-label={`${field.label} for ${account.name}`}
            style={{ width: field.type === "date" ? 140 : 110, fontSize: "0.76rem", padding: "0.15rem 0.35rem" }}
          />
          {field.suffix && <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>{field.suffix}</span>}
          {field.hint && <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>· {field.hint}</span>}
        </label>
      ))}

      <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
        <button onClick={save} disabled={saving} className="btn-accent" style={{ fontSize: "0.76rem", padding: "0.2rem 0.6rem" }}>
          {saving ? <Loader2 size={12} className="spin" /> : "Save"}
        </button>
        <button onClick={onCancel} disabled={saving} style={{ fontSize: "0.76rem", padding: "0.2rem 0.6rem" }}>
          Cancel
        </button>
        {error && <span style={{ color: "var(--critical)", fontSize: "0.74rem" }}>{error}</span>}
      </div>
    </div>
  );
}
