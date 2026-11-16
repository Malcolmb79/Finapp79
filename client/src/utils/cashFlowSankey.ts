/**
 * Where a period's money came from and where it went, as one flow.
 *
 * The app already shows income and expenses as two bars, and spending as a
 * ring of categories. Neither answers the question people actually ask of a
 * month — of what came in, how much reached each thing, and was there
 * anything left. Two separate charts leave that sum to be done by eye, and it
 * is the sum that matters.
 *
 * Everything here is proportion rather than position: the width of a band is
 * the share of the money it carried. That is the whole value of the shape —
 * it makes "most of my income went to rent" a thing you see rather than a
 * thing you work out.
 */

export interface FlowEntry {
  key: string;
  label: string;
  amount: number;
}

export interface CashFlow {
  /** Where the money came from, largest first. */
  sources: FlowEntry[];
  /** Where it went, largest first, with anything left over last. */
  destinations: FlowEntry[];
  totalIn: number;
  totalOut: number;
  /** In minus out. Negative means the period was funded from savings. */
  surplus: number;
}

/** Anything thinner than this is grouped — a one-pixel band tells nobody anything. */
const MIN_SHARE = 0.02;
const MAX_ROWS = 8;

interface Flowable {
  amount: number;
  description: string | null;
  counterparty: string | null;
  category_id: number | null;
}

/**
 * What a category is, for the purpose of drawing a flow.
 *
 * The name alone is not enough, because the question this chart has to answer
 * about every credit is whether it is income — and the sign of the amount
 * cannot answer it. A refund from a shop, a reimbursed expense, a returned
 * payment and a mis-keyed correction are all money arriving, and none of them
 * is income. Grouping them by category name put "Transport" and
 * "Miscellaneous" on the income side of this chart, which reads as a
 * household earning money from its own bus fares.
 *
 * So income is the declared thing it is everywhere else in this app:
 * `counts_as_income` on the category. Transfers keep their own band, since
 * money arriving from your own savings account really is where some of the
 * month's spending came from, and the card names it as such.
 */
export interface FlowCategory {
  name: string;
  countsAsIncome: boolean;
  isTransfer: boolean;
}

/**
 * What money that arrived and is not income is called.
 *
 * Deliberately one label for two cases — a credit nobody has filed, and a
 * refund larger than the category ever spent — because both are the same
 * statement: this came in, and nothing here says it was earned. A category
 * name must never appear on that side, since reading "Transport" as a source
 * of money is the whole bug.
 */
const OTHER_IN_LABEL = "Other money in";

/**
 * Groups the long tail into one band.
 *
 * A month has a handful of things worth seeing and a hundred that are not,
 * and drawing all of them makes a comb nobody can read. The tail is kept
 * rather than dropped — the bands have to add up to the total, or the picture
 * is telling a different story from the figures beside it.
 */
function condense(entries: FlowEntry[], total: number): FlowEntry[] {
  const sorted = [...entries].sort((a, b) => b.amount - a.amount);
  const kept: FlowEntry[] = [];
  let rest = 0;

  for (const entry of sorted) {
    const tooThin = total > 0 && entry.amount / total < MIN_SHARE;
    if (kept.length >= MAX_ROWS || tooThin) rest += entry.amount;
    else kept.push(entry);
  }

  if (rest > 0.005) kept.push({ key: "__rest", label: "Everything else", amount: rest });
  return kept;
}

/**
 * The flow for a set of transactions.
 *
 * `category` returns null for an uncategorised transaction, which becomes its
 * own band rather than being hidden: money that went somewhere unnamed is
 * still money that went somewhere, and a picture that quietly omitted it
 * would not add up to the total printed beside it.
 *
 * A credit that is not income does not vanish either. It is **netted against
 * the category it came back to** — a €40 refund on transport means transport
 * cost €40 less, which is what actually happened and keeps both sides of the
 * chart adding up. Only where a category took back more than it ever spent
 * does the excess appear on the left, under `Refunds & credits` rather than
 * under the category's own name, since the point of the fix is that no
 * category should be able to masquerade as a source of income.
 */
export function cashFlow(transactions: Flowable[], category: (id: number | null) => FlowCategory | null): CashFlow {
  const incoming = new Map<string, FlowEntry>();
  const spent = new Map<string, { label: string; debits: number; credits: number }>();
  let totalIn = 0;
  let other = 0;

  const bucket = (name: string) => {
    const key = `out:${name.toLowerCase()}`;
    const entry = spent.get(key) ?? { label: name, debits: 0, credits: 0 };
    spent.set(key, entry);
    return entry;
  };

  for (const tx of transactions) {
    const info = category(tx.category_id);

    if (tx.amount > 0) {
      // Income is grouped by where it came from, since "Salary" and "Rent
      // received" are the distinction worth drawing on that side. Transfers
      // in sit beside it, because money out of savings genuinely is where
      // some of the month's spending came from.
      if (info && (info.countsAsIncome || info.isTransfer)) {
        totalIn += tx.amount;
        const key = `in:${info.name.toLowerCase()}`;
        const entry = incoming.get(key) ?? { key, label: info.name, amount: 0 };
        entry.amount += tx.amount;
        incoming.set(key, entry);
        continue;
      }

      // A credit in a named category is money coming back *to that category*
      // — a refund on transport means transport cost less — so it nets there.
      if (info) {
        bucket(info.name).credits += tx.amount;
        continue;
      }

      // An unfiled credit nets against nothing. "Uncategorised" is the
      // absence of a relationship, not a relationship, so setting one
      // unknown against another would be inventing the connection. It goes
      // on the left under a name that claims nothing.
      other += tx.amount;
      continue;
    }

    if (tx.amount < 0) bucket(info?.name ?? "Uncategorised").debits += Math.abs(tx.amount);
  }

  const outgoing: FlowEntry[] = [];
  for (const [key, entry] of spent) {
    const net = entry.debits - entry.credits;
    if (net > 0.005) outgoing.push({ key, label: entry.label, amount: net });
    // Took back more than it ever spent. The excess is real money that
    // arrived, so it has to show somewhere or the picture stops adding up —
    // just never under the category's own name on the income side.
    else if (net < -0.005) other += -net;
  }

  if (other > 0.005) {
    totalIn += other;
    incoming.set("in:__other", { key: "in:__other", label: OTHER_IN_LABEL, amount: other });
  }

  const totalOut = outgoing.reduce((sum, entry) => sum + entry.amount, 0);
  const destinations = condense(outgoing, totalIn || totalOut);
  const surplus = totalIn - totalOut;

  // What was not spent is a destination like any other. Leaving it out would
  // make the right-hand side lighter than the left with nothing saying why,
  // and "what was left" is half the reason to look at a month at all.
  if (surplus > 0.005) {
    destinations.push({ key: "__surplus", label: "Left over", amount: surplus });
  }

  return {
    sources: condense([...incoming.values()], totalIn),
    destinations,
    totalIn,
    totalOut,
    surplus,
  };
}
