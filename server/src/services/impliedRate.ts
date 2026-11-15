/**
 * A debt's interest rate, worked out from the interest it has actually charged.
 *
 * Four of the debts on this app carry no rate, which is the one field the
 * payoff order depends on: without it the planner cannot say whether to clear
 * the card at 41% or the loan at 6% first, and the answer it gives instead is
 * arbitrary. The rates are published, but a lender's representative APR is not
 * the rate a particular person was given, and a figure typed in from an advert
 * is a guess wearing the clothes of a fact.
 *
 * The statements already hold the answer. A card that charged 61.40 in a month
 * against a balance of 2,424.86 is charging about 30% a year, and that figure
 * is this account's, not the product's.
 *
 * What this cannot do is separate a purchase rate from a cash rate, or see a
 * promotional period, and on a balance that moved sharply mid-month it reads
 * high or low. So it produces a proposal with the charges it used attached,
 * and a person confirms it before anything is stored - the same rule the
 * contract and statement readers follow.
 */

/** An interest charge found on an account, and the balance it was charged on. */
export interface RateSample {
  date: string;
  /** Positive: what the interest cost, however the ledger signs it. */
  interest: number;
  /** Positive: what was owed when it was charged. */
  balance: number;
}

export interface ImpliedRate {
  /** Annual percentage, to one decimal place. */
  rate: number;
  /** Every month that contributed, so the figure can be checked. */
  samples: RateSample[];
  /**
   * Low when one month is all there is, or when the months disagree sharply:
   * a single charge cannot tell a normal month from a fee, and a spread that
   * wide usually means the balance moved rather than the rate.
   */
  confidence: "high" | "low";
}

/**
 * Whether a line is interest being charged.
 *
 * Deliberately narrow. "Interest" in a description is close to unambiguous on
 * a debt account, while fees, charges and insurance are other things entirely
 * and would each inflate the rate if swept in. A refund of interest is
 * excluded too - it is the same word doing the opposite job.
 */
export function isInterestCharge(description: string | null | undefined): boolean {
  const text = (description ?? "").toLowerCase();
  if (!text) return false;
  if (/refund|rebate|reversal|credit of|adjustment/.test(text)) return false;
  return /\binterest\b/.test(text) || /\bint(?:\.|\b)\s*(?:chg|charge|charged)\b/.test(text);
}

/** The middle value, which a single unusual month cannot drag. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The annual rate those charges imply, or null when they imply nothing.
 *
 * Each month gives its own answer — the charge as a share of what was owed,
 * times twelve — and the median of those is taken rather than the mean, so one
 * month with an annual fee in it cannot carry the result.
 */
export function impliedAnnualRate(samples: RateSample[]): ImpliedRate | null {
  // A charge against nothing owed, or a zero charge, says nothing about a rate
  // and would divide by zero trying.
  const usable = samples.filter((s) => s.interest > 0 && s.balance > 0);
  if (usable.length === 0) return null;

  const rates = usable.map((s) => (s.interest / s.balance) * 12 * 100);
  const rate = Math.round(median(rates) * 10) / 10;

  // A rate this app would store has to be a rate: the column is capped at 100
  // and a result above it means the balance used was wrong, not that someone
  // is paying 400%.
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return null;

  const spread = Math.max(...rates) - Math.min(...rates);
  const confidence = usable.length >= 3 && spread <= median(rates) * 0.5 ? "high" : "low";

  return { rate, samples: usable, confidence };
}
