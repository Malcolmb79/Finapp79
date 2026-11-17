/**
 * What came in, what went out, and what was left — with "came in" meaning
 * what was *earned* rather than what was positive.
 *
 * The same correction the flow chart and the income-sources card already
 * carry, applied to the last two places in the app that still read income off
 * the sign of the amount. A refund from a shop, a reimbursed expense, a
 * returned payment and a mis-keyed correction are all money arriving, and
 * none of them was earned — so a card headed "Income" that totals every
 * credit reports a household earning money from its own bus fares, and the
 * savings rate built on that figure is wrong in the denominator.
 *
 * `counts_as_income` on the category is the only thing that decides, which is
 * the flag the balance projection has always used. Occasional income counts
 * here: a bonus is income, and a card saying what came in this month would be
 * wrong to leave one out. (The forecast is the one place it must not count —
 * a projection that repeats a tax refund monthly draws a line through money
 * that is not coming.)
 *
 * Three figures rather than two, and the third is the point:
 *
 *   **income** — credits in a category the owner has called income.
 *   **otherIn** — every other credit that nothing could net away: one nobody
 *     has filed, and the excess where a category took back more than it ever
 *     spent. Named rather than folded into income, because a total that
 *     quietly includes refunds is the bug, and named rather than dropped,
 *     because money that arrived has to show somewhere or the card stops
 *     reconciling against the account it came from.
 *   **expenses** — spending, net of the credits filed against it. A €40
 *     refund on transport means transport cost €40 less, which is what
 *     happened.
 *
 * The netting is what keeps `saved` right. Narrowing income to the flag
 * without it would take the €40 off the income side and leave it on the
 * spending side, reporting a household €40 worse off than it is. With it,
 * `saved` comes out at exactly what it always did — every credit minus every
 * debit — so this changes what the figures *claim*, not what the month was
 * worth. That identity is worth keeping: it is the one thing a reader can
 * check against their own bank statement.
 *
 * An unfiled credit is never netted. "Uncategorised" is the absence of a
 * relationship rather than a relationship, so setting one unknown credit
 * against unrelated unknown spending would invent the connection.
 */

export interface FlowKind {
  countsAsIncome: boolean;
  isTransfer: boolean;
}

export interface MonthlyFlow {
  /** Credits in a category declared as income. */
  income: number;
  /** Credits nothing calls income and nothing can net away. */
  otherIn: number;
  /** Spending, after refunds filed against the same category. */
  expenses: number;
  /** income + otherIn - expenses. Identical to every credit minus every debit. */
  saved: number;
}

interface Signed {
  amount: number;
  category_id?: number | null;
}

/**
 * The month's position from two lists, which are deliberately not the same
 * list.
 *
 * `flow` is everything that moved, transfers already removed. `spending` is
 * that minus loan repayments — money that left the account without being
 * spent, since it bought down a balance instead. Credits come off `flow` so
 * that every one of them lands somewhere; debits come off `spending` so a
 * repayment is not reported as spending. Passing one list for both is wrong
 * in one direction or the other, which is why there are two parameters rather
 * than a convenience.
 */
export function monthlyFlow(
  { flow, spending }: { flow: Signed[]; spending: Signed[] },
  kind: (id: number | null) => FlowKind | null
): MonthlyFlow {
  let income = 0;
  let otherIn = 0;
  const refunds = new Map<number, number>();

  for (const tx of flow) {
    if (tx.amount <= 0) continue;
    const info = kind(tx.category_id ?? null);

    // A transfer in is money that was already yours. It should have been
    // excluded upstream; skipping it here too means a caller that forgets
    // cannot turn its own savings into a month of better earnings.
    if (info?.isTransfer) continue;

    if (info?.countsAsIncome) {
      income += tx.amount;
      continue;
    }

    // A credit in a named spending category is money coming back *to that
    // category*, so it waits to be netted against it below.
    if (info && tx.category_id != null) {
      refunds.set(tx.category_id, (refunds.get(tx.category_id) ?? 0) + tx.amount);
      continue;
    }

    otherIn += tx.amount;
  }

  const debits = new Map<number | null, number>();
  for (const tx of spending) {
    if (tx.amount >= 0) continue;
    const key = tx.category_id ?? null;
    debits.set(key, (debits.get(key) ?? 0) + Math.abs(tx.amount));
  }

  let expenses = 0;
  for (const [key, amount] of debits) {
    if (key == null) {
      expenses += amount;
      continue;
    }
    const back = refunds.get(key) ?? 0;
    refunds.delete(key);
    const net = amount - back;
    if (net > 0) expenses += net;
    // Took back more than it ever spent. The excess is real money that
    // arrived, so it has to show somewhere or the figures stop adding up —
    // just never under the heading "income".
    else otherIn += -net;
  }

  // A refund in a category with no spending behind it in this window. Still
  // money that arrived, and still not earned.
  for (const amount of refunds.values()) otherIn += amount;

  return { income, otherIn, expenses, saved: income + otherIn - expenses };
}
