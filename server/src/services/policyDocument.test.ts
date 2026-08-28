import { describe, expect, it } from "vitest";
import { dropConfusedSurrender } from "./policyDocument.js";

/**
 * The grounding machinery itself — quoteAppearsIn, verifyNumber, verifyDate,
 * chunk, collectKeyTerms — is shared with the loan contract reader and covered
 * by loanContract.test.ts. What is specific to a policy, and what these guard,
 * is the one confusion that would matter most: a cover amount reported as a
 * surrender value.
 *
 * That mistake passes every other check. The number is real, the sentence is
 * real, the sentence contains the number, and it is well inside the plausible
 * range for a policy. Only the fact that it rests on the cover amount's own
 * evidence gives it away — and the cost of missing it is the entire sum
 * assured landing in net worth as if it were money in an account.
 */
describe("dropConfusedSurrender", () => {
  const cover = { value: 2_000_000, quote: "Your life cover is R2 000 000." };

  it("keeps a surrender value with its own evidence", () => {
    const surrender = { value: 48_213.09, quote: "The fund value at 30 June 2026 is R48 213.09." };
    expect(dropConfusedSurrender(cover, surrender)).toEqual(surrender);
  });

  // The whole point. A term policy states cover and nothing else; a surrender
  // value quoting that same sentence is the cover wearing another name.
  it("drops a surrender value quoting the cover amount's sentence", () => {
    expect(dropConfusedSurrender(cover, { value: 2_000_000, quote: cover.quote })).toBeNull();
  });

  it("drops a surrender value equal to the cover, whatever it quotes", () => {
    // Different sentence, same figure — no real statement reports a policy
    // worth exactly its own death benefit if cashed in today.
    expect(
      dropConfusedSurrender(cover, { value: 2_000_000, quote: "The total benefit under this policy is R2 000 000." })
    ).toBeNull();
  });

  it("ignores incidental whitespace when comparing the evidence", () => {
    expect(dropConfusedSurrender(cover, { value: 1234, quote: `  ${cover.quote}  ` })).toBeNull();
  });

  it("leaves a surrender value alone when no cover amount was found", () => {
    const surrender = { value: 48_213.09, quote: "The fund value at 30 June 2026 is R48 213.09." };
    expect(dropConfusedSurrender(null, surrender)).toEqual(surrender);
  });

  it("passes a missing surrender value straight through", () => {
    expect(dropConfusedSurrender(cover, null)).toBeNull();
  });

  // Zero is a real answer, not a missing one: a policy that has not built a
  // value yet says so, and that is worth recording rather than discarding.
  it("keeps a surrender value of zero", () => {
    const surrender = { value: 0, quote: "This policy has no surrender value." };
    expect(dropConfusedSurrender(cover, surrender)).toEqual(surrender);
  });
});
