import { describe, expect, it } from "vitest";
import type { Policy, PolicyFacts } from "../api/client.js";
import {
  benefitLabel,
  draftFromPolicy,
  draftProblem,
  emptyDraft,
  parseCurrency,
  parseMoney,
  toCreate,
  toPatch,
  toValuation,
  type PolicyBlocks,
} from "./policyDraft.js";

const ALL: PolicyBlocks = { identity: true, figures: true, term: true };
const DETAILS: PolicyBlocks = { identity: true, figures: false, term: true };
const FIGURES: PolicyBlocks = { identity: false, figures: true, term: false };

const policy: Policy = {
  id: "p1",
  name: "Life cover",
  insurer: "Example Mutual",
  policy_number: "LC-0001",
  currency: "ZAR",
  cover_amount: 2_000_000,
  surrender_value: 48_213.09,
  valued_at: "2026-06-30",
  premium: 1250,
  premium_frequency: "monthly",
  start_date: "2014-03-01",
  maturity_date: "2044-03-01",
  net_worth_source: "surrender",
  extract_json: null,
  created_at: "2026-07-01",
  valuations: [{ policy_id: "p1", valued_at: "2026-06-30", cover_amount: 2_000_000, surrender_value: 48_213.09 }],
};

describe("parseMoney", () => {
  it("reads a figure the way it appears on a statement", () => {
    expect(parseMoney("48213.09")).toEqual({ ok: true, value: 48_213.09 });
    expect(parseMoney("2,000,000")).toEqual({ ok: true, value: 2_000_000 });
    expect(parseMoney(" 1 250 ")).toEqual({ ok: true, value: 1250 });
    expect(parseMoney("R48213.09")).toEqual({ ok: true, value: 48_213.09 });
  });

  // Blank and zero are different claims. Blank is "no cash value, this is a
  // term policy"; zero is a figure somebody typed.
  it("treats an empty box as no figure rather than zero", () => {
    expect(parseMoney("")).toEqual({ ok: true, value: null });
    expect(parseMoney("   ")).toEqual({ ok: true, value: null });
    expect(parseMoney("0")).toEqual({ ok: true, value: 0 });
  });

  /**
   * The reason this returns a result rather than a number. A mistyped cover
   * amount that saved as blank would be indistinguishable from a term policy
   * with no cash value, and nothing on screen would say the entry was lost.
   */
  it("refuses something that is not a number instead of dropping it", () => {
    expect(parseMoney("about 50k")).toEqual({ ok: false });
    expect(parseMoney("12.34.56")).toEqual({ ok: false });
    expect(parseMoney("-100")).toEqual({ ok: false });
  });
});

describe("parseCurrency", () => {
  it("accepts a three-letter code in any case", () => {
    expect(parseCurrency("eur")).toBe("EUR");
    expect(parseCurrency(" zar ")).toBe("ZAR");
  });

  it("rejects anything else", () => {
    expect(parseCurrency("EURO")).toBeNull();
    expect(parseCurrency("E")).toBeNull();
    expect(parseCurrency("")).toBeNull();
  });
});

describe("draftProblem", () => {
  it("passes an empty policy with just a name", () => {
    expect(draftProblem({ ...emptyDraft(), name: "Life cover" }, ALL)).toBeNull();
  });

  it("insists on a name and a real currency", () => {
    expect(draftProblem(emptyDraft(), ALL)).toBe("Give the policy a name.");
    expect(draftProblem({ ...emptyDraft(), name: "X", currency: "EURO" }, ALL)).toContain("three-letter code");
  });

  it("catches a figure that is not a number", () => {
    expect(draftProblem({ ...emptyDraft(), name: "X", coverAmount: "lots" }, ALL)).toContain("cover amount");
    expect(draftProblem({ ...emptyDraft(), name: "X", surrenderValue: "?" }, ALL)).toContain("surrender value");
  });

  // A premium with no frequency cannot be turned into a monthly cost, so the
  // plan would silently ignore it.
  it("will not take a premium without knowing how often it is paid", () => {
    expect(draftProblem({ ...emptyDraft(), name: "X", premium: "1250" }, ALL)).toContain("how often");
    expect(
      draftProblem({ ...emptyDraft(), name: "X", premium: "1250", premiumFrequency: "monthly" }, ALL)
    ).toBeNull();
  });

  it("notices a policy that matures before it starts", () => {
    const draft = { ...emptyDraft(), name: "X", startDate: "2030-01-01", maturityDate: "2020-01-01" };
    expect(draftProblem(draft, ALL)).toContain("before the start date");
  });

  /**
   * Each screen is only answerable for what it asks. The edit screen doesn't
   * collect the figures, so a figure left behind in the draft must not be able
   * to block a name change.
   */
  it("only complains about the blocks a screen is showing", () => {
    const bad = { ...emptyDraft(), name: "X", coverAmount: "nonsense" };
    expect(draftProblem(bad, ALL)).not.toBeNull();
    expect(draftProblem(bad, DETAILS)).toBeNull();

    const noName = { ...emptyDraft(), name: "", coverAmount: "100" };
    expect(draftProblem(noName, ALL)).not.toBeNull();
    expect(draftProblem(noName, FIGURES)).toBeNull();
  });
});

