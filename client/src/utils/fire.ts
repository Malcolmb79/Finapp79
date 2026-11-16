/**
 * When the money could stop coming from work.
 *
 * The arithmetic is simple and almost every version of it gets two things
 * wrong, so both are decided here once and said out loud wherever the figure
 * appears.
 *
 * **What funds it is not net worth.** The house you live in does not pay for
 * groceries unless you sell it and move somewhere, and a calculator that folds
 * it in brings the date forward by a decade on money that was never available.
 * So the pot is *investable* assets — investments and savings — and the
 * caller is told exactly that.
 *
 * **Everything is in today's money.** The projection grows the pot at a real
 * return, after inflation, which means the target never has to be inflated
 * either. Mixing a nominal return with an un-inflated target is the most
 * common error in these calculators and it always errs the same way:
 * optimistically.
 *
 * What it cannot do is predict returns. A projection is a sentence of the form
 * "if these numbers hold", and the numbers will not hold. It is useful for
 * comparing two choices against each other, not for booking a date.
 */

export interface FireInput {
  /** Investments and savings — what could actually be drawn on. Not the home. */
  investable: number;
  /** Put aside each month, in today's money. */
  monthlySaving: number;
  /** What a year costs, in today's money. */
  annualExpenses: number;
  /** Return after inflation, as a fraction. 0.05 is five per cent above inflation. */
  realReturn?: number;
  /** Safe withdrawal rate. 0.04 is the 4% rule — a pot of 25 times the annual spend. */
  withdrawalRate?: number;
}

export type Blocker = "spending-more-than-earned" | "no-expenses" | "too-slow";

export interface FireResult {
  /** The pot that would support the spending at the withdrawal rate. */
  target: number;
  /** Where the pot is now. */
  investable: number;
  /** How far along, as a fraction. Can exceed 1. */
  progress: number;
  /** Months until the pot reaches the target. 0 when already there, null when it never does. */
  months: number | null;
  /** Why it never does, when it doesn't. */
  blocker: Blocker | null;
  /** The pot at the start of each year, for drawing. */
  path: { year: number; value: number }[];
}

/** Five per cent above inflation — roughly a global equity fund's long run, net of fees. */
export const DEFAULT_REAL_RETURN = 0.05;

/** The 4% rule, which is a rule of thumb from one study of one country's history. */
export const DEFAULT_WITHDRAWAL_RATE = 0.04;

/** Beyond this the answer is "not on these numbers", not a number. */
const MAX_MONTHS = 70 * 12;

/** The pot a given annual spend needs behind it. */
export function fireNumber(annualExpenses: number, withdrawalRate = DEFAULT_WITHDRAWAL_RATE): number {
  if (!(withdrawalRate > 0)) return Infinity;
  return annualExpenses / withdrawalRate;
}

export function projectFire(input: FireInput): FireResult {
  const {
    investable,
    monthlySaving,
    annualExpenses,
    realReturn = DEFAULT_REAL_RETURN,
    withdrawalRate = DEFAULT_WITHDRAWAL_RATE,
  } = input;

  const target = fireNumber(annualExpenses, withdrawalRate);
  const progress = target > 0 ? investable / target : 0;

  // Spending nothing is not financial independence at zero, it is a figure
  // nobody has entered yet. Saying so beats reporting that they retired.
  if (!(annualExpenses > 0)) {
    return { target: 0, investable, progress: 0, months: null, blocker: "no-expenses", path: [] };
  }

  if (investable >= target) {
    return { target, investable, progress, months: 0, blocker: null, path: [{ year: 0, value: investable }] };
  }

  /**
   * A deficit is refused up front rather than projected through.
   *
   * The pot would still compound, so the loop below happily reports a date
   * forty years out — while the shortfall funding the household's month is
   * borrowing this model does not track at all. The date would be real
   * arithmetic about a future that has somebody quietly going further into
   * debt every month of it.
   *
   * Saving *nothing* is deliberately not this. A pot already large enough to
   * compound into the target on its own is coasting, which is a real and
   * reachable position - see coastsBy.
   */
  if (monthlySaving < 0) {
    return { target, investable, progress, months: null, blocker: "spending-more-than-earned", path: [{ year: 0, value: investable }] };
  }

  const monthlyRate = Math.pow(1 + realReturn, 1 / 12) - 1;
  const path: { year: number; value: number }[] = [{ year: 0, value: investable }];

  let pot = investable;
  for (let month = 1; month <= MAX_MONTHS; month++) {
    pot = pot * (1 + monthlyRate) + monthlySaving;
    if (month % 12 === 0) path.push({ year: month / 12, value: Math.round(pot) });
    if (pot >= target) {
      if (month % 12 !== 0) path.push({ year: month / 12, value: Math.round(pot) });
      return { target, investable, progress, months: month, blocker: null, path };
    }
    // A pot that is shrinking will not arrive, and running the loop seventy
    // more years to discover that produces a flat line and no answer.
    if (pot <= 0) break;
  }

  // Everything that gets this far is saving something, or coasting on a pot
  // too small to arrive. Either way the problem is the rate, not the budget.
  return { target, investable, progress, months: null, blocker: "too-slow", path };
}

/**
 * What the pot becomes if nothing more is ever added — "coast" FIRE.
 *
 * The number that answers a question people ask constantly and calculators
 * rarely do: not "when can I stop working" but "when can I stop *saving*".
 * Someone whose existing pot will compound into the target on its own has
 * already won, and every further euro put in buys a different thing — an
 * earlier date, or a larger life — rather than the outcome itself.
 */
export function coastValue(investable: number, years: number, realReturn = DEFAULT_REAL_RETURN): number {
  return investable * Math.pow(1 + realReturn, years);
}

/**
 * Whether the pot already coasts to the target by a given horizon.
 *
 * Returns the years at which it gets there on its own, or null if it does not
 * within the horizon.
 */
export function coastsBy(input: FireInput, horizonYears: number): number | null {
  const target = fireNumber(input.annualExpenses, input.withdrawalRate ?? DEFAULT_WITHDRAWAL_RATE);
  if (!(target > 0)) return null;
  for (let year = 0; year <= horizonYears; year++) {
    if (coastValue(input.investable, year, input.realReturn ?? DEFAULT_REAL_RETURN) >= target) return year;
  }
  return null;
}

/** "7 years 4 months", or the honest words when there is no number. */
export function fireTimeline(result: FireResult): string {
  if (result.blocker === "no-expenses") return "No spending recorded yet";
  if (result.blocker === "spending-more-than-earned") return "Not while more goes out than comes in";
  if (result.blocker === "too-slow") return "Over 70 years at this rate";
  if (result.months === 0) return "Already there";

  const months = result.months ?? 0;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} month${rest === 1 ? "" : "s"}`;
  if (rest === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years} yr ${rest} mo`;
}

/** The date it lands on, for a result that lands. */
export function fireDate(result: FireResult, from = new Date()): string | null {
  if (result.months === null) return null;
  const date = new Date(Date.UTC(from.getFullYear(), from.getMonth() + result.months, 1));
  return date.toISOString().slice(0, 7);
}
