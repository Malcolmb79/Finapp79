import { describe, expect, it } from "vitest";
import { annotateRepayments, repaidAccountId, type TransactionRule } from "./transactionRules.js";

const LOAN = "loan-anpost";
const AIB = "acct-aib";
const BARCLAYS = "acct-barclays";

const rule = (over: Partial<TransactionRule> = {}): TransactionRule => ({
  id: "r1",
  match_text: "AN POST",
  match_account_id: AIB,
  repays_account_id: LOAN,
  ...over,
});

const tx = (over: Partial<Parameters<typeof repaidAccountId>[0]> = {}) => ({
  account_id: AIB,
  amount: -383.87,
  description: "DIRECT DEBIT AN POST MONEY",
  counterparty: null,
  ...over,
});

/**
 * These decide whether a payment reduces what is owed, so the failures that
 * matter are a payment silently not counting — the loan then sits frozen at a
 * figure that was true a year ago — and something counting that shouldn't,
 * which pays a debt off with money that never went near it.
 */
describe("repaidAccountId", () => {
  it("attributes a payment matching the rule", () => {
    expect(repaidAccountId(tx(), [rule()])).toBe(LOAN);
  });

  it("ignores case, as a bank statement's shouting is not a distinction", () => {
    expect(repaidAccountId(tx({ description: "direct debit an post money" }), [rule()])).toBe(LOAN);
  });

  it("matches on the counterparty as well as the description", () => {
    expect(repaidAccountId(tx({ description: "DD", counterparty: "An Post Money" }), [rule()])).toBe(LOAN);
  });

  // The sterling/euro split: the same lender's name on the wrong account is a
  // different loan, or not a loan at all.
  it("does not match on an account the rule doesn't name", () => {
    expect(repaidAccountId(tx({ account_id: BARCLAYS }), [rule()])).toBeNull();
  });

  it("matches any account when the rule names none", () => {
    expect(repaidAccountId(tx({ account_id: BARCLAYS }), [rule({ match_account_id: null })])).toBe(LOAN);
  });

  // A refund or a credit carries the same words. Counting it would increase
  // what is owed, which is the opposite of what happened.
  it("never attributes money coming in", () => {
    expect(repaidAccountId(tx({ amount: 383.87 }), [rule()])).toBeNull();
    expect(repaidAccountId(tx({ amount: 0 }), [rule()])).toBeNull();
  });

  // Otherwise the payment is counted where it is and mirrored onto the same
  // account, paying the loan twice over.
  it("never attributes a transaction already on the loan", () => {
    expect(repaidAccountId(tx({ account_id: LOAN }), [rule({ match_account_id: null })])).toBeNull();
  });

  it("ignores a rule with nothing to match on", () => {
    expect(repaidAccountId(tx(), [rule({ match_text: "   " })])).toBeNull();
  });

  it("takes the first rule that matches, so a narrow one can sit above a broad one", () => {
    const specific = rule({ id: "r0", match_text: "AN POST MONEY", repays_account_id: "loan-specific" });
    expect(repaidAccountId(tx(), [specific, rule()])).toBe("loan-specific");
  });

  it("says nothing when no rule matches", () => {
    expect(repaidAccountId(tx({ description: "TESCO" }), [rule()])).toBeNull();
    expect(repaidAccountId(tx(), [])).toBeNull();
  });

  it("copes with a transaction carrying no text at all", () => {
    expect(repaidAccountId(tx({ description: null, counterparty: null }), [rule()])).toBeNull();
  });
});

describe("annotateRepayments", () => {
  it("marks each transaction, leaving the originals otherwise intact", () => {
    const rows = [tx(), tx({ description: "TESCO" })];
    const annotated = annotateRepayments(rows, [rule()]);
    expect(annotated.map((r) => r.repays_account_id)).toEqual([LOAN, null]);
    expect(annotated[0].amount).toBe(-383.87);
  });

  it("marks everything null when there are no rules", () => {
    expect(annotateRepayments([tx()], []).map((r) => r.repays_account_id)).toEqual([null]);
  });
});
