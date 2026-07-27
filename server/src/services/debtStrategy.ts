/**
 * Simulates paying debts off, month by month.
 *
 * Every figure the advisor quotes comes from here rather than from the model.
 * A payoff date or an interest saving is arithmetic with one right answer, and
 * a model asked for one will produce something plausible — which is worse than
 * useless when someone is deciding where to put their money. The model chooses
 * what to simulate and explains the result; this decides what the result is.
 */

export interface DebtInput {
  id: string;
  name: string;
  /** Positive: what is owed. */
  balance: number;
  /** Annual interest rate as a percentage. 0 when unknown. */
  rate: number;
  /** Contractual monthly payment, where there is one. */
  minimumPayment: number;
  currency: string;
}

export interface PayoffResult {
  strategy: "avalanche" | "snowball";
  currency: string;
  /** Null when the debts never clear at this payment level. */
  months: number | null;
  totalInterest: number;
  totalPaid: number;
  /** The order debts are cleared in, first cleared first. */
  order: { name: string; monthCleared: number; interestPaid: number }[];
  /**
   * The debts in the order the extra payment is aimed at them.
   *
   * Not the same as the order they clear in, and it is this one the advice
   * turns on: a small cheap debt can clear first on its own minimum while the
   * strategy is pointing every spare penny at an expensive one.
   */
  focusOrder: string[];
  /** What is being paid across all these debts each month, at the start. */
  monthlyOutlay: number;
  /** Set when the payments don't cover the interest, so the debt only grows. */
  neverClears: boolean;
}

// Half a century. Anything that hasn't cleared by then hasn't cleared, and the
// loop has to stop somewhere.
const MAX_MONTHS = 600;

// Below this a balance is settled — floating point leaves fractions of a cent
// behind that would otherwise keep a debt alive forever.
const SETTLED = 0.005;

/**
 * A debt with no stated minimum still has to be paid something, or it sits
 * accruing interest and makes every plan look impossible. One percent of the
 * balance is the usual card minimum and a reasonable stand-in; it is only ever
 * a floor, and the caller's own figure wins where there is one.
 */
function minimumFor(debt: DebtInput): number {
  if (debt.minimumPayment > 0) return debt.minimumPayment;
  return Math.max(debt.balance * 0.01, Math.min(debt.balance, 25));
}

/**
 * @param extraPerMonth Paid on top of the minimums, all of it to whichever
 *   debt the strategy targets.
 */
export function simulate(
  debts: DebtInput[],
  extraPerMonth: number,
  strategy: "avalanche" | "snowball"
): PayoffResult {
  const currency = debts[0]?.currency ?? "";
  const state = debts.map((d) => ({
    name: d.name,
    balance: d.balance,
    monthlyRate: d.rate / 100 / 12,
    minimum: minimumFor(d),
    interestPaid: 0,
    monthCleared: 0,
  }));

  const monthlyOutlay = state.reduce((sum, d) => sum + d.minimum, 0) + Math.max(0, extraPerMonth);
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;
  const focusOrder: string[] = [];

  while (month < MAX_MONTHS && state.some((d) => d.balance > SETTLED)) {
    month++;

    // Interest first, on the balance carried into the month.
    for (const debt of state) {
      if (debt.balance <= SETTLED) continue;
      const interest = debt.balance * debt.monthlyRate;
      debt.balance += interest;
      debt.interestPaid += interest;
      totalInterest += interest;
    }

    let available = monthlyOutlay;

    // Minimums come out first, since they are contractual. A debt smaller
    // than its own minimum only takes what it needs — the rest stays in the
    // pot for the target.
    for (const debt of state) {
      if (debt.balance <= SETTLED || available <= 0) continue;
      const payment = Math.min(debt.minimum, debt.balance, available);
      debt.balance -= payment;
      available -= payment;
      totalPaid += payment;
      if (debt.balance <= SETTLED) debt.monthCleared = month;
    }

    // Everything left goes at one debt: the dearest for avalanche, the
    // smallest for snowball. As debts clear, their minimums roll into this —
    // which is the whole reason either strategy beats paying minimums.
    while (available > SETTLED) {
      const live = state.filter((d) => d.balance > SETTLED);
      if (live.length === 0) break;

      const target =
        strategy === "avalanche"
          ? live.reduce((best, d) => (d.monthlyRate > best.monthlyRate ? d : best))
          : live.reduce((best, d) => (d.balance < best.balance ? d : best));

      if (focusOrder[focusOrder.length - 1] !== target.name) focusOrder.push(target.name);

      const payment = Math.min(target.balance, available);
      target.balance -= payment;
      available -= payment;
      totalPaid += payment;
      if (target.balance <= SETTLED) target.monthCleared = month;
      // Nothing more can be paid this month if the target didn't absorb it
      // and no other debt is live.
      if (payment <= 0) break;
    }
  }

  const outstanding = state.filter((d) => d.balance > SETTLED);
  // Payments that don't cover the interest mean the balance grows regardless
  // of the strategy — worth saying outright rather than reporting "50 years".
  const neverClears = outstanding.length > 0;

  return {
    strategy,
    currency,
    months: neverClears ? null : month,
    totalInterest: round(totalInterest),
    totalPaid: round(totalPaid),
    monthlyOutlay: round(monthlyOutlay),
    neverClears,
    focusOrder,
    order: state
      .filter((d) => d.monthCleared > 0)
      .sort((a, b) => a.monthCleared - b.monthCleared)
      .map((d) => ({ name: d.name, monthCleared: d.monthCleared, interestPaid: round(d.interestPaid) })),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Both strategies at one payment level, for comparison. */
export function compareStrategies(debts: DebtInput[], extraPerMonth: number) {
  return {
    avalanche: simulate(debts, extraPerMonth, "avalanche"),
    snowball: simulate(debts, extraPerMonth, "snowball"),
  };
}
