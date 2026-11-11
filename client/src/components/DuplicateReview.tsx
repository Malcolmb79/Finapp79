import { CopyCheck, Loader2 } from "lucide-react";
import { useState } from "react";
import { api, type Account, type Transaction } from "../api/client.js";
import { cleanDescription } from "../utils/cleanDescription.js";
import { duplicateCount, findDuplicates } from "../utils/findDuplicates.js";
import { errorMessage } from "../utils/errorMessage.js";
import { formatCurrency } from "../utils/formatCurrency.js";

/**
 * Payments that look like they were stored twice.
 *
 * The app guards its two doors separately and neither sees the other: an
 * import checks its rows against what is stored, a sync dedupes on the bank's
 * own reference. The same payment arriving by both routes passes both checks,
 * and a bank that reports a payment once as pending and again as booked
 * issues two references for one payment and passes its own.
 *
 * Shown rather than acted on. A matching date, amount and account is strong
 * evidence and is not proof — two coffees of the same price in one shop on
 * one day is an ordinary Tuesday — so each pair is presented with both
 * descriptions and where each came from, and nothing goes until somebody
 * says so.
 */

export default function DuplicateReview({
  transactions,
  accounts,
  onChanged,
}: {
  transactions: Transaction[];
  accounts: Account[];
  onChanged: () => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Pairs the owner has said are not duplicates, for this visit. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const groups = findDuplicates(transactions).filter((group) => !dismissed.has(group.original.id));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  if (groups.length === 0) {
    return <p className="empty-state">Nothing looks duplicated.</p>;
  }

  async function remove(id: string) {
    setRemoving(id);
    setError(null);
    try {
      await api.deleteTransaction(id);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Couldn't remove that one."));
    } finally {
      setRemoving(null);
    }
  }

  const SOURCE: Record<Transaction["source"], string> = {
    enablebanking: "from the bank",
    csv: "from a statement",
    manual: "entered by hand",
  };

  return (
    <div>
      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0 0 0.6rem" }}>
        {duplicateCount(groups)} {duplicateCount(groups) === 1 ? "transaction looks" : "transactions look"} like a copy of
        another — same account, same day, same amount. Worth a glance before removing: two identical payments on one day
        do happen.
      </p>

      {error && <p style={{ fontSize: "0.78rem", color: "var(--critical)", margin: "0 0 0.5rem" }}>{error}</p>}

      <div style={{ display: "grid", gap: "0.7rem" }}>
        {groups.map((group) => (
          <div key={group.original.id} style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
              <CopyCheck size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
              <strong style={{ fontSize: "0.85rem" }}>
                {formatCurrency(group.original.amount, group.original.currency)}
              </strong>
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                {group.original.booking_date} · {accountName.get(group.original.account_id) ?? "an account"}
              </span>
            </div>

            {/* Both descriptions, because they are usually the thing that
                differs — one carrying the bank's reference and the other the
                statement's wording — and that difference is what tells
                somebody whether these really are one payment. */}
            {[group.original, ...group.copies].map((tx, index) => (
              <div
                key={tx.id}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.3rem", fontSize: "0.8rem" }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cleanDescription(tx.description) || "No description"}
                  <span style={{ color: "var(--text-muted)" }}> · {SOURCE[tx.source]}</span>
                </span>
                {index === 0 ? (
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>kept</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => remove(tx.id)}
                    disabled={removing === tx.id}
                    style={{ fontSize: "0.74rem", padding: "0.15rem 0.45rem", color: "var(--critical)", whiteSpace: "nowrap" }}
                  >
                    {removing === tx.id ? <Loader2 size={11} className="spin" /> : "Remove this one"}
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={() => setDismissed((current) => new Set(current).add(group.original.id))}
              style={{ fontSize: "0.72rem", padding: "0.15rem 0.4rem", background: "transparent", marginTop: "0.3rem" }}
            >
              Not a duplicate
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
