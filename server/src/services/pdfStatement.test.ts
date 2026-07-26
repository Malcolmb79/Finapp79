import { describe, expect, it } from "vitest";
import { looksLikePdf, textToRows } from "./pdfStatement.js";
import { applyMapping, inferMapping, splitPreamble } from "./statementParser.js";

describe("looksLikePdf", () => {
  it("recognises the PDF signature regardless of filename", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
  });

  it("does not mistake CSV text for a PDF", () => {
    expect(looksLikePdf(new TextEncoder().encode("Date,Amount\n01/01/2027,-5.00"))).toBe(false);
  });
});

describe("textToRows", () => {
  // A PDF has no columns, only text at positions. What survives extraction is
  // runs of whitespace where the gaps were, so two or more spaces mark a
  // column boundary — while a single space stays inside a merchant name.
  // The case that whitespace-splitting gets wrong: with no debit on the
  // second row, splitting on gaps returns a short row and the credit slides
  // into the debit column — an income row silently imported as a payment.
  it("preserves an empty cell so later columns don't shift", () => {
    const rows = textToRows(
      [
        "Date          Description        Debit     Credit",
        "27/07/2026    TESCO STORES       42.15          ",
        "25/07/2026    SALARY                       3200.00",
      ].join("\n")
    );
    expect(rows[1]).toEqual(["27/07/2026", "TESCO STORES", "42.15", ""]);
    expect(rows[2]).toEqual(["25/07/2026", "SALARY", "", "3200.00"]);
  });

  it("splits columns on runs of spaces but keeps names intact", () => {
    const rows = textToRows(
      ["Posted Date   Description        Debit    Balance", "27/07/2026    TESCO STORES 3288  42.15    1210.55"].join("\n")
    );
    expect(rows).toEqual([
      ["Posted Date", "Description", "Debit", "Balance"],
      ["27/07/2026", "TESCO STORES 3288", "42.15", "1210.55"],
    ]);
  });

  it("drops blank lines", () => {
    expect(textToRows("a  b\n\n   \nc  d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

// The point of reconstructing a grid is that everything downstream — column
// mapping, the confirmation dialog, the importer — works on a PDF without
// knowing it was ever a PDF.
describe("a PDF statement flows through the normal pipeline", () => {
  it("parses extracted text into transactions", async () => {
    const extracted = [
      "AIB Personal Current Account",
      "IBAN IE29AIBK93115212345678",
      "",
      "Posted Date   Description        Debit     Credit    Balance",
      "27/07/2026    TESCO STORES 3288  42.15               1210.55",
      "25/07/2026    SALARY BARSKE LTD            3200.00   4410.55",
    ].join("\n");

    // Unlike a CSV, the title and IBAN lines aren't split off here: positional
    // slicing pads them to the table's width, so they stay in the grid as rows
    // of mostly-empty cells. They're still visible to the mapping step (which
    // is where a bank name is read from), and they drop out of the result
    // because they carry no parseable date.
    const { preamble, table } = splitPreamble(textToRows(extracted));

    const rows = applyMapping(table, await inferMapping(table, preamble));
    expect(rows).toEqual([
      { date: "2026-07-27", amount: -42.15, description: "TESCO STORES 3288", counterparty: null },
      { date: "2026-07-25", amount: 3200, description: "SALARY BARSKE LTD", counterparty: null },
    ]);
  });
});
