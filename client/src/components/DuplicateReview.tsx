import { CopyCheck, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Account, type Transaction } from "../api/client.js";
import { cleanDescription } from "../utils/cleanDescription.js";
import { copyEvidence, duplicateEvidence, STRENGTH_ORDER, type Strength } from "../utils/duplicateEvidence.js";
import { duplicateCount, findDuplicates } from "../utils/findDuplicates.js";
import { errorMessage } from "../utils/errorMessage.js";
import { formatCurrency } from "../utils/formatCurrency.js";

/**
 * Payments that look like they were stored twice.
 *
 * The app guards its two doors separately and neither sees the other: an
 * import checks its rows against what is stored, a sync dedupes on the bank's
 * own reference. The same payment arriving by both routes passes both checks,
 * and a bank that reports a payment once as expected and again as recorded
 * issues two references for one payment and passes its own.
 *
 * Shown rather than acted on, and that has to stay true: a matching date,
 * amount and account is strong evidence and is not proof. Two coffees of the
 * same price in one shop on one day is an ordinary Tuesday.
 *
 * ## Making it a screen somebody can decide from
 *
 * Presenting every pair alike made the list useless for deciding. A card
 * payment the bank described twice sat beside two different shops that
 * happened to charge the same amount on one day, and nothing distinguished
 * them. Working down a list like that, somebody either trusts all of it and
 * deletes a real payment or trusts none of it and the list never shrinks.
 *
 * So each pair now carries how good the evidence is and why, strongest first,
 * with the weak ones named as probably two payments rather than quietly
 * ranked last. Which copy to keep is a choice rather than an assumption,
 * because keeping the bank's own record and removing the imported one is what
 * stops the next sync putting it straight back. And a pair judged not to be a
 * duplicate stays judged — it is stored, not forgotten when the page closes,
 * or the same two coffees are flagged again every visit forever.
 */

const SOURCE: Record<Transaction["source"], string> = {
  enablebanking: "from the bank",
  csv: "from a statement",
  manual: "entered by hand",
};

const STRENGTH_LABEL: Record<Strength, string> = {
  "near-certain": "Near certain",
  likely: "Likely",
  weak: "Probably not",
};

const STRENGTH_COLOUR: Record<Strength, string> = {
  "near-certain": "var(--critical)",
  likely: "var(--warning)",
  weak: "var(--text-muted)",
};

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
  /** Pairs already judged to be two payments, as "a|b" with the ids sorted. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  /** Which row of a group the owner has chosen to keep, where they have. */
  const [keeping, setKeeping] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    api
      .listDuplicateDismissals()
      .then((rows) => setDismissed(new Set(rows.map((r) => `${r.a_id}|${r.b_id}`))))
      // A dismissal that cannot be read back costs a pair being shown again,
      // which is worth less than the screen refusing to load.
      .catch(() => setDismissed(new Set()));
  }, []);

  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const groups = findDuplicates(transactions)
    .filter((group) => !group.copies.every((copy) => dismissed.has(pairKey(group.original.id, copy.id))))
    .map((group) => ({ group, evidence: duplicateEvidence(group) }))
    .sort((a, b) => STRENGTH_ORDER[a.evidence.strength] - STRENGTH_ORDER[b.evidence.strength]);

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

  async function notDuplicate(originalId: string, copyIds: string[]) {
    // Held locally as well as sent, so the pair leaves the list at once
    // whether or not the write lands.
    setDismissed((current) => {
      const next = new Set(current);
      for (const copyId of copyIds) next.add(pairKey(originalId, copyId));
      return next;
    });
    try {
      for (const copyId of copyIds) await api.dismissDuplicate(originalId, copyId);
    } catch {
      setError("That pair is hidden for now, but the decision couldn't be saved.");
    }
  }

  const total = duplicateCount(groups.map((g) => g.group));

  return (
    <div>
      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0 0 0.6rem" }}>
        {total} {total === 1 ? "transaction looks" : "transactions look"} like a copy of another. Each pair says how
        good the evidence is — the strongest are first, and nothing is removed unless you say so.
      </p>

      {error && <p style={{ fontSize: "0.78rem", color: "var(--critical)", margin: "0 0 0.5rem" }}>{error}</p>}

      <div style={{ display: "grid", gap: "0.8rem" }}>
        {groups.map(({ group }) => {
          const rows = [group.original, ...group.copies];
          const kept = keeping.get(group.original.id) ?? group.original.id;
          return (
            <div key={group.original.id} style={{ borderTop: "1px solid var(--border)", paddingTop: "0.55rem" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                <CopyCheck size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                <strong style={{ fontSize: "0.85rem" }}>
                  {formatCurrency(group.original.amount, group.original.currency)}
                </strong>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  {accountName.get(group.original.account_id) ?? "an account"}
                </span>
              </div>

              {rows.map((tx) => {
                // Each row carries its own verdict: a group is only "same
                // account, same date, same amount", and three identical rows
                // beside one from another shop is an ordinary shape.
                const own = tx.id === group.original.id ? null : copyEvidence(group.original, tx, group.kind);
                return (
                <div key={tx.id} style={{ marginTop: "0.35rem", fontSize: "0.8rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cleanDescription(tx.description) || "No description"}
                    <span style={{ color: "var(--text-muted)" }}>
                      {" "}
                      · {tx.booking_date} · {SOURCE[tx.source]}
                    </span>
                  </span>
                  {own && (
                    <span
                      style={{
                        fontSize: "0.66rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: STRENGTH_COLOUR[own.strength],
                        whiteSpace: "nowrap",
                      }}
                    >
                      {STRENGTH_LABEL[own.strength]}
                    </span>
                  )}
                  {tx.id === kept ? (
                    <span style={{ fontSize: "0.72rem", color: "var(--good)", whiteSpace: "nowrap" }}>keeping</span>
                  ) : (
                    <>
                      {/* Which one survives is a real choice: removing the
                          bank's own record leaves the next sync free to put it
                          back, and the imported copy is the one that stays
                          gone. */}
                      <button
                        type="button"
                        onClick={() => setKeeping((m) => new Map(m).set(group.original.id, tx.id))}
                        style={{ fontSize: "0.72rem", padding: "0.15rem 0.45rem", background: "transparent", whiteSpace: "nowrap" }}
                      >
                        Keep this one
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(tx.id)}
                        disabled={removing === tx.id}
                        style={{ fontSize: "0.74rem", padding: "0.15rem 0.45rem", color: "var(--critical)", whiteSpace: "nowrap" }}
                      >
                        {removing === tx.id ? <Loader2 size={11} className="spin" /> : "Remove"}
                      </button>
                    </>
                  )}
                </div>
                {/* The reasoning, not just a verdict. It is what lets somebody
                    disagree with the screen, which on this list they sometimes
                    should. */}
                {own && (
                  <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.15rem 0 0" }}>{own.note}</p>
                )}
                </div>
              );})}

              <button
                type="button"
                onClick={() => notDuplicate(group.original.id, group.copies.map((c) => c.id))}
                title="Remember that these are two separate payments, so they stop being flagged"
                style={{ fontSize: "0.72rem", padding: "0.15rem 0.4rem", background: "transparent", marginTop: "0.35rem" }}
              >
                Not a duplicate
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
