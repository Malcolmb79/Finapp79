import type { Policy } from "../api/client.js";

/**
 * What a life policy contributes to the overall view.
 *
 * A policy statement carries two figures that sit side by side and mean
 * opposite things:
 *
 *   The **cover amount** (sum assured) is paid out on death. It is not money
 *   held now, and a term policy quoting two million in cover is not two million
 *   of wealth.
 *
 *   The **surrender value** (cash value, fund value) is what the policy is
 *   worth if cashed in today. That one behaves like an asset, and it is what a
 *   policy normally contributes.
 *
 * Which of the two counts is recorded per policy rather than inferred, and
 * defaults to neither. There is no safe figure to guess with: a policy silently
 * counted at its cover amount would inflate net worth by the whole sum assured,
 * and — as with a balance handed the wrong period — a wrong net worth reads
 * exactly like a right one. So the decision is the user's, and `countsAtCover`
 * exists so the screens can keep saying which decision was made rather than
 * letting it disappear into a total.
 */

export function policyContribution(policy: Policy): number {
  switch (policy.net_worth_source) {
    case "surrender":
      return policy.surrender_value ?? 0;
    case "cover":
      return policy.cover_amount ?? 0;
    default:
      return 0;
  }
}

/**
 * Whether this policy is being counted at its cover amount.
 *
 * Not a warning about a mistake — the choice is deliberate and honoured. It is
 * what lets the caution travel with the figure, so the reason net worth is
 * larger than the accounts stays visible wherever the total appears.
 */
export function countsAtCover(policy: Policy): boolean {
  return policy.net_worth_source === "cover" && policy.cover_amount != null;
}

/** Whether a policy has any figure that could be counted at all. */
export function canCount(policy: Policy): boolean {
  return policy.surrender_value != null || policy.cover_amount != null;
}

/**
 * The policies' contributions as amounts in their own currencies, ready for
 * `sumInBase`.
 *
 * Kept in their own currencies rather than pre-added: a rand policy and a euro
 * account are not the same unit, and totalling them raw produces a figure in no
 * currency at all — the same reasoning the account balances already follow.
 */
export function policyContributions(policies: Policy[]): { amount: number; currency: string }[] {
  return policies
    .filter((policy) => policy.net_worth_source !== "none")
    .map((policy) => ({ amount: policyContribution(policy), currency: policy.currency }))
    .filter((entry) => entry.amount !== 0);
}

/**
 * The statement in effect on a given date — the latest one on or before it.
 *
 * Returns null before the first statement, which is the whole point: the app
 * knows nothing about the policy before then, and should say so by leaving it
 * out rather than by projecting today's figure backwards.
 */
export function valuationAsAt(policy: Policy, date: string): { cover_amount: number | null; surrender_value: number | null } | null {
  let latest: Policy["valuations"][number] | null = null;
  for (const valuation of policy.valuations) {
    if (valuation.valued_at > date) continue;
    if (!latest || valuation.valued_at > latest.valued_at) latest = valuation;
  }
  return latest;
}

/**
 * What the policies contributed as at a given date, for the net worth trend.
 *
 * The trend is built by walking transactions backwards from today's figure, so
 * anything folded into today's total is implicitly assumed to have been there
 * all along. For an account that is true — its history is the transactions
 * being walked. For a policy it is not: a policy added today would silently
 * raise last year's net worth by the same amount, showing wealth there was
 * never any record of holding.
 *
 * So each policy contributes the figure from the statement in effect at the
 * time, and nothing at all before its first one. That also makes the line show
 * a policy's value actually moving between statements, rather than sitting flat
 * at today's figure across months it was worth less.
 */
export function policyContributionsAt(policies: Policy[], date: string): { amount: number; currency: string }[] {
  return policies.flatMap((policy) => {
    if (policy.net_worth_source === "none") return [];
    const asAt = valuationAsAt(policy, date);
    if (!asAt) return [];
    const amount = (policy.net_worth_source === "cover" ? asAt.cover_amount : asAt.surrender_value) ?? 0;
    return amount === 0 ? [] : [{ amount, currency: policy.currency }];
  });
}
