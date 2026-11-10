import { describe, expect, it } from "vitest";
import { applyMapping, sectionSigns, type StatementMapping } from "./statementParser.js";

/**
 * A card statement prints every figure unsigned and says which way it runs in
 * the heading above it. Without reading those headings the month's payment
 * imports as spending — usually the largest row on the statement, landing with
 * the sign that makes the month look twice as bad as it was.
 *
 * The headings below are a card statement's own section wording. The
 * merchants and amounts are invented: a fixture goes into a repository and
 * somebody's actual spending has no business in one.
 */

const rows = [
  ["Your transactions", "", "", ""],
  ["Payments towards your account", "", "", "100.00"],
  ["", "27 Aug", "Payment, Thank You", "100.00"],
  ["Transactions, interest and charges", "", "", "75.00"],
  ["How you've used your card", "", "", "55.00"],
  ["", "30 Aug", "Example Shop, Anytown", "35.00"],
  ["", "09 Sep", "Sample Cafe, Anytown", "20.00"],
  ["Interest and charges", "", "", "20.00"],
  ["", "23 Sep", "Interest On Your Standard Balance", "20.00"],
];

const mapping: StatementMapping = {
  hasHeader: false,
  dateColumn: 1,
  defaultYear: 2026,
  signFromMarker: false,
  dateFormat: "dmy",
  amountColumn: 3,
  debitColumn: null,
  creditColumn: null,
  debitIsPositive: true,
  descriptionColumn: 2,
  counterpartyColumn: null,
  decimalSeparator: ".",
  invertAmounts: false,
  source: "heuristic",
  bankName: null,
  bankCountry: null,
  accountNumber: null,
  periodStart: null,
  periodEnd: null,
};

describe("sections that say which way the money went", () => {
  it("takes each row's direction from the heading above it", () => {
    expect(applyMapping(rows, mapping).map((r) => r.amount)).toEqual([100, -35, -20, -20]);
  });

  // "How you've used your card" sits inside the spending section. Treating an
  // unrecognised heading as a reset would send the rows under it back to the
  // default and silently flip them.
  it("keeps running through a sub-heading it does not recognise", () => {
    const parsed = applyMapping(rows, mapping);
    expect(parsed.find((r) => r.description?.startsWith("Example Shop"))?.amount).toBe(-35);
  });

  // One kind of heading alone means a document that merely contains the
  // words, not a statement laid out in sections.
  it("needs both kinds of heading before it trusts them", () => {
    expect(sectionSigns([["Payments towards your account", "", "", "1.00"]], 1)).toBeNull();
    expect(sectionSigns(rows, 1)).not.toBeNull();
  });

  // A statement that marks its own amounts has already said which way they
  // run, and a heading must not be allowed to overrule it.
  it("leaves a marked statement alone", () => {
    const marked = applyMapping(rows, { ...mapping, signFromMarker: true });
    expect(marked.map((r) => r.amount)).toEqual([-100, -35, -20, -20]);
  });

  // An ordinary statement with no sections must be untouched, or every
  // document that already imports correctly changes meaning.
  it("says nothing about a statement with no sections", () => {
    const plain = [
      ["", "01 Mar", "Example Shop", "10.00"],
      ["", "02 Mar", "Sample Cafe", "20.00"],
    ];
    expect(sectionSigns(plain, 1)).toBeNull();
  });
});
