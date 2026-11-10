import { describe, expect, it } from "vitest";
import { assemble } from "./policyDocument.js";

/**
 * One document, more than one policy.
 *
 * A life schedule routinely carries a death benefit for each life assured, and
 * reading such a document into a single set of fields produced something that
 * was neither of them: the cover amount of the first benefit beside the
 * premium of both. Nothing on screen looked wrong, which is what made it worth
 * fixing — a dropped policy is visible, a merged one is not.
 *
 * The figures below are invented. The arrangement is what was real: two
 * benefits sharing one policy number, told apart only by a benefit number, and
 * a premium stated once as a combined total.
 */

const quoted = (value: number, quote: string) => ({ value, quote });

/** Read as a scan, so quotes stand on their own rather than being matched. */
const read = (passes: Record<string, unknown>[]) => assemble(passes, null, 1);

const benefit = (n: number, cover: number, premium: number | null) => ({
  policy_number: "0000001",
  benefit_name: `Death Benefit - Product/Benefit number ${n}`,
  cover_amount: quoted(cover, `How much you are covered for ${cover}`),
  surrender_value: null,
  premium: premium == null ? null : quoted(premium, `Premium for this benefit ${premium}`),
  premium_frequency: "monthly",
  start_date: null,
  maturity_date: null,
  valued_at: null,
});

describe("a document describing several policies", () => {
  const document = {
    insurer: "Example Mutual",
    currency: "ZAR",
    policies: [benefit(1, 500000, 400), benefit(4, 250000, 600)],
    total_premium: quoted(1030, "Total premium 1030"),
    total_premium_frequency: "monthly",
    key_terms: [],
  };

  it("returns one policy per benefit rather than merging them", () => {
    const policies = read([document]);
    expect(policies).toHaveLength(2);
    expect(policies!.map((p) => p.coverAmount?.value)).toEqual([500000, 250000]);
    expect(policies!.map((p) => p.premium?.value)).toEqual([400, 600]);
  });

  /**
   * The failure this was written for. Taking the first cover amount and the
   * total premium produces a policy that exists nowhere in the document.
   */
  it("never pairs one benefit's cover with another's premium", () => {
    const policies = read([document])!;
    for (const policy of policies) {
      expect(policy.premium?.value).not.toBe(1030);
    }
  });

  // Both benefits carry the same policy number, so the number alone cannot
  // separate them — the benefit name is what does.
  it("keeps benefits apart when they share a policy number", () => {
    const policies = read([document])!;
    expect(new Set(policies.map((p) => p.policyNumber)).size).toBe(1);
    expect(new Set(policies.map((p) => p.benefitName)).size).toBe(2);
  });

  it("tells each policy how many came with it", () => {
    expect(read([document])!.every((p) => p.siblings === 2)).toBe(true);
  });

  // Shown, not divided: a combined premium may include fees charged on the
  // policy as a whole, so splitting it would invent a figure that then feeds
  // straight into the monthly plan.
  it("keeps a combined premium separate rather than dividing it", () => {
    const policies = read([document])!;
    expect(policies.every((p) => p.totalPremium?.value === 1030)).toBe(true);
  });

  it("copies the document's insurer and currency onto each", () => {
    const policies = read([document])!;
    expect(policies.every((p) => p.insurer === "Example Mutual" && p.currency === "ZAR")).toBe(true);
  });
});

describe("a document describing one policy", () => {
  const single = {
    insurer: "Example Mutual",
    currency: "EUR",
    policies: [benefit(1, 500000, null)],
    total_premium: quoted(420, "Total premium 420"),
    total_premium_frequency: "monthly",
    key_terms: [],
  };

  /**
   * With nothing to share it with, a "total" premium is simply that policy's
   * premium. Leaving it in the other field would have the screen caution about
   * a split that cannot arise.
   */
  it("treats a lone policy's total premium as its own", () => {
    const policies = read([single])!;
    expect(policies).toHaveLength(1);
    expect(policies[0].premium?.value).toBe(420);
    expect(policies[0].totalPremium).toBeNull();
    expect(policies[0].siblings).toBe(1);
  });
});

describe("a document read in several passes", () => {
  /**
   * A long document is read in overlapping sections, so the same benefit comes
   * back more than once. Concatenating would turn a two-benefit schedule read
   * in three passes into six policies.
   */
  it("merges a benefit seen in more than one pass", () => {
    const policies = read([
      { insurer: "Example Mutual", currency: "ZAR", policies: [benefit(1, 500000, 400)], total_premium: null, total_premium_frequency: null, key_terms: [] },
      { insurer: null, currency: null, policies: [benefit(1, 500000, 400), benefit(4, 250000, 600)], total_premium: null, total_premium_frequency: null, key_terms: [] },
    ])!;
    expect(policies).toHaveLength(2);
  });

  // A later section that names the benefit without restating a figure must not
  // blank one an earlier section gave.
  it("does not let a later mention erase an earlier figure", () => {
    const policies = read([
      { insurer: "Example Mutual", currency: "ZAR", policies: [benefit(1, 500000, 400)], total_premium: null, total_premium_frequency: null, key_terms: [] },
      {
        insurer: null,
        currency: null,
        policies: [{ ...benefit(1, 500000, null), cover_amount: null }],
        total_premium: null,
        total_premium_frequency: null,
        key_terms: [],
      },
    ])!;
    expect(policies).toHaveLength(1);
    expect(policies[0].coverAmount?.value).toBe(500000);
    expect(policies[0].premium?.value).toBe(400);
  });
});

describe("a document describing no policy at all", () => {
  it("reports nothing rather than an empty policy", () => {
    expect(read([{ insurer: "Example Mutual", currency: "EUR", policies: [], total_premium: null, total_premium_frequency: null, key_terms: [] }])).toBeNull();
    expect(read([])).toBeNull();
  });
});
