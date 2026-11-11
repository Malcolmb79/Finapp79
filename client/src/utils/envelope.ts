/**
 * Envelope budgeting: what is left in each category, carried month to month.
 *
 * A monthly cap answers "have I gone over this month" and forgets everything
 * before it. That suits a bill and suits nothing else. The categories people
 * actually struggle with are the lumpy ones — car repairs, clothes, presents,
 * the dentist — where the useful question is not "did I overspend in March"
 * but "how much is there for this, now, given how the last few months went".
 *
 * So each month gets an amount put into it, and whatever is left stays there:
 *
 *     available(month) = carried in + assigned + refunds − spent
 *     carried into the next month = available
 *
 * Overspending carries too, as a negative. That is the honest version and the
 * uncomfortable one: a category £40 down starts next month at −£40 rather
 * than quietly resetting to zero. Resetting would let a category be overspent
 * every month forever while every individual month looked survivable.
 */

export interface EnvelopeMonth {
  categoryId: number;
  label: string;
  /** What was left at the end of last month, positive or negative. */
  carried: number;
  /** What was put into the category for this month. */
  assigned: number;
  /** Spent from it this month, as a positive number. */
  spent: number;
  /** carried + assigned − spent. Negative means overspent. */
  available: number;
}

export interface EnvelopePlan {
  categories: EnvelopeMonth[];
  /** Money that arrived this month. */
  income: number;
  /** Put into categories this month. */
  assigned: number;
  /**
   * Income not yet given a job. Negative means more was assigned than came
   * in — which is allowed, since it may be funded by what was carried in,
   * but is worth seeing.
   */
  unassigned: number;
}

interface Movement {
  amount: number;
  booking_date: string;
  category_id: number | null;
}

/** month → category → amount put in. */
export type Assignments = Map<string, Map<number, number>>;

const month = (date: string) => date.slice(0, 7);

/** Every month from the earliest movement up to and including `upTo`. */
function monthsUpTo(earliest: string, upTo: string): string[] {
  const months: string[] = [];
  let [year, index] = [Number(earliest.slice(0, 4)), Number(earliest.slice(5, 7))];
  // Bounded rather than trusting the dates: a transaction mis-dated to 1900
  // would otherwise walk twelve hundred months before noticing.
  for (let guard = 0; guard < 600; guard++) {
    const key = `${year}-${String(index).padStart(2, "0")}`;
    months.push(key);
    if (key >= upTo) break;
    index += 1;
    if (index > 12) {
      index = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * The plan for one month, with everything before it taken into account.
 *
 * The balance carried in cannot be read off the month itself — it is the
 * result of every month before it — so this walks from the first month that
 * had any activity. That is why it takes the whole history rather than one
 * month's worth.
 */
export function envelopePlan(
  transactions: Movement[],
  assignments: Assignments,
  categories: { id: number; name: string }[],
  forMonth: string
): EnvelopePlan {
  const relevant = transactions.filter((tx) => month(tx.booking_date) <= forMonth);
  const earliest = relevant.reduce<string | null>(
    (first, tx) => (first === null || tx.booking_date < first ? tx.booking_date : first),
    null
  );

  const months = earliest ? monthsUpTo(month(earliest), forMonth) : [forMonth];

  /** category → running balance carried forward. */
  const carried = new Map<number, number>();
  let result: EnvelopeMonth[] = [];

  for (const key of months) {
    const spentThis = new Map<number, number>();
    for (const tx of relevant) {
      if (month(tx.booking_date) !== key) continue;
      if (tx.category_id == null) continue;
      // A refund puts money back in the envelope rather than counting as
      // income: it is the category's own money coming home.
      spentThis.set(tx.category_id, (spentThis.get(tx.category_id) ?? 0) - tx.amount);
    }

    const assignedThis = assignments.get(key) ?? new Map<number, number>();

    result = categories.map((category) => {
      const carriedIn = carried.get(category.id) ?? 0;
      const assigned = assignedThis.get(category.id) ?? 0;
      const spent = spentThis.get(category.id) ?? 0;
      return {
        categoryId: category.id,
        label: category.name,
        carried: round(carriedIn),
        assigned: round(assigned),
        spent: round(spent),
        available: round(carriedIn + assigned - spent),
      };
    });

    for (const row of result) carried.set(row.categoryId, row.available);
  }

  const income = relevant
    .filter((tx) => month(tx.booking_date) === forMonth && tx.amount > 0)
    .reduce((sum, tx) => sum + tx.amount, 0);
  const assigned = [...(assignments.get(forMonth) ?? new Map()).values()].reduce((sum, value) => sum + value, 0);

  return {
    categories: result,
    income: round(income),
    assigned: round(assigned),
    unassigned: round(income - assigned),
  };
}

/** Money is counted in whole cents; floating point drift is not a figure. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
