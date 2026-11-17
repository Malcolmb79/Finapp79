import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api, type Account, type Category, type Transaction } from "../api/client.js";
import { errorMessage } from "../utils/errorMessage.js";
import { formatCurrency } from "../utils/formatCurrency.js";
import { findTransferPairs, pairNote, transferCategoryIds } from "../utils/transfers.js";
import { useFxRates } from "../utils/fx.js";
import { useAccountScope } from "../contexts/ViewFilterContext.js";

/**
 * Payments out matched to the payments in that look like the same money.
 *
 * Marking a category as a transfer handles everything filed there. This is
 * for everything that is not: the SWIFT in that arrived uncategorised, the
 * move to the savings account the bank described two different ways on the
 * two statements.
 *
 * It suggests and never decides. Two accounts, a few days and a matching
 * amount describes a transfer, and it equally describes paying somebody who
 * banks where you do — only the owner knows which, so each pair is confirmed
 * one at a time and the figures move only after that.
 */

export default function TransferReconcile({
  transactions,
  accounts,
  categories,
  onChanged,
}: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onChanged: () => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const transferIds = useMemo(() => transferCategoryIds(categories), [categories]);
  const transferCategory = categories.find((c) => c.is_transfer) ?? null;
  // Rates so the two legs are compared by what they were worth rather than
  // by the number printed on them: a household holding euro, sterling and
  // rand transfers between currencies, and those pairs never matched.
  const rates = useFxRates("EUR");
  const { scope } = useAccountScope();
  const pairs = useMemo(
    () => findTransferPairs(transactions, transferIds, rates),
    [transactions, transferIds, rates]
  );

  // Already filed as transfers, so there is nothing to ask about them — but
  // worth counting, because "we found none" and "they are all already done"
  // are different answers.
  const outstanding = pairs.filter((p) => !p.alreadyMarked && !done.has(p.key));
  const settled = pairs.length - outstanding.length;

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "another account";
  const money = (value: number, currency = "EUR") => formatCurrency(value, currency);

  async function markPair(key: string, out: Transaction, into: Transaction) {
    if (!transferCategory) return;
    setWorking(key);
    setError(null);
    try {
      // Both halves, or the figures end up worse than before: one leg filed
      // as a transfer and the other left as income reports money arriving
      // from nowhere.
      await Promise.all([
        api.updateTransaction(out.id, { category_id: transferCategory.id }),
        api.updateTransaction(into.id, { category_id: transferCategory.id }),
      ]);
      setDone((current) => new Set(current).add(key));
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Couldn't file those as transfers."));
    } finally {
      setWorking(null);
    }
  }

  if (!transferCategory) {
    return (
      <p className="empty-state">
        No category is marked as a transfer yet. Mark one above — &ldquo;Transfers&rdquo; is the usual name — and matched
        pairs will show up here for you to confirm.
      </p>
    );
  }

  /**
   * A transfer needs two accounts, and the header's filter leaves one.
   *
   * With a scope set, every request is narrowed to that account before it
   * reaches here, so the matcher is structurally incapable of finding a pair
   * — and would then report that nothing looks like a transfer, which is a
   * confident answer to a question it was not able to ask.
   */
  if (scope) {
    return (
      <p className="empty-state">
        Showing one account. A transfer has a leg on each of two, so clear the account filter in the header to look for
        pairs.
      </p>
    );
  }

  if (pairs.length === 0) {
    return <p className="empty-state">Nothing here looks like money moving between your own accounts.</p>;
  }

  if (outstanding.length === 0) {
    return (
      <p className="empty-state">
        All {settled} matched {settled === 1 ? "pair is" : "pairs are"} already filed as transfers.
      </p>
    );
  }

  return (
    <>
      <p style={{ fontSize: "0.78rem", margin: "0 0 0.7rem", lineHeight: 1.45 }}>
        {outstanding.length} {outstanding.length === 1 ? "pair looks" : "pairs look"} like one payment moving between
        your own accounts. Filing both halves under <strong>{transferCategory.name}</strong> keeps them out of income and
        spending while leaving the balances alone.
        {settled > 0 && ` ${settled} already done.`}
      </p>

      {error && <p style={{ color: "var(--critical)", fontSize: "0.76rem" }}>{error}</p>}

      <div style={{ display: "grid", gap: "0.55rem" }}>
        {outstanding.map((pair) => (
          <div key={pair.key} className="transfer-pair">
            <div className="transfer-pair__legs">
              <div>
                <span className="transfer-pair__account">{accountName(pair.out.account_id)}</span>
                <strong style={{ color: "var(--critical)" }}>
                  −{money(Math.abs(pair.out.amount), pair.out.currency)}
                </strong>
                <span className="transfer-pair__meta">
                  {pair.out.booking_date} · {pair.out.description ?? "no description"}
                </span>
              </div>
              <ArrowRight size={14} style={{ color: "var(--text-muted)", flexShrink: 0, alignSelf: "center" }} />
              <div>
                <span className="transfer-pair__account">{accountName(pair.in.account_id)}</span>
                <strong style={{ color: "var(--good)" }}>+{money(pair.in.amount, pair.in.currency)}</strong>
                <span className="transfer-pair__meta">
                  {pair.in.booking_date} · {pair.in.description ?? "no description"}
                </span>
              </div>
            </div>

            <p className="transfer-pair__note">{pairNote(pair, money)}</p>

            <button
              onClick={() => markPair(pair.key, pair.out, pair.in)}
              disabled={working === pair.key}
              style={{ fontSize: "0.75rem" }}
            >
              {working === pair.key ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
              {working === pair.key ? "Filing…" : `Both are ${transferCategory.name}`}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
