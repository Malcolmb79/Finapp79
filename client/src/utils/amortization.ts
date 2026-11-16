/**
 * A loan, month by month, with and without paying extra.
 *
 * `monthsToPayoff` already answers "how long at this payment", which is the
 * right answer to a different question. This one produces the schedule itself:
 * what each payment is actually made of, how the split between interest and
 * principal moves, and — the part that changes behaviour — what putting a
 * little more in every month does to both the date and the total.
 *
 * The reason that is worth a screen of its own is that the effect is wildly
 * non-obvious. Two hundred a month extra on a thirty-year mortgage at six and
 * a half per cent is not six per cent off the term; it is nearly seven years
 * and six figures of interest. Nobody has that intuition, which is exactly why
 * it has to be shown rather than described.
 *
 * Every figure here is the sum of a schedule that is also printed. A payoff
 * claim nobody can check row by row is a claim that gets doubted precisely
 * when it is most useful.
 */

export interface LoanTerms {
  /** Outstanding principal — what is owed today, not the sum of remaining instalments. */
  balance: number;
  /** Annual rate as a percentage: 6.5 means 6.5%. */
  annualRate: number;
  /** Months remaining. */
  termMonths: number;
  /** Put in on top of the scheduled payment, every month. */
  extraMonthly?: number;
  /** YYYY-MM the first payment falls in. */
  startMonth?: string;
}

export interface ScheduleRow {
  /** 1-based. */
  number: number;
  /** YYYY-MM, when a start month was given. */
  month: string | null;
  payment: number;
  principal: number;
  interest: number;
  /** After this payment. */
  balance: number;
  cumulativeInterest: number;
}

export interface Amortization {
  /** The scheduled payment, before anything extra. */
  monthlyPayment: number;
  /** What actually leaves the account each month. */
  totalMonthly: number;
  schedule: ScheduleRow[];
  months: number;
  totalInterest: number;
  totalPaid: number;
}

export interface PayoffComparison {
  standard: Amortization;
  accelerated: Amortization;
  monthsSaved: number;
  interestSaved: number;
}

const MAX_MONTHS = 60 * 12;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function addMonths(start: string | undefined, offset: number): string | null {
  if (!start) return null;
  const [year, month] = start.split("-").map(Number);
  if (!year || !month) return null;
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
}

/**
 * The level payment that clears the balance over the term.
 *
 * Zero interest is its own case rather than a limit to approach: the standard
 * formula divides by the rate, and a rate of zero would produce a division by
 * nothing on the most ordinary loan there is — a family loan, an interest-free
 * plan, a balance sitting on a promotional rate.
 */
export function monthlyPayment(balance: number, annualRate: number, termMonths: number): number {
  if (balance <= 0 || termMonths <= 0) return 0;
  const rate = annualRate / 100 / 12;
  if (rate <= 0) return round(balance / termMonths);
  const factor = Math.pow(1 + rate, termMonths);
  return round((balance * rate * factor) / (factor - 1));
}

export function amortize(terms: LoanTerms): Amortization {
  const { balance, annualRate, termMonths, extraMonthly = 0, startMonth } = terms;
  const scheduled = monthlyPayment(balance, annualRate, termMonths);
  const rate = annualRate / 100 / 12;
  const payment = scheduled + Math.max(0, extraMonthly);

  const schedule: ScheduleRow[] = [];
  let remaining = balance;
  let cumulativeInterest = 0;

  for (let number = 1; remaining > 0 && number <= MAX_MONTHS; number++) {
    const interest = round(remaining * rate);

    /**
     * The final contracted payment clears whatever is left, as a lender's does.
     *
     * The instalment is rounded to the cent, which makes it a fraction less
     * than the exact figure the term requires — so after the last of 360
     * payments a few euro survive, and a naive schedule adds a 361st payment
     * to collect them. A thirty-year mortgage reported as thirty years and a
     * month is wrong in a way that makes every "months saved" figure beside it
     * off by one.
     */
    const final = number >= termMonths;
    // Otherwise: whatever clears it, never more. Without the clamp the last
    // payment overshoots into a negative balance and the total paid is
    // overstated by the overshoot.
    const principal = final ? remaining : Math.min(round(payment - interest), remaining);

    // A payment that does not cover the month's interest never clears the
    // loan. Rather than looping to the cap and reporting a sixty-year term,
    // the schedule stops and says what it is: a balance that grows.
    if (principal <= 0) break;

    remaining = round(remaining - principal);
    cumulativeInterest = round(cumulativeInterest + interest);
    schedule.push({
      number,
      month: addMonths(startMonth, number - 1),
      payment: round(principal + interest),
      principal,
      interest,
      balance: remaining,
      cumulativeInterest,
    });
  }

  return {
    monthlyPayment: scheduled,
    totalMonthly: round(payment),
    schedule,
    months: schedule.length,
    totalInterest: cumulativeInterest,
    totalPaid: round(schedule.reduce((sum, row) => sum + row.payment, 0)),
  };
}

