import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { api, type Account, type LoanStatus } from "../api/client.js";
import { isLiability } from "../utils/accountBalance.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { impliedPrincipal } from "../utils/loanBalance.js";

/**
 * Confirms where a loan stands, read off a screenshot, before anything is
 * stored.
 *
 * Each figure sits beside the text it was transcribed from, as on the contract
 * and policy screens. The difference is that an image has no text to match a
 * quote against, so the quote is a transcription and the check is the person
 * reading it against the picture they just uploaded. That is said out loud
 * rather than implied.
 *
 * The screen's real job is the balance question. A lender's "remaining
 * balance" is frequently the rest of the instalments, future interest and all,
 * rather than the outstanding principal — and the payoff projection charges
 * interest on whatever balance it is given. Storing the first as the second
 * inflates the debt and then adds interest to the inflation. Where the figures
 * themselves prove that is what is happening, this offers the choice instead
 * of picking quietly.
 */

interface Props {
  account: Account;
  status: LoanStatus;
  onClose: () => void;
  onSaved: () => void;
}

type BalanceChoice = "asQuoted" | "implied";

function Row({ label, value, quote }: { label: string; value: string; quote?: string | null }) {
  return (
    <div style={{ display: "grid", gap: "0.15rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "0.85rem" }}>
        <span style={{ minWidth: 150, color: "var(--text-muted)" }}>{label}</span>
        <span style={{ fontWeight: 600 }}>{value}</span>
      </div>
      {quote && (
        <p
          style={{
            margin: 0,
            marginLeft: 150,
            fontSize: "0.74rem",
            color: "var(--text-muted)",
            fontStyle: "italic",
            borderLeft: "2px solid var(--border)",
            paddingLeft: "0.5rem",
          }}
        >
          &ldquo;{quote}&rdquo;
        </p>
      )}
    </div>
  );
}

export default function LoanStatusModal({ account, status, onClose, onSaved }: Props) {
  const currency = status.currency ?? account.currency;
  const quoted = status.remainingBalance?.value ?? null;
  const implied = impliedPrincipal(quoted, status.monthlyPayment?.value ?? null, status.interestRate?.value ?? null);

  // Only offered where the arithmetic proves the quoted balance carries future
  // interest and there is a defensible figure to offer instead. Everywhere
  // else the lender's own number stands.
  const choiceMatters = status.balanceIncludesInterest && implied != null;
  const [choice, setChoice] = useState<BalanceChoice>(choiceMatters ? "implied" : "asQuoted");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owed = choiceMatters && choice === "implied" ? implied : quoted;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updateAccount(account.id, {
        // A debt is stored negative — the convention that makes net worth come
        // out right by plain addition — and quoted positive, as a statement
        // does. The sign goes back on here, as it does everywhere else.
        ...(owed != null ? { balance: isLiability(account) ? -owed : owed } : {}),
        ...(status.monthlyPayment ? { loan_monthly_payment: status.monthlyPayment.value } : {}),
        ...(status.interestRate ? { loan_rate: status.interestRate.value } : {}),
        ...(status.loanAmount ? { loan_principal: status.loanAmount.value } : {}),
        ...(status.termMonths ? { loan_term_months: status.termMonths.value } : {}),
        ...(status.startDate ? { loan_start_date: status.startDate.value } : {}),
        ...(status.endDate ? { loan_end_date: status.endDate.value } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this update.");
    } finally {
      setSaving(false);
    }
  }

  const money = (value: number | null | undefined) => (value == null ? "—" : formatCurrency(value, currency));

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal__header">
          <h2 className="modal__title">Where this loan stands — {account.name}</h2>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.3rem 0 0" }}>
            {status.lender ? `${status.lender} · ` : ""}
            {status.reference ? `${status.reference} · ` : ""}
            Read from the screenshot. Check each figure against it before saving.
          </p>
          <p
            style={{
              fontSize: "0.78rem",
              color: "var(--text-muted)",
              margin: "0.4rem 0 0",
              display: "flex",
              alignItems: "flex-start",
              gap: "0.35rem",
            }}
          >
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              A screenshot has no text to match against, so the wording below is a transcription rather than something
              checked against the file. Comparing it to the picture you uploaded is the only check there is.
            </span>
          </p>
        </div>

        <div style={{ padding: "0.5rem 1rem", display: "grid", gap: "0.6rem" }}>
          <Row label="Left to pay" value={money(quoted)} quote={status.remainingBalance?.quote} />
          <Row label="Paid so far" value={money(status.amountPaid?.value)} quote={status.amountPaid?.quote} />
          <Row label="Monthly payment" value={money(status.monthlyPayment?.value)} quote={status.monthlyPayment?.quote} />
          <Row
            label="Interest rate"
            value={status.interestRate ? `${status.interestRate.value}% a year` : "—"}
            quote={status.interestRate?.quote}
          />
          <Row label="Originally borrowed" value={money(status.loanAmount?.value)} quote={status.loanAmount?.quote} />
          <Row label="Total to repay" value={money(status.totalToRepay?.value)} quote={status.totalToRepay?.quote} />
          <Row
            label="Term"
            value={status.termMonths ? `${status.termMonths.value} months` : "—"}
            quote={status.termMonths?.quote}
          />
          <Row label="Started" value={status.startDate?.value ?? "—"} quote={status.startDate?.quote} />
          <Row
            label="Next payment"
            value={
              status.nextPaymentAmount || status.nextPaymentDate
                ? `${money(status.nextPaymentAmount?.value)}${status.nextPaymentDate ? ` on ${status.nextPaymentDate.value}` : ""}`
                : "—"
            }
            quote={status.nextPaymentDate?.quote ?? status.nextPaymentAmount?.quote}
          />
        </div>

        {/* The one decision on this screen. Not a warning that something broke:
            the lender's figure is correct, it is simply answering a different
            question from the one the payoff projection asks. */}
        {choiceMatters && (
          <div style={{ margin: "0.5rem 1rem", padding: "0.6rem", border: "1px solid var(--border)", borderRadius: 8 }}>
            <p style={{ margin: "0 0 0.4rem", fontSize: "0.8rem", display: "flex", gap: "0.35rem", alignItems: "flex-start" }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2, color: "var(--warning)" }} />
              <span>
                Paid so far plus left to pay comes to the total repayable, so {money(quoted)} is the instalments still
                to come — it already has the future interest inside it. Recording that as what you owe, and then
                charging {status.interestRate?.value}% on it, would count the interest twice.
              </span>
            </p>
            <label style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start", fontSize: "0.8rem", marginTop: "0.4rem" }}>
              <input type="radio" checked={choice === "implied"} onChange={() => setChoice("implied")} />
              <span>
                Record <strong>{money(implied)}</strong> — what the remaining payments are worth today, so the
                projection adds the interest itself. <em>Recommended.</em>
              </span>
            </label>
            <label style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start", fontSize: "0.8rem", marginTop: "0.3rem" }}>
              <input type="radio" checked={choice === "asQuoted"} onChange={() => setChoice("asQuoted")} />
              <span>
                Record <strong>{money(quoted)}</strong> exactly as the lender shows it. Your balance will match their
                app, and the payoff estimate will be pessimistic.
              </span>
            </label>
          </div>
        )}

        {error && <p style={{ margin: "0 1rem", fontSize: "0.8rem", color: "var(--critical)" }}>{error}</p>}

        <div className="modal__footer">
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-accent" onClick={save} disabled={saving || owed == null}>
            {saving ? <Loader2 size={14} className="spin" /> : `Update to ${money(owed)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
