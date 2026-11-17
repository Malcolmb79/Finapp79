import { describe, expect, it } from "vitest";
import { applyMapping, inferMapping, type StatementMapping } from "./statementParser.js";

/**
 * A Barclays current account, laid out the way the PDF extractor hands it
 * over: the date is printed once and that day's transactions are listed
 * beneath it, each continuation line of a card payment on a row of its own.
 *
 * Requiring a date on every row kept the first transaction of each day and
 * silently dropped the rest — fourteen rows out of forty on the real file.
 * Nothing looked wrong: every row that arrived was correct and the dialog
 * gave a confident count. The £535.84 that went missing was simply third in
 * its day.
 *
 * The merchants and amounts are invented; the shape is the file's.
 */
const rows = [
  ["Date", "Description", "Money out", "Money in", "Balance"],
  ["15 Oct", "Start balance", "", "", "156.94"],
  ["15 Oct", "Card Payment to Example Shop", "59.29", "", "97.65"],
  ["", "EUR 70.10 On 14 Oct at VISA", "", "", ""],
  ["", "Exchange Rate 1.18", "", "", ""],
  ["02 Nov", "Direct Debit to Example Insurer", "85.77", "", ""],
  ["", "Ref: P559715132-A", "", "", ""],
  ["", "Direct Debit to Example Lender", "260.67", "", ""],
  ["", "Direct Debit to Example Bank", "535.84", "", ""],
  ["", "Received From Someone", "", "340.00", "412.22"],
];

const mapping: StatementMapping = {
  hasHeader: true,
  dateColumn: 0,
  dateFormat: "dmy",
  amountColumn: null,
  debitColumn: 2,
  creditColumn: 3,
  debitIsPositive: true,
  descriptionColumn: 1,
  counterpartyColumn: null,
  decimalSeparator: ".",
  invertAmounts: false,
  defaultYear: 2026,
  signFromMarker: false,
  balanceColumn: null,
  signFromBalance: false,
  source: "heuristic",
  bankName: null,
  bankCountry: null,
  accountNumber: null,
  periodStart: null,
  periodEnd: null,
};

describe("a date printed once per day", () => {
  const parsed = applyMapping(rows, mapping);

  it("keeps every transaction under the date, not just the first", () => {
    expect(parsed).toHaveLength(5);
    expect(parsed.map((r) => r.amount)).toEqual([-59.29, -85.77, -260.67, -535.84, 340]);
  });

  it("gives each one the date printed above it", () => {
    expect(parsed.filter((r) => r.date === "2026-11-02")).toHaveLength(4);
    expect(parsed.find((r) => r.amount === -535.84)?.date).toBe("2026-11-02");
  });

  /**
   * A continuation line is part of the row above it, not a row of its own.
   * It takes the date and is dropped anyway, because it carries no amount.
   */
  it("does not turn a continuation line into a transaction", () => {
    expect(parsed.map((r) => r.description)).not.toContain("Exchange Rate 1.18");
    expect(parsed.map((r) => r.description)).not.toContain("Ref: P559715132-A");
  });

  // Nothing is carried before the first dated row, so the letterhead a PDF
  // opens with cannot inherit a date from further down the page.
  it("carries nothing above the first dated row", () => {
    const withLetterhead = [["", "MR M D BARSKE", "", "", ""], ["", "Premier Banking", "", "", "27.48"], ...rows];
    expect(applyMapping(withLetterhead, { ...mapping, hasHeader: false }).some((r) => r.description === "Premier Banking")).toBe(
      false
    );
  });
});

/**
 * Three things about this file that the column detection got wrong, each of
 * which on its own produced a confident import that was missing money.
 */
describe("reading the columns of a PDF current account", () => {
  // A PDF's columns are text at x-positions, and a heading does not always
  // sit over its own figures: on the real file "Money out" and "Money in"
  // land two and three cells left of the amounts beneath them. Following
  // those names maps both to columns that are empty on every row.
  it("ignores a header name over a column holding nothing", async () => {
    const drifted = [
      ["Date", "Description", "Money out", "Money in", "", "", ""],
      ["15 Oct 2026", "Shop", "", "", "59.29", "", "97.65"],
      ["16 Oct 2026", "Shop", "", "", "20.00", "", "77.65"],
      ["17 Oct 2026", "Wages", "", "", "", "100.00", "177.65"],
      ["18 Oct 2026", "Shop", "", "", "10.00", "", "167.65"],
    ];
    const mapped = await inferMapping(drifted);
    expect(applyMapping(drifted, mapped)).toHaveLength(4);
  });

  /**
   * "Contains a negative" is a good test for a signed amount column and a bad
   * one for a running balance, which is negative exactly as often as the
   * account is overdrawn. One day at −£2.78 had the balance column chosen as
   * the amount, so every transaction imported as the balance that followed
   * it — and only the rows that printed a balance arrived at all.
   */
  it("does not mistake a balance that dipped below zero for a signed amount", async () => {
    const dipped = [
      ["Date", "Description", "Out", "In", "Balance"],
      ["15 Oct 2026", "Shop", "59.29", "", "40.71"],
      ["16 Oct 2026", "Shop", "20.00", "", "20.71"],
      ["17 Oct 2026", "Shop", "23.49", "", "-2.78"],
      ["18 Oct 2026", "Wages", "", "100.00", "97.22"],
      ["19 Oct 2026", "Shop", "10.00", "", "87.22"],
    ];
    const mapped = await inferMapping(dipped);
    const parsed = applyMapping(dipped, mapped);
    expect(parsed.map((r) => r.amount)).toEqual([-59.29, -20, -23.49, 100, -10]);
  });

  /**
   * And not every value either: a loan's balance column is marked `DR`
   * throughout, which reads as negative on every row. A column with no
   * positive in it is a balance or a money-out column, not a signed amount.
   */
  it("does not mistake an all-DR balance column for a signed amount", async () => {
    const owed = [
      ["Date", "Description", "Payments out", "Balance"],
      ["21 May 2025", "Loan Funds Issued", "22900.00", "22900.00 DR"],
      ["01 Jul 2025", "Interest", "361.61", "23261.61 DR"],
      ["01 Jul 2025", "Direct Debit Payment", "535.84", "22725.77 DR"],
      ["01 Aug 2025", "Interest", "271.34", "22997.11 DR"],
    ];
    const mapped = await inferMapping(owed);
    expect(mapped.amountColumn).toBe(2);
    expect(mapped.balanceColumn).toBe(3);
  });
});
