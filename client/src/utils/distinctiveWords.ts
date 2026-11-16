/**
 * The parts of a name that could identify it on a bank statement.
 *
 * Two features need this and need it to behave identically: recognising which
 * loan a direct debit repays (`loanRepayments.ts`) and recognising which
 * policy a premium belongs to (`commitments.ts`). Both work the same way —
 * the owner named the thing, the bank wrote something on the payment, and the
 * overlap between the two is the evidence. The server's `policyPremiums.ts`
 * does the same job for the monthly plan.
 *
 * What makes it a reading rather than a guess is everything it refuses to
 * match on. The words below name the *kind* of thing, and every account or
 * policy of that kind carries some of them — matching on one would attach
 * "Personal loan" to the first lender's direct debit it saw, and "Life cover"
 * to anything with the word "life" in it. What is left of "Old Mutual Life
 * Assurance" is "mutual", which is the part that actually appears on a
 * statement line.
 */
const GENERIC = new Set([
  // What kind of arrangement it is.
  "loan",
  "loans",
  "card",
  "cards",
  "credit",
  "debit",
  "debt",
  "mortgage",
  "overdraft",
  "account",
  "current",
  "savings",
  "policy",
  "policies",
  "cover",
  "insurance",
  "assurance",
  "protection",
  "life",
  "term",
  "whole",
  "health",
  "income",
  // Who it is with, in words every provider uses.
  "personal",
  "finance",
  "financial",
  "services",
  "bank",
  "banking",
  "limited",
  "holdings",
  "group",
  "company",
  // How it is paid or described.
  "payment",
  "payments",
  "repayment",
  "repayments",
  "premium",
  "premiums",
  "direct",
  "monthly",
  "annual",
  "yearly",
  "plan",
  // Whose it is.
  "main",
  "joint",
  "mine",
  "ours",
]);

/**
 * Four letters is the floor.
 *
 * A shorter run turns up inside longer words by accident — "AIB" is three
 * letters and sits inside nothing, but a two-letter token finds everything,
 * and "Visa" would already find "visage". Three-letter insurers exist (VHI,
 * AXA) and are deliberately not recognised here: a false pairing writes a
 * rule against the wrong account, and the cost of missing one is that the
 * owner says so themselves.
 */
const MIN_LENGTH = 4;

export function distinctiveWords(...names: (string | null | undefined)[]): string[] {
  const words = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    for (const word of name.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length >= MIN_LENGTH && !GENERIC.has(word)) words.add(word);
    }
  }
  return [...words];
}
