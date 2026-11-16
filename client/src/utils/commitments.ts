import type { Category, Policy } from "../api/client.js";
import { distinctiveWords } from "./distinctiveWords.js";
import type { RecurringPayment } from "./recurring.js";

/**
 * What kind of standing commitment each regular payment actually is.
 *
 * The detector finds anything charged on a rhythm for a consistent amount,
 * which is the right net to cast and the wrong word to put on the result.
 * Calling all of it "subscriptions" was wrong three different ways at once,
 * and the third is what made it clear this needed a rule rather than a third
 * special case:
 *
 *   A **loan repayment** is not spending at all — it buys down a balance — so
 *   `subscriptions()` in `recurring.ts` keeps it out of the list entirely.
 *
 *   An **insurance premium** is spending, and is not something to stop paying
 *   for: cancelling Netflix costs you Netflix, cancelling cover costs you the
 *   cover.
 *
 *   **Broadband and a phone bill** are the same again, and that is where
 *   enumerating kinds stops being a plan. The next one is the gym, or the
 *   creche, or the bins. There is no end to the list, and every entry on it is
 *   this file deciding something about the household's own money that the
 *   household is better placed to decide.
 *
 * So there is no list. A payment's kind is **the category it is filed under**,
 * named in the owner's own words, and the card prints a section per kind with
 * its own total. "Utilities" appears because somebody typed "Utilities", not
 * because this file knows what a telecom company is. That generalises to the
 * gym and the creche and the bins for free, and it cannot be wrong about a
 * merchant it has never heard of, because it never looks at merchants.
 *
 * Which leaves one real gap: a payment nobody has filed yet. That is the
 * honest `Not filed yet` heading rather than a guess — and, because a heading
 * that only scolds is no use, the one place it is worth answering from is the
 * card itself. Filing from here writes the ordinary categorisation rule, so
 * the answer holds for every future charge as well as every past one.
 *
 * The single exception is a policy, and it earns itself: a premium matched to
 * a policy the owner holds is evidence from two independent places, the same
 * footing `loanRepayments.ts` and the server's `policyPremiums.ts` stand on.
 * It applies only where nothing has been filed, so it can never override a
 * decision somebody actually made.
 */

export interface Commitment {
  payment: RecurringPayment;
  /** The category it is filed under, or null for a policy reading or nothing. */
  categoryId: number | null;
  /** The heading it belongs under, in the owner's own words. */
  group: string;
  /** Set when the grouping was read rather than filed, so the card can say so. */
  readFrom: string | null;
}

/** The heading for a payment nobody has said anything about yet. */
export const UNFILED = "Not filed yet";

/**
 * A premium moves — annual escalation, a rate review — but not by much. The
 * same tolerance the detector groups charges by, for the same reason.
 */
const AMOUNT_TOLERANCE = 0.2;

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
    const category = filedUnder(payment, categories);
    if (category) return { payment, categoryId: category.id, group: category.name, readFrom: null };

    // Only where nothing was filed, so a reading can never overrule a
    // decision somebody actually made.
    const policy = premiumFor(payment, policies);
    if (policy) return { payment, categoryId: null, group: "Insurance", readFrom: policy.name };

    return { payment, categoryId: null, group: UNFILED, readFrom: null };
  });
}

export interface CommitmentGroup {
  name: string;
  commitments: Commitment[];
  /** What this kind costs in an average month. */
  monthly: number;
}

/**
 * The commitments gathered under their headings, dearest first.
 *
 * `Not filed yet` is pinned last whatever it costs. It is the only heading
 * that is a question rather than an answer, and a question at the top of a
 * card reads as the card's main finding.
 */
export function groupCommitments(commitments: Commitment[]): CommitmentGroup[] {
  const groups = new Map<string, Commitment[]>();
  for (const commitment of commitments) {
    groups.set(commitment.group, [...(groups.get(commitment.group) ?? []), commitment]);
  }

  return [...groups.entries()]
    .map(([name, list]) => ({
      name,
      commitments: list,
      monthly: list.reduce((sum, commitment) => sum + commitment.payment.monthly, 0),
    }))
    .sort((a, b) => {
      if (a.name === UNFILED) return 1;
      if (b.name === UNFILED) return -1;
      return b.monthly - a.monthly || a.name.localeCompare(b.name);
    });
}

/**
 * The word a standing rule can safely match this payment on.
 *
 * It has to appear in **every** charge's own text as the bank wrote it: a
 * token present in only some of them describes some other payment that merely
 * groups alongside, and a rule built on it would file things nobody looked at.
 * The longest qualifying word wins, because the longest is the most specific —
 * "talktalk" over "telecom", which is a word half a statement carries.
 *
 * Null when nothing qualifies, and the card then offers no filing rather than
 * a rule whose text was invented. `distinctiveWords` strikes out the words
 * naming a kind of arrangement for the same reason it does everywhere else.
 */
export function sharedToken(payment: RecurringPayment): string | null {
  if (payment.texts.length === 0) return null;

  const [first, ...rest] = payment.texts;
  const candidates = distinctiveWords(first)
    .filter((word) => rest.every((text) => text.toLowerCase().includes(word)))
    // A bare number is not a name, and a mandate reference differs every
    // month anyway — it only survives above when a payment has one charge.
    .filter((word) => /[a-z]{3}/.test(word))
    .sort((a, b) => b.length - a.length || a.localeCompare(b));

  return candidates[0] ?? null;
}
