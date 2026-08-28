/**
 * Whether a policy's premium is already inside the month's outgoings.
 *
 * `plan.ts` works the surplus out as income less spending, and its central
 * caveat is that debt minimums are *inside* that spending where they were
 * actually paid — subtracting them again would count them twice. A policy
 * premium has exactly the same property, and this is what stops the same
 * mistake being made with it.
 *
 * A premium debited from an account this app tracks is already in the
 * transactions, so it needs no help: naming it as a commitment and taking it
 * off the surplus would charge it twice and quietly understate what is spare.
 *
 * A premium that is nowhere in the transactions is the interesting case — a
 * debit order from an account that isn't linked, or one paid by someone else
 * on your behalf. That one is a real monthly commitment the spending figures
 * cannot see, so it belongs in the plan.
 *
 * The two cases are reported separately rather than merged into a total, so
 * the plan can say which premiums it counted and which it left alone. A figure
 * nobody can account for is one nobody can check.
 */

export interface PremiumPolicy {
  id: string;
  name: string;
  insurer: string | null;
  currency: string;
  premium: number | null;
  premium_frequency: string | null;
}

export interface Chargeable {
  amount: number;
  description: string | null;
  counterparty: string | null;
}

export interface PremiumMatch {
  policyId: string;
  name: string;
  currency: string;
  /** The premium restated per month, whatever its billing cadence. */
  monthly: number;
  /** True when charges matching it are already in the transaction history. */
  alreadyInSpending: boolean;
  /** How many charges were found. Zero when nothing matched. */
  matches: number;
}

const PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, annual: 1 };

/**
 * The premium restated per month.
 *
 * An annual premium is a monthly commitment of a twelfth, in the same way
 * `recurring.ts` annualises a yearly subscription so it can be added to a
 * monthly one. A policy with no stated cadence is assumed monthly, which is
 * what almost every life policy is billed at.
 */
export function monthlyPremium(policy: PremiumPolicy): number | null {
  if (policy.premium == null || !Number.isFinite(policy.premium) || policy.premium <= 0) return null;
  const perYear = PER_YEAR[policy.premium_frequency ?? "monthly"] ?? 12;
  return (policy.premium * perYear) / 12;
}

// Words that appear in every insurer's name and identify none of them. Matching
// on "life" alone would pair a policy with any transaction mentioning it.
const GENERIC = new Set([
  "life", "insurance", "assurance", "policy", "cover", "limited", "ltd", "plc",
  "group", "holdings", "financial", "services", "the", "and", "premium", "plan",
]);

/**
 * The words in a name that could identify it in a bank description.
 *
 * Short and generic words are dropped: what is left of "Old Mutual Life
 * Assurance" is "mutual", which is the part that actually turns up on a
 * statement line.
 */
export function distinctiveTokens(...names: (string | null)[]): string[] {
  const tokens = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    for (const word of name.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)) {
      if (word.length >= 4 && !GENERIC.has(word)) tokens.add(word);
    }
  }
  return [...tokens];
}

// A premium moves — annual escalation, a rate review — but not by much. The
// same tolerance the subscription detector uses for the same reason.
const AMOUNT_TOLERANCE = 0.2;

// One charge could be a coincidence of amount and wording. Two is the fewest
// that suggests a standing arrangement rather than a single payment that
// happened to look like one.
const MIN_MATCHES = 2;

/**
 * How many transactions look like this policy's premium being paid.
 *
 * Both tests have to pass: the name has to appear in the description, and the
 * amount has to be close to the premium. Either alone is far too loose — an
 * insurer that also sells you car cover appears in plenty of unrelated debits,
 * and a round monthly figure matches half a statement.
 */
export function countPremiumCharges(policy: PremiumPolicy, transactions: Chargeable[]): number {
  const monthly = monthlyPremium(policy);
  if (monthly == null) return 0;

  const tokens = distinctiveTokens(policy.insurer, policy.name);
  if (tokens.length === 0) return 0;

  let matches = 0;
  for (const tx of transactions) {
    // Money out only — a payout or a refund from the same insurer is not the
    // premium being paid.
    if (tx.amount >= 0) continue;

    const text = `${tx.description ?? ""} ${tx.counterparty ?? ""}`.toLowerCase();
    if (!tokens.some((token) => text.includes(token))) continue;

    // Against the charge as billed, not the monthly restatement: an annual
    // premium arrives once as the whole year's figure.
    const billed = policy.premium ?? 0;
    if (Math.abs(Math.abs(tx.amount) - billed) / billed > AMOUNT_TOLERANCE) continue;

    matches++;
  }
  return matches;
}

export function matchPremiums(policies: PremiumPolicy[], transactions: Chargeable[]): PremiumMatch[] {
  const found: PremiumMatch[] = [];

  for (const policy of policies) {
    const monthly = monthlyPremium(policy);
    if (monthly == null) continue;

    const matches = countPremiumCharges(policy, transactions);
    found.push({
      policyId: policy.id,
      name: policy.name,
      currency: policy.currency,
      monthly: Math.round(monthly * 100) / 100,
      alreadyInSpending: matches >= MIN_MATCHES,
      matches,
    });
  }

  return found;
}
