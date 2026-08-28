import { describe, expect, it } from "vitest";
import type { Policy } from "../api/client.js";
import { canCount, countsAtCover, policyContribution, policyContributions, policyContributionsAt, valuationAsAt } from "./policyValue.js";

/**
 * A policy statement puts the cover amount and the surrender value side by
 * side, and only one of them is money held. Counting a term policy's cover as
 * wealth would add the whole sum assured to net worth — and a net worth that is
 * wrong looks exactly like one that is right, which is why which figure counts
 * is recorded per policy rather than guessed at.
 */
const policy = (overrides: Partial<Policy> = {}): Policy => ({
  id: "p1",
  name: "Family cover",
  insurer: "Old Mutual",
  policy_number: null,
  currency: "ZAR",
  cover_amount: 2_000_000,
  surrender_value: 48_213.09,
  valued_at: "2026-06-30",
  premium: 812.4,
  premium_frequency: "monthly",
  start_date: null,
  maturity_date: null,
  net_worth_source: "none",
  extract_json: null,
  created_at: "2026-07-01",
  valuations: [{ policy_id: "p1", valued_at: "2026-06-30", cover_amount: 2_000_000, surrender_value: 48_213.09 }],
  ...overrides,
});

describe("policyContribution", () => {
  // The default, and the important one: a policy sits outside every total
  // until it is explicitly asked in.
  it("contributes nothing until asked", () => {
    expect(policyContribution(policy())).toBe(0);
  });

  it("contributes the surrender value when that is what was chosen", () => {
    expect(policyContribution(policy({ net_worth_source: "surrender" }))).toBe(48_213.09);
  });

  it("contributes the cover amount when that is what was chosen", () => {
    expect(policyContribution(policy({ net_worth_source: "cover" }))).toBe(2_000_000);
  });

  // A term policy: real cover, no cash value. Choosing the surrender value
  // must not quietly fall through to the cover amount.
  it("contributes nothing when the chosen figure is missing", () => {
    expect(policyContribution(policy({ net_worth_source: "surrender", surrender_value: null }))).toBe(0);
  });
});

describe("countsAtCover", () => {
  it("is true only when the cover amount is the figure being counted", () => {
    expect(countsAtCover(policy({ net_worth_source: "cover" }))).toBe(true);
    expect(countsAtCover(policy({ net_worth_source: "surrender" }))).toBe(false);
    expect(countsAtCover(policy())).toBe(false);
  });
});

describe("canCount", () => {
  it("needs at least one figure to count", () => {
    expect(canCount(policy())).toBe(true);
    expect(canCount(policy({ surrender_value: null }))).toBe(true);
    expect(canCount(policy({ surrender_value: null, cover_amount: null }))).toBe(false);
  });
});

describe("policyContributions", () => {
  it("keeps each policy in its own currency", () => {
    const entries = policyContributions([
      policy({ net_worth_source: "surrender" }),
      policy({ id: "p2", currency: "GBP", surrender_value: 1200, net_worth_source: "surrender" }),
    ]);
    expect(entries).toEqual([
      { amount: 48_213.09, currency: "ZAR" },
      { amount: 1200, currency: "GBP" },
    ]);
  });

  it("leaves out policies that contribute nothing", () => {
    expect(policyContributions([policy(), policy({ id: "p2", net_worth_source: "surrender", surrender_value: null })])).toEqual([]);
  });
});

describe("valuationAsAt", () => {
  const withHistory = policy({
    valuations: [
      { policy_id: "p1", valued_at: "2025-06-30", cover_amount: 2_000_000, surrender_value: 31_000 },
      { policy_id: "p1", valued_at: "2026-06-30", cover_amount: 2_000_000, surrender_value: 48_213.09 },
    ],
  });

  it("takes the latest statement on or before the date", () => {
    expect(valuationAsAt(withHistory, "2026-01-15")?.surrender_value).toBe(31_000);
    expect(valuationAsAt(withHistory, "2026-12-31")?.surrender_value).toBe(48_213.09);
  });

  it("knows nothing before the first statement", () => {
    expect(valuationAsAt(withHistory, "2025-01-01")).toBeNull();
  });
});

/**
 * The trend is anchored to today's net worth and walked backwards, so anything
 * folded into today's figure is implicitly assumed to have been held all along.
 * For a policy that would be an invention — hence the date test.
 */
describe("policyContributionsAt", () => {
  const withHistory = policy({
    net_worth_source: "surrender",
    valuations: [
      { policy_id: "p1", valued_at: "2025-06-30", cover_amount: 2_000_000, surrender_value: 31_000 },
      { policy_id: "p1", valued_at: "2026-06-30", cover_amount: 2_000_000, surrender_value: 48_213.09 },
    ],
  });

  it("contributes nothing before the policy was ever recorded", () => {
    expect(policyContributionsAt([withHistory], "2025-01-01")).toEqual([]);
  });

  it("uses the figure from the statement in effect at the time", () => {
    expect(policyContributionsAt([withHistory], "2026-01-15")).toEqual([{ amount: 31_000, currency: "ZAR" }]);
    expect(policyContributionsAt([withHistory], "2026-08-15")).toEqual([{ amount: 48_213.09, currency: "ZAR" }]);
  });

  it("reads the cover amount from the same history when that is what counts", () => {
    expect(policyContributionsAt([{ ...withHistory, net_worth_source: "cover" }], "2026-01-15")).toEqual([
      { amount: 2_000_000, currency: "ZAR" },
    ]);
  });

  it("stays out of the line entirely when the policy is not counted", () => {
    expect(policyContributionsAt([{ ...withHistory, net_worth_source: "none" }], "2026-08-15")).toEqual([]);
  });
});
