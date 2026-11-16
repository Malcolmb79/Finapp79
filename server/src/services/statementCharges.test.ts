import { describe, expect, it } from "vitest";
import { chargeLines, nameUnnamedRows, type ChargeLine } from "./statementCharges.js";
import type { ParsedRow } from "./statementParser.js";

const row = (amount: number, description: string | null = null): ParsedRow => ({
  date: "2026-10-27",
  amount,
  description,
  counterparty: null,
});

/** The summary block as the FNB statement's grid actually carries it. */
const FNB_SUMMARY = [
  ["Statement Balances", "", "", ""],
  ["Opening Balance 42,501.06 Dr", "", "", ""],
  ["Closing Balance 40,531.38 Dr", "", "", ""],
  ["Total VAT (ZAR) 40.51 Dr", "", "", ""],
  ["Bank Charges", "", "", ""],
  ["Service Fees 241.62 Dr", "", "", ""],
  ["Cash Deposit Fees 0.00", "", "", ""],
  ["Cash Handling Fees 0.00", "", "", ""],
  ["Other Fees 69.00 Dr", "", "", ""],
  ["Overdraft Limit 41,000.00", "", "", ""],
  ["Overdraft Repayment 1,000.00", "", "", ""],
];

describe("chargeLines", () => {
  it("reads the charges a statement names and totals", () => {
    expect(chargeLines(FNB_SUMMARY)).toEqual([
      { label: "Service Fees", total: 241.62, printed: "241.62" },
      { label: "Other Fees", total: 69, printed: "69.00" },
    ]);
  });

  /**
   * A statement is full of "<words> <number>" lines, and any of them could
   * coincidentally equal some combination of the unnamed rows. Reading only
   * the charges summary is what keeps a coincidence from being treated as an
   * explanation — an unnamed row happening to equal the overdraft repayment
   * does not make it one.
   */
  it("ignores every line that isn't a charge", () => {
    const labels = chargeLines(FNB_SUMMARY).map((c) => c.label);
    expect(labels).not.toContain("Closing Balance");
    expect(labels).not.toContain("Overdraft Repayment");
    expect(labels).not.toContain("Total VAT (ZAR)");
  });

  // A running total is the sum of the lines beneath it. Matching against it
  // would claim the same rows a second time under a vaguer name.
  it("ignores an aggregate of the charges", () => {
    expect(chargeLines([["Total Bank Charges 310.62 Dr", "", "", ""]])).toEqual([]);
  });

  // "Cash Deposit Fees 0.00" is the statement saying there weren't any.
  it("ignores a charge of nothing", () => {
    expect(chargeLines(FNB_SUMMARY).map((c) => c.label)).not.toContain("Cash Deposit Fees");
  });

  it("reads a summary split across cells as readily as one in a single cell", () => {
    expect(chargeLines([["Service Fees", "241.62 Dr", "", ""]])).toEqual([
      { label: "Service Fees", total: 241.62, printed: "241.62" },
    ]);
  });

  it("reads comma decimals when that is what the statement uses", () => {
    expect(chargeLines([["Kontoführungsgebühren 241,62", "", "", ""]], ",")).toEqual([]);
    expect(chargeLines([["Account Fees 1.241,62", "", "", ""]], ",")).toEqual([
      { label: "Account Fees", total: 1241.62, printed: "1.241,62" },
    ]);
  });
});

describe("nameUnnamedRows", () => {
  const charges = chargeLines(FNB_SUMMARY);

  /**
   * The statement does say what these rows are. It says it further up the
   * page and in aggregate: 2.00 + 114.62 + 125.00 is 241.62 exactly, and the
   * remaining unnamed row is 69.00 exactly.
   */
  it("names the fee rows from the statement's own summary", () => {
    const rows = [
      row(30120.02, "Inward Swift R026J26Md0 Malcolm David Barske"),
      row(-2),
      row(-10500, "FNB App Payment To Mark Maintenance"),
      row(-69),
      row(-114.62),
      row(-125),
    ];
    const names = nameUnnamedRows(rows, charges);
    expect(names.map((n) => n?.label ?? null)).toEqual([
      null,
      "Service Fees",
      null,
      "Other Fees",
      "Service Fees",
      "Service Fees",
    ]);
  });

  // The arithmetic travels with the name, so a filled-in box is something
  // that can be checked rather than something that appeared.
  it("carries the sum that justifies the name, quoting the document", () => {
    const names = nameUnnamedRows([row(-69)], charges);
    expect(names[0]!.evidence).toBe("The statement's summary says Other Fees 69.00, which is this row exactly.");
  });

  /**
   * Two combinations adding to the same total means the statement does not
   * determine which rows the charge refers to. 2.00 + 3.00 and 5.00 both make
   * 5.00, and picking one would be inventing the answer.
   */
  it("says nothing when more than one combination would fit", () => {
    const ambiguous: ChargeLine[] = [{ label: "Service Fees", total: 5, printed: "5.00" }];
    const names = nameUnnamedRows([row(-2), row(-3), row(-5)], ambiguous);
    expect(names).toEqual([null, null, null]);
  });

  it("says nothing when no combination fits", () => {
    const names = nameUnnamedRows([row(-7), row(-11)], charges);
    expect(names).toEqual([null, null]);
  });

  // A row the statement named is not a candidate: the bank's own wording is
  // the record and a summary total must never be allowed to overwrite it.
  it("never touches a row the statement named", () => {
    const names = nameUnnamedRows([row(-69, "Int On Debit Balance")], charges);
    expect(names).toEqual([null]);
  });

  /**
   * One row cannot be two charges. Once a charge has claimed it, a later one
   * that would also have fitted has to go without rather than share it.
   */
  it("claims each row at most once", () => {
    const twoWays: ChargeLine[] = [
      { label: "Service Fees", total: 69, printed: "69.00" },
      { label: "Other Fees", total: 69, printed: "69.00" },
    ];
    const names = nameUnnamedRows([row(-69)], twoWays);
    expect(names.map((n) => n?.label ?? null)).toEqual(["Service Fees"]);
  });

  it("does nothing at all when the statement prints no charges summary", () => {
    expect(nameUnnamedRows([row(-2), row(-69)], [])).toEqual([null, null]);
  });
});
