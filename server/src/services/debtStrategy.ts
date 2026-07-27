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
  /** What kind of borrowing this is, which decides the assumed minimum. */
  type?: "credit_card" | "loan" | "current" | "savings";
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
  /**
   * Total owed at the end of each month, starting with what's owed today.
   *
   * For drawing the curve. It comes from the same run as the headline figures
   * rather than from a second, simpler calculation, so a chart can never
   * disagree with the number printed beside it.
   */
  balanceByMonth: number[];
  /** Set when the payments don't cover the interest, so the debt only grows. */
  neverClears: boolean;
}

// Half a century. Anything that hasn't cleared by then hasn't cleared, and the
// loop has to stop somewhere.
const MAX_MONTHS = 600;

// Below this a balance is settled — floating point leaves fractions of a cent
// behind that would otherwise keep a debt alive forever.
const SETTLED = 0.005;

// The smallest sum any lender bothers to ask for. Below this a card minimum
// is the whole balance.
const MINIMUM_FLOOR = 25;

/**
 * What a debt is assumed to be paid each month when nothing has been imported
 * for it yet. A stated figure always wins.
 *
 * For a credit card this is deliberately not a flat percentage. Card minimums
 * are set as a small percentage *plus that month's interest*, and the
 * distinction decides the answer rather than refining it: 1% of the balance
 * against a 20% card is 1% paid versus 1.67% charged, so a flat percentage
 * describes a debt that grows forever and the chart reports "never clears" for
 * an ordinary card being paid normally. Adding the interest makes the
 * assumption behave the way a real minimum does — clearing, slowly.
 *
 * Anything else keeps the plain percentage: a loan or an overdraft with no
 * recorded payment has no conventional minimum to imitate, and inventing an
 * interest-covering one would flatter it.
 */
export function assumedMinimum(debt: DebtInput): number {
  const monthlyInterest = debt.balance * (debt.rate / 100 / 12);
  const base = debt.type === "credit_card" ? debt.balance * 0.01 + monthlyInterest : debt.balance * 0.01;
  return Math.max(base, Math.min(debt.balance, MINIMUM_FLOOR));
}

function minimumFor(debt: DebtInput): number {
  return debt.minimumPayment > 0 ? debt.minimumPayment : assumedMinimum(debt);
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
    // A card whose real payment isn't known yet is the one case where the
    // minimum moves: card minimums are a percentage of the current balance,
    // so they fall as it does. Holding it fixed would have the debt clearing
    // years sooner than paying the actual minimum ever would — flattering, on
    // the one number a debt planner exists to be honest about.
    recalculates: d.type === "credit_card" && d.minimumPayment <= 0,
    input: d,
    interestPaid: 0,
    monthCleared: 0,
  }));

  const monthlyOutlay = state.reduce((sum, d) => sum + d.minimum, 0) + Math.max(0, extraPerMonth);
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;
  const focusOrder: string[] = [];
  const totalOwed = () => round(state.reduce((sum, d) => sum + Math.max(0, d.balance), 0));
  const balanceByMonth: number[] = [totalOwed()];

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

    // A recalculating minimum is re-read from the balance the month opens
    // with, the way a card statement does it.
    for (const debt of state) {
      if (debt.recalculates) debt.minimum = assumedMinimum({ ...debt.input, balance: debt.balance });
    }

    // What's paid this month: what the live debts are asking for, plus the
    // minimums of debts already cleared, plus the extra.
    //
    // Those two middle terms pull in opposite directions and both matter. A
    // cleared debt's payment keeps flowing — that roll-over is the whole
    // reason avalanche and snowball beat paying minimums. But a card's
    // *own* minimum falls as its balance does, and that money is not
    // redirected anywhere: paying the minimum means paying less each month,
    // which is exactly why minimum-only takes decades. Holding the total
    // fixed instead would quietly turn the minimum-only case back into a
    // fixed payment and report a fraction of the real time.
    const dueThisMonth = state.filter((d) => d.balance > SETTLED).reduce((sum, d) => sum + d.minimum, 0);
    const freed = state.filter((d) => d.balance <= SETTLED).reduce((sum, d) => sum + d.minimum, 0);
    let available = dueThisMonth + freed + Math.max(0, extraPerMonth);

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

    balanceByMonth.push(totalOwed());
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
    balanceByMonth,
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