/**
 * The same loan twice: as contracted, and with the extra going in.
 *
 * Both schedules come from one function, so the comparison cannot be between
 * two different models of the same loan — which is how a payoff tool ends up
 * reporting a saving that is really a difference in rounding.
 */
export function comparePayoff(terms: LoanTerms): PayoffComparison {
  const standard = amortize({ ...terms, extraMonthly: 0 });
  const accelerated = amortize(terms);
  return {
    standard,
    accelerated,
    monthsSaved: standard.months - accelerated.months,
    interestSaved: round(standard.totalInterest - accelerated.totalInterest),
  };
}

export interface RefinanceOffer {
  annualRate: number;
  termMonths: number;
  /** Arrangement fees, valuation, legals — whatever it costs to switch. */
  fees?: number;
}

export interface RefinanceComparison {
  current: Amortization;
  offer: Amortization;
  /** Positive is a smaller payment each month. */
  monthlySaving: number;
  /** Positive means the switch costs less overall. Can be negative on a lower rate. */
  interestSaved: number;
  /** Including the fees, which is the figure that decides it. */
  netSaving: number;
  /** Months of the smaller payment before the fees are back. Null when there is no saving to recover them from. */
  breakEvenMonths: number | null;
  /** True when the payment falls and the total paid rises, which is the trap. */
  cheaperButCostlier: boolean;
}

/**
 * The same debt on the terms offered.
 *
 * The trap this exists to expose is that a refinance is sold on the monthly
 * payment and paid for in total interest, and a longer term lowers the first
 * while raising the second. Somebody twenty years into a mortgage, offered a
 * lower rate over a fresh thirty, is being shown a smaller number and handed a
 * larger bill — and the smaller number is the one on the advert.
 *
 * So both figures are returned side by side, the fees are inside the net, and
 * the case where they disagree gets a flag of its own rather than being left
 * for the reader to notice.
 */
export function compareRefinance(current: LoanTerms, offer: RefinanceOffer): RefinanceComparison {
  const currentSchedule = amortize({ ...current, extraMonthly: 0 });
  const offerSchedule = amortize({
    balance: current.balance,
    annualRate: offer.annualRate,
    termMonths: offer.termMonths,
    startMonth: current.startMonth,
  });

  const monthlySaving = round(currentSchedule.monthlyPayment - offerSchedule.monthlyPayment);
  const interestSaved = round(currentSchedule.totalInterest - offerSchedule.totalInterest);
  const fees = offer.fees ?? 0;

  return {
    current: currentSchedule,
    offer: offerSchedule,
    monthlySaving,
    interestSaved,
    netSaving: round(interestSaved - fees),
    // Nothing to recover the fees from if the payment did not fall, so the
    // answer is "never" rather than a very large number of months.
    breakEvenMonths: monthlySaving > 0 ? Math.ceil(fees / monthlySaving) : null,
    cheaperButCostlier: monthlySaving > 0 && interestSaved < 0,
  };
}

/** Whether the payment covers the interest at all — the one case with no schedule. */
export function neverClears(terms: LoanTerms): boolean {
  return terms.balance > 0 && amortize(terms).months === 0;
}

/** "23 yr 1 mo", the way somebody says a mortgage term. */
export function termLabel(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} mo`;
  if (rest === 0) return `${years} yr`;
  return `${years} yr ${rest} mo`;
}