describe("toCreate", () => {
  it("sends every detail, and null for what was left blank", () => {
    const draft = {
      ...emptyDraft("ZAR"),
      name: "Life cover",
      insurer: "Example Mutual",
      policyNumber: "LC-0001",
      coverAmount: "2,000,000",
      surrenderValue: "",
      valuedAt: "2026-06-30",
      premium: "1250",
      premiumFrequency: "monthly" as const,
      startDate: "2014-03-01",
      maturityDate: "2044-03-01",
    };

    expect(toCreate(draft)).toEqual({
      name: "Life cover",
      insurer: "Example Mutual",
      policy_number: "LC-0001",
      currency: "ZAR",
      cover_amount: 2_000_000,
      // Blank stays blank: a term policy has no surrender value, and a zero
      // here would claim it is worth exactly nothing if cashed in.
      surrender_value: null,
      valued_at: "2026-06-30",
      premium: 1250,
      premium_frequency: "monthly",
      start_date: "2014-03-01",
      maturity_date: "2044-03-01",
      net_worth_source: "none",
    });
  });

  // A policy is in no total until it is explicitly asked in.
  it("leaves a new policy out of net worth", () => {
    expect(toCreate({ ...emptyDraft(), name: "X" }).net_worth_source).toBe("none");
  });

  // The extraction is stored only when there was one. A hand-typed policy has
  // no quotes to keep, and an empty extract would imply it had been read.
  it("carries the extraction only when a document was read", () => {
    expect("extract" in toCreate({ ...emptyDraft(), name: "X" })).toBe(false);
    expect(toCreate({ ...emptyDraft(), name: "X" }, { insurer: "Example" })).toHaveProperty("extract");
  });
});

describe("toPatch", () => {
  /**
   * The rule the whole three-mode split exists for. The card's headline reads
   * the policy's own columns; the net worth trend reads the valuation history.
   * Patching a figure would move one and not the other.
   */
  it("never sends the two figures", () => {
    const patch = toPatch(draftFromPolicy(policy));
    expect(patch).not.toHaveProperty("cover_amount");
    expect(patch).not.toHaveProperty("surrender_value");
    expect(patch).not.toHaveProperty("valued_at");
  });

  it("sends the details it is responsible for", () => {
    expect(toPatch(draftFromPolicy(policy))).toEqual({
      name: "Life cover",
      insurer: "Example Mutual",
      policy_number: "LC-0001",
      currency: "ZAR",
      premium: 1250,
      premium_frequency: "monthly",
      start_date: "2014-03-01",
      maturity_date: "2044-03-01",
    });
  });

  // Patching net_worth_source from here would fight the card's own control.
  it("leaves the net worth choice to the card", () => {
    expect(toPatch(draftFromPolicy(policy))).not.toHaveProperty("net_worth_source");
  });
});

describe("toValuation", () => {
  it("sends the figures with the date they were true on", () => {
    const draft = { ...draftFromPolicy(policy), surrenderValue: "51,002.44", valuedAt: "2026-12-31" };
    expect(toValuation(draft)).toEqual({
      valued_at: "2026-12-31",
      cover_amount: 2_000_000,
      surrender_value: 51_002.44,
      premium: 1250,
      premium_frequency: "monthly",
    });
  });
});

describe("draftFromPolicy", () => {
  it("round-trips a policy through the form without changing it", () => {
    const draft = draftFromPolicy(policy);
    expect(toCreate(draft)).toMatchObject({
      name: policy.name,
      insurer: policy.insurer,
      policy_number: policy.policy_number,
      currency: policy.currency,
      cover_amount: policy.cover_amount,
      surrender_value: policy.surrender_value,
      valued_at: policy.valued_at,
      premium: policy.premium,
      premium_frequency: policy.premium_frequency,
      start_date: policy.start_date,
      maturity_date: policy.maturity_date,
      net_worth_source: policy.net_worth_source,
    });
  });

  it("shows empty boxes rather than the word null", () => {
    const sparse: Policy = {
      ...policy,
      insurer: null,
      policy_number: null,
      cover_amount: null,
      surrender_value: null,
      premium: null,
      premium_frequency: null,
      start_date: null,
      maturity_date: null,
    };
    const draft = draftFromPolicy(sparse);
    expect(draft.insurer).toBe("");
    expect(draft.coverAmount).toBe("");
    expect(draft.premium).toBe("");
    expect(draft.premiumFrequency).toBe("");
    expect(draft.startDate).toBe("");
  });
});

/**
 * A document often yields several policies, and they land as several cards.
 * Naming them all after the insurer would leave the owner guessing which is
 * which — the number is what the insurer, the broker and the statement all use
 * to mean one policy, so it is what the card says.
 */
describe("benefitLabel", () => {
  const facts = (over: Partial<PolicyFacts>): PolicyFacts => ({
    insurer: "Example Mutual",
    policyNumber: null,
    benefitName: null,
    currency: "ZAR",
    coverAmount: null,
    surrenderValue: null,
    premium: null,
    premiumFrequency: null,
    totalPremium: null,
    totalPremiumFrequency: null,
    siblings: 1,
    startDate: null,
    maturityDate: null,
    valuedAt: null,
    keyTerms: [],
    passes: 1,
    readFrom: "text",
    ...over,
  });

  it("uses the insurer alone when the document held one policy", () => {
    expect(benefitLabel(facts({ policyNumber: "0000001" }), 0)).toBe("Example Mutual");
  });

  it("names each by its policy number when there are several", () => {
    expect(benefitLabel(facts({ siblings: 3, policyNumber: "0000001/004" }), 1)).toBe("Example Mutual · 0000001/004");
  });

  // Two benefits can share one policy number, and then the number separates
  // nothing — the document's own benefit number is all there is.
  it("falls back to the benefit number when the policy number is shared", () => {
    const shared = facts({ siblings: 2, benefitName: "Death Benefit - Product/Benefit number 4" });
    expect(benefitLabel(shared, 1)).toBe("Example Mutual — benefit 4");
  });

  it("falls back to position when the document named nothing", () => {
    expect(benefitLabel(facts({ siblings: 2 }), 1)).toBe("Example Mutual — 2");
  });
});
