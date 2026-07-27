import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { api, type LoanTerms } from "../api/client.js";

/**
 * Confirms the terms read out of a loan agreement before any of them are
 * stored.
 *
 * Every figure is shown beside the sentence it was read from. That pairing is
 * the point of the screen: these values were extracted from prose rather than
 * parsed from a column, so the only real check is a person reading the
 * sentence and agreeing it says what the figure claims. Anything the reader
 * couldn't find is shown as missing and can be typed in.
 */

interface Props {
  accountName: string;
  currency: string;
  terms: LoanTerms;
  onClose: () => void;
  onSaved: () => void;
  accountId: string;
}

type Draft = {
  principal: string;
  monthlyPayment: string;
  interestRate: string;
  startDate: string;
  endDate: string;
  termMonths: string;
};

function initialDraft(terms: LoanTerms): Draft {
  return {
    principal: terms.principal ? String(terms.principal.value) : "",
    monthlyPayment: terms.monthlyPayment ? String(terms.monthlyPayment.value) : "",
    interestRate: terms.interestRate ? String(terms.interestRate.value) : "",
    startDate: terms.startDate?.value ?? "",
    endDate: terms.endDate?.value ?? "",
    termMonths: terms.termMonths ? String(terms.termMonths.value) : "",
  };
}

export default function LoanContractModal({ accountId, accountName, currency, terms, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(terms));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const found = [terms.principal, terms.monthlyPayment, terms.interestRate, terms.startDate, terms.endDate, terms.termMonths].filter(
    Boolean
  ).length;

  function number(value: string): number | null {
    const trimmed = value.trim().replace(/,/g, "");
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updateAccount(accountId, {
        loan_principal: number(draft.principal),
        loan_monthly_payment: number(draft.monthlyPayment),
        loan_rate: number(draft.interestRate),
        loan_term_months: number(draft.termMonths),
        loan_start_date: draft.startDate.trim() || null,
        loan_end_date: draft.endDate.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save these terms.");
    } finally {
      setSaving(false);
    }
  }

  const rows: { key: keyof Draft; label: string; quote: string | undefined; type: string; suffix?: string }[] = [
    { key: "principal", label: "Amount borrowed", quote: terms.principal?.quote, type: "text", suffix: currency },
    { key: "monthlyPayment", label: "Monthly payment", quote: terms.monthlyPayment?.quote, type: "text", suffix: currency },
    { key: "interestRate", label: "Interest rate", quote: terms.interestRate?.quote, type: "text", suffix: "% a year" },
    { key: "termMonths", label: "Term", quote: terms.termMonths?.quote, type: "text", suffix: "months" },
    { key: "startDate", label: "First payment", quote: terms.startDate?.quote, type: "date" },
    { key: "endDate", label: "Final payment", quote: terms.endDate?.quote, type: "date" },
  ];

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal__header">
          <h2 className="modal__title">Loan terms — {accountName}</h2>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.3rem 0 0" }}>
            {terms.lender ? `${terms.lender} · ` : ""}
            {found} of 6 figures found
            {terms.keyTerms.length > 0 ? `, plus ${terms.keyTerms.length} other terms` : ""}
            {terms.passes > 1 ? ` · read in ${terms.passes} passes` : ""}. Check each against the wording it came from
            before saving.
          </p>
        </div>

        <div style={{ padding: "0.5rem 1rem", display: "grid", gap: "0.75rem" }}>
          {rows.map((row) => (
            <div key={row.key} style={{ display: "grid", gap: "0.25rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                <span style={{ minWidth: 130 }}>{row.label}</span>
                <input
                  type={row.type}
                  value={draft[row.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                  placeholder="not found"
                  style={{ width: row.type === "date" ? 150 : 120, fontSize: "0.85rem", padding: "0.3rem 0.45rem" }}
                />
                {row.suffix && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{row.suffix}</span>}
              </label>
              {row.quote ? (
                <p
                  style={{
                    margin: 0,
                    marginLeft: 138,
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                    borderLeft: "2px solid var(--border)",
                    paddingLeft: "0.5rem",
                  }}
                >
                  “{row.quote}”
                </p>
              ) : (
                <p style={{ margin: 0, marginLeft: 138, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Not stated in the document — type it in if you know it.
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Everything the agreement says beyond the six figures above. These
            aren't stored — they're here to be read once, while the contract is
            in front of you, because the clauses that cost money are the ones
            nobody reads. */}
        {terms.keyTerms.length > 0 && (
          <div style={{ padding: "0.5rem 1rem" }}>
            <h3 style={{ fontSize: "0.85rem", margin: "0.5rem 0" }}>
              Also in this agreement ({terms.keyTerms.length})
            </h3>
            <div style={{ display: "grid", gap: "0.6rem" }}>
              {terms.keyTerms.map((term) => (
                <div key={term.quote} style={{ borderLeft: "2px solid var(--border)", paddingLeft: "0.6rem" }}>
                  <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>{term.label}</div>
                  <div style={{ fontSize: "0.8rem" }}>{term.detail}</div>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "0.73rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    “{term.quote}”
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p
          style={{
            display: "flex",
            gap: "0.4rem",
            alignItems: "flex-start",
            margin: "0.5rem 1rem",
            fontSize: "0.75rem",
            color: "var(--text-muted)",
          }}
        >
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
          Read from the document's wording rather than from a column of figures. Every quote here was checked against
          the file, but only you can confirm it means what it appears to — check each against your own copy.
        </p>

        {error && <p style={{ margin: "0 1rem", fontSize: "0.8rem", color: "var(--critical)" }}>{error}</p>}

        <div className="modal__footer">
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-accent" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : "Save these terms"}
          </button>
        </div>
      </div>
    </div>
  );
}
