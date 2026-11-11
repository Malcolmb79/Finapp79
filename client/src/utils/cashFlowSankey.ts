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
 * `categoryName` returns null for an uncategorised transaction, which becomes
 * its own band rather than being hidden: money that went somewhere unnamed is
 * still money that went somewhere, and a picture that quietly omitted it
 * would not add up to the total printed beside it.
 */
export function cashFlow(transactions: Flowable[], categoryName: (id: number | null) => string | null): CashFlow {
  const incoming = new Map<string, FlowEntry>();
  const outgoing = new Map<string, FlowEntry>();
  let totalIn = 0;
  let totalOut = 0;

  for (const tx of transactions) {
    if (tx.amount > 0) {
      totalIn += tx.amount;
      // Income is grouped by where it came from, since "Salary" and "Rent
      // received" are the distinction worth drawing on that side.
      const name = categoryName(tx.category_id) ?? (tx.counterparty || tx.description || "Other income");
      const key = `in:${name.toLowerCase()}`;
      const entry = incoming.get(key) ?? { key, label: name, amount: 0 };
      entry.amount += tx.amount;
      incoming.set(key, entry);
    } else if (tx.amount < 0) {
      const spent = Math.abs(tx.amount);
      totalOut += spent;
      const name = categoryName(tx.category_id) ?? "Uncategorised";
      const key = `out:${name.toLowerCase()}`;
      const entry = outgoing.get(key) ?? { key, label: name, amount: 0 };
      entry.amount += spent;
      outgoing.set(key, entry);
    }
  }

  const destinations = condense([...outgoing.values()], totalIn || totalOut);
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
