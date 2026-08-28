import { describe, expect, it } from "vitest";
import { countPremiumCharges, distinctiveTokens, matchPremiums, monthlyPremium, type PremiumPolicy } from "./policyPremiums.js";

const policy = (overrides: Partial<PremiumPolicy> = {}): PremiumPolicy => ({
  id: "p1",
  name: "Family cover",
  insurer: "Old Mutual Life Assurance",
  currency: "ZAR",
  premium: 812.4,
  premium_frequency: "monthly",
  ...overrides,
});

const charge = (amount: number, description: string) => ({ amount, description, counterparty: null });

describe("monthlyPremium", () => {
  it("leaves a monthly premium alone", () => {
    expect(monthlyPremium(policy())).toBe(812.4);
  });

  // So an annual policy and a monthly one can be added together — the same
  // restatement recurring.ts does for a yearly subscription.
  it("restates other cadences per month", () => {
    expect(monthlyPremium(policy({ premium: 12_000, premium_frequency: "annual" }))).toBe(1000);
    expect(monthlyPremium(policy({ premium: 3000, premium_frequency: "quarterly" }))).toBe(1000);
  });

  it("assumes monthly when the cadence is unknown", () => {
    expect(monthlyPremium(policy({ premium_frequency: null }))).toBe(812.4);
  });

  it("has nothing to say without a premium", () => {
    expect(monthlyPremium(policy({ premium: null }))).toBeNull();
    expect(monthlyPremium(policy({ premium: 0 }))).toBeNull();
  });
});

describe("distinctiveTokens", () => {
  it("keeps the part of a name that identifies it", () => {
    expect(distinctiveTokens("Old Mutual Life Assurance")).toEqual(["mutual"]);
  });

  // Matching on these would pair a policy with any debit that mentions them.
  it("drops words every insurer shares", () => {
    expect(distinctiveTokens("Life Insurance Cover Ltd")).toEqual([]);
  });

  it("pools several names", () => {
    expect(distinctiveTokens("Sanlam", "Discovery cover").sort()).toEqual(["discovery", "sanlam"]);
  });
});

describe("countPremiumCharges", () => {
  const charges = [
    charge(-812.4, "OM ASSURANCE DEBIT ORDER"),
    charge(-812.4, "OLD MUTUAL DEBIT ORDER"),
    charge(-830.15, "OLD MUTUAL DEBIT ORDER"),
  ];

  it("finds the premium where it was actually paid", () => {
    // Two of the three: the first line has no distinctive token in it.
    expect(countPremiumCharges(policy(), charges)).toBe(2);
  });

  // A premium escalates a little each year; that is still the same premium.
  it("allows a premium that has drifted", () => {
    expect(countPremiumCharges(policy({ premium: 830.15 }), charges)).toBe(2);
  });

  it("ignores a debit to the same insurer for a different amount", () => {
    expect(countPremiumCharges(policy({ premium: 250 }), charges)).toBe(0);
  });

  it("ignores the right amount paid to somebody else", () => {
    expect(countPremiumCharges(policy(), [charge(-812.4, "WOOLWORTHS"), charge(-812.4, "GYM")])).toBe(0);
  });

  // A payout from the insurer is not the premium being paid.
  it("ignores money coming the other way", () => {
    expect(countPremiumCharges(policy(), [charge(812.4, "OLD MUTUAL REFUND"), charge(812.4, "OLD MUTUAL REFUND")])).toBe(0);
  });

  it("has nothing to match on when the name is generic", () => {
    expect(countPremiumCharges(policy({ insurer: "Life Cover Ltd", name: "Policy" }), charges)).toBe(0);
  });
});

/**
 * The point of the whole service. `plan.ts` computes the surplus as income less
 * spending, and a premium already inside that spending must not be subtracted
 * again — the same double-count the file already avoids for debt minimums.
 */
describe("matchPremiums", () => {
  const paidFromATrackedAccount = [charge(-812.4, "OLD MUTUAL DEBIT ORDER"), charge(-812.4, "OLD MUTUAL DEBIT ORDER")];

  it("reports a premium found in the transactions as already spent", () => {
    const [match] = matchPremiums([policy()], paidFromATrackedAccount);
    expect(match.alreadyInSpending).toBe(true);
    expect(match.monthly).toBe(812.4);
  });

  it("reports a premium nowhere in the transactions as unaccounted for", () => {
    const [match] = matchPremiums([policy()], [charge(-59.99, "NETFLIX")]);
    expect(match.alreadyInSpending).toBe(false);
    expect(match.matches).toBe(0);
  });

  // One charge is a coincidence of amount and wording; two is an arrangement.
  it("does not call a single charge a standing arrangement", () => {
    const [match] = matchPremiums([policy()], [charge(-812.4, "OLD MUTUAL DEBIT ORDER")]);
    expect(match.alreadyInSpending).toBe(false);
  });

  it("skips a policy with no premium recorded", () => {
    expect(matchPremiums([policy({ premium: null })], paidFromATrackedAccount)).toEqual([]);
  });
});
