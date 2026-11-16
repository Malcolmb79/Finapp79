import type { Category, Policy } from "../api/client.js";
import { distinctiveWords } from "./distinctiveWords.js";
import type { RecurringPayment } from "./recurring.js";

/**
 * What kind of standing commitment a regular payment actually is.
 *
 * The detector finds anything charged on a rhythm for a consistent amount,
 * which is the right net to cast and the wrong word to put on the result. A
 * life policy at €95.90 a month is not a subscription: cancelling Netflix
 * costs you Netflix, and cancelling cover costs you the cover — the one thing
 * it exists to buy is the thing you lose. Listing it under a heading whose
 * whole promise is "here is what you could stop paying for" invites exactly
 * the wrong arithmetic.
 *
 * A loan repayment is a third thing again, and left out of this list entirely
 * by `subscriptions()`, because it is not spending at all — see `recurring.ts`.
 * Insurance **is** spending: the money is gone and no balance went down, so it
 * stays in every total and only stops being called a subscription.
 *
 * Nothing here reads a merchant. There is no list of insurers in this file and
 * there should never be one: `recurring.ts` finds the gym and the accountant
 * as readily as Netflix precisely because it knows no merchants, and a feature
 * that only recognises the insurers somebody thought of is worse than one that
 * says it does not know. Both routes below are the owner's own words, read
 * back:
 *
 *   **A policy they hold.** The name they gave it, or the insurer on it,
 *   appearing on a payment of about the right size. Two independent places
 *   agreeing — the same footing `loanRepayments.ts` and the server's
 *   `policyPremiums.ts` stand on.
 *
 *   **A category they filed it under.** Somebody typing "Insurance" on a
 *   transaction has already answered this question, and the answer is better
 *   than anything this file could work out.
 */

export type CommitmentKind = "subscription" | "insurance";

export interface Commitment {
  payment: RecurringPayment;
  kind: CommitmentKind;
  /** Why it was read that way, in the owner's own words. Null for a subscription. */
  because: string | null;
}

/**
 * A premium moves — annual escalation, a rate review — but not by much. The
 * same tolerance the detector groups charges by, for the same reason.
 */
const AMOUNT_TOLERANCE = 0.2;

/**
 * A category name that has already answered the question.
 *
 * Deliberately only the two words that mean this and nothing else. "Cover" is
 * not among them: a cover charge is a night out, and "Life cover" filed under
 * that name is caught by the policy route instead, which has an amount to
 * check as well as a word. A reading that is sometimes wrong about what a
 * payment is would be worse than no reading, because it is quietly wrong — the
 * row simply moves to a different heading and nothing announces it.
 */
const INSURANCE_CATEGORY = /\b(insurance|assurance)\b/i;

/** The most recent category the charges were filed under, if any. */
function filedUnder(payment: RecurringPayment, categories: Category[]): Category | null {
  const id = payment.categoryIds.find((value) => value != null);
  if (id == null) return null;
  return categories.find((category) => category.id === id) ?? null;
}

/**
 * The policy this payment looks like the premium for.
 *
 * Both tests have to pass. The name alone is far too loose — an insurer that
 * also sells you car cover appears in plenty of unrelated debits — and the
 * amount alone matches half a statement.
 */
function premiumFor(payment: RecurringPayment, policies: Policy[]): Policy | null {
  const text = `${payment.label} ${payment.key}`.toLowerCase();
  const found = policies.filter((policy) => {
    if (policy.premium == null || !(policy.premium > 0)) return false;
    const words = distinctiveWords(policy.insurer, policy.name);
    if (words.length === 0) return false;
    if (!words.some((word) => text.includes(word))) return false;
    // Against the charge as billed, not a monthly restatement: an annual
    // premium arrives once as the whole year's figure, and the payment's own
    // cadence is what the detector already measured.
    return Math.abs(payment.amount - policy.premium) / policy.premium <= AMOUNT_TOLERANCE;
  });

  // Two policies fitting one payment is not an answer. Somebody holding two
  // policies with one insurer at a similar premium is ordinary, and picking
  // one would put a name on the row that may be the wrong one — see
  // `nameUnnamedRows` for the same refusal.
  return found.length === 1 ? found[0] : null;
}

export function classifyCommitments(
  payments: RecurringPayment[],
  { policies = [], categories = [] }: { policies?: Policy[]; categories?: Category[] } = {}
): Commitment[] {
  return payments.map((payment) => {
    const policy = premiumFor(payment, policies);
    if (policy) return { payment, kind: "insurance" as const, because: policy.name };

    const category = filedUnder(payment, categories);
    if (category && INSURANCE_CATEGORY.test(category.name)) {
      return { payment, kind: "insurance" as const, because: category.name };
    }

    return { payment, kind: "subscription" as const, because: null };
  });
}

/** The payments of one kind, in the order they were given. */
export function ofKind(commitments: Commitment[], kind: CommitmentKind): Commitment[] {
  return commitments.filter((commitment) => commitment.kind === kind);
}

/** What a set of commitments costs in an average month. */
export function monthlyTotal(commitments: Commitment[]): number {
  return commitments.reduce((sum, commitment) => sum + commitment.payment.monthly, 0);
}
