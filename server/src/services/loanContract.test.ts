import { describe, expect, it } from "vitest";
import { chunk, collectKeyTerms, quoteAppearsIn, verifyNumber, verifyDate } from "./loanContract.js";

/**
 * These guard the one place in the app where a model reads figures rather than
 * labels. The model's answer is only accepted when the sentence it quoted
 * actually contains the number it reported — so these tests are about what
 * happens when it doesn't.
 */
describe("verifyNumber", () => {
  const bounds = { min: 1, max: 10_000_000 };

  it("accepts a figure the quote supports", () => {
    expect(
      verifyNumber({ value: 4312.88, quote: "repayable in 60 instalments of R4,312.88 each" }, bounds)
    ).toEqual({ value: 4312.88, quote: "repayable in 60 instalments of R4,312.88 each" });
  });

  it("reads both decimal conventions", () => {
    // European contracts write 4.312,88 for the same amount.
    expect(verifyNumber({ value: 4312.88, quote: "Rate van 4.312,88 per maand" }, bounds)?.value).toBe(4312.88);
  });

  // The failure this whole design exists to catch: a plausible number that
  // isn't in the document.
  it("rejects a figure the quote does not contain", () => {
    expect(verifyNumber({ value: 4500, quote: "instalments of R4,312.88 each" }, bounds)).toBeNull();
  });

  it("rejects a near miss rather than rounding to it", () => {
    expect(verifyNumber({ value: 4312.9, quote: "instalments of R4,312.88" }, bounds)).toBeNull();
  });

  it("rejects figures outside plausible bounds", () => {
    expect(verifyNumber({ value: 400, quote: "interest at 400% per annum" }, { min: 0, max: 100 })).toBeNull();
  });

  it("rejects an answer with no quote at all", () => {
    expect(verifyNumber({ value: 4312.88, quote: "" }, bounds)).toBeNull();
    expect(verifyNumber(null, bounds)).toBeNull();
  });

  it("accepts a whole number written without decimals", () => {
    expect(verifyNumber({ value: 60, quote: "repayable over 60 months" }, { min: 1, max: 600 })?.value).toBe(60);
  });
});

describe("verifyDate", () => {
  it("accepts an ISO date with a quote", () => {
    expect(verifyDate({ value: "2026-03-01", quote: "commencing 1 March 2026" })).toEqual({
      value: "2026-03-01",
      quote: "commencing 1 March 2026",
    });
  });

  it("rejects anything not in ISO form", () => {
    for (const value of ["1 March 2026", "01/03/2026", "2026-3-1", "March 2026"]) {
      expect(verifyDate({ value, quote: "commencing 1 March 2026" }), value).toBeNull();
    }
  });

  it("rejects a year that can only be a misread", () => {
    expect(verifyDate({ value: "0202-03-01", quote: "commencing 1 March 2026" })).toBeNull();
    expect(verifyDate({ value: "2926-03-01", quote: "commencing 1 March 2026" })).toBeNull();
  });

  it("rejects a date that isn't real", () => {
    expect(verifyDate({ value: "2026-02-31", quote: "commencing 31 February 2026" })).toBeNull();
  });
});

/**
 * The check the rest of the design rests on. Verifying a figure against its
 * own quote only proves the answer is self-consistent — a made-up sentence
 * containing a made-up number passes that easily. Checking the quote against
 * the document is what closes it.
 */
describe("quoteAppearsIn", () => {
  const contract =
    "5. REPAYMENT\nThe Borrower shall repay the loan in 60 monthly instalments\nof R4,312.88 each, commencing on 1 March 2026.\n\n6. EARLY SETTLEMENT\nA penalty of three months' interest applies on early settlement.";

  it("finds a quote the document contains", () => {
    expect(quoteAppearsIn("60 monthly instalments of R4,312.88 each", contract)).toBe(true);
  });

  // PDF extraction breaks lines mid-sentence and pads columns arbitrarily.
  // None of that changes what the sentence says.
  it("sees through line breaks and spacing", () => {
    expect(quoteAppearsIn("repay the loan in 60 monthly instalments of R4,312.88 each", contract)).toBe(true);
    expect(quoteAppearsIn("The   Borrower\n\tshall repay the loan", contract)).toBe(true);
  });

  it("sees through typographic punctuation", () => {
    expect(quoteAppearsIn("A penalty of three months’ interest applies", contract)).toBe(true);
  });

  it("rejects a sentence that is not in the document", () => {
    expect(quoteAppearsIn("An arrangement fee of R1,500 is payable on origination.", contract)).toBe(false);
  });

  // The failure mode that matters: correct-sounding wording, altered figure.
  it("rejects a real sentence with the number changed", () => {
    expect(quoteAppearsIn("60 monthly instalments of R4,500.00 each", contract)).toBe(false);
  });

  it("rejects a fragment too short to be distinctive", () => {
    expect(quoteAppearsIn("R4,312.88", contract)).toBe(false);
  });
});

describe("collectKeyTerms", () => {
  const source = "A penalty of three months' interest applies on early settlement. Credit life insurance of R89.50 per month is compulsory.";

  it("keeps terms whose wording is in the document", () => {
    const terms = collectKeyTerms(
      [{ key_terms: [{ label: "Early settlement", detail: "Three months' interest", quote: "A penalty of three months' interest applies on early settlement." }] }],
      source
    );
    expect(terms).toHaveLength(1);
    expect(terms[0].label).toBe("Early settlement");
  });

  it("drops terms it cannot point at, however plausible", () => {
    const terms = collectKeyTerms(
      [{ key_terms: [{ label: "Arrangement fee", detail: "R1,500 on origination", quote: "An arrangement fee of R1,500 is payable." }] }],
      source
    );
    expect(terms).toEqual([]);
  });

  // Passes overlap so a clause near a boundary is read twice.
  it("keeps one copy of a clause seen in two passes", () => {
    const item = { label: "Credit life", detail: "R89.50 a month", quote: "Credit life insurance of R89.50 per month is compulsory." };
    expect(collectKeyTerms([{ key_terms: [item] }, { key_terms: [item] }], source)).toHaveLength(1);
  });

  it("survives a pass that returned nothing usable", () => {
    expect(collectKeyTerms([{}, { key_terms: null }, { key_terms: [{ label: "x" }] }], source)).toEqual([]);
  });
});

describe("chunk", () => {
  it("leaves a document that fits in one pass alone", () => {
    expect(chunk("short contract", 100, 10)).toEqual(["short contract"]);
  });

  it("covers the whole document", () => {
    const text = "x".repeat(1000);
    const parts = chunk(text, 300, 50);
    expect(parts.length).toBeGreaterThan(1);
    // Nothing is dropped off the end -- the last pass has to reach it.
    expect(parts[parts.length - 1].endsWith("x")).toBe(true);
    expect(parts.join("").length).toBeGreaterThanOrEqual(text.length);
  });

  // A clause straddling a boundary must survive intact in one pass, which is
  // the entire reason the passes overlap.
  it("repeats the text around each boundary", () => {
    const text = `${"a".repeat(290)}IMPORTANT CLAUSE HERE${"b".repeat(290)}`;
    const parts = chunk(text, 300, 60);
    expect(parts.some((p) => p.includes("IMPORTANT CLAUSE HERE"))).toBe(true);
  });
});
