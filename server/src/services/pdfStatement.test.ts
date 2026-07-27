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

// Some extractors join every text item with a single space, so a row arrives
// as one run of words and numbers with no gaps to slice and no delimiter to
// split. Shape is all that's left: date at the front, running balance at the
// end, amount just before it, description in between. Lines from a real FNB
// statement, which is what exposed this.
describe("lines with no whitespace structure at all", () => {
  const statement = [
    "Transactions in RAND (ZAR)",
    "Date Description Amount Balance",
    "08 Jun POS Purchase Vinted 400738*1373 06 Jun 203.17 37,119.71",
    "10 Jun Credit Voucher Vouch Vinted 400738******1373 559.40Cr 37,516.11",
    "29 Jun 2.00 38,267.87",
    "01 Jul Internal Debit Order Momentum 211456418 Jj6580 9,836.72 34,432.18",
  ].join("\n");

  it("recovers date, description, amount and balance by shape", () => {
    const rows = textToRows(statement);
    expect(rows[2]).toEqual(["08 Jun", "POS Purchase Vinted 400738*1373 06 Jun", "203.17", "37,119.71"]);
    // The amount and the balance must not merge — a money token cannot
    // contain a space, or "203.17 37,119.71" reads as one value.
    expect(rows[3]).toEqual(["10 Jun", "Credit Voucher Vouch Vinted 400738******1373", "559.40Cr", "37,516.11"]);
  });

  it("handles a row with no description", () => {
    expect(textToRows(statement)[4]).toEqual(["29 Jun", "", "2.00", "38,267.87"]);
  });

  // Non-transaction lines keep their text in the first cell and are padded to
  // the table's width. The padding matters: a ragged grid makes the column
  // editor label its dropdowns from a one-cell row, offering a single column
  // with no amount to select whatever the mapping found.
  it("pads non-transaction lines to the table's width", () => {
    const rows = textToRows(statement);
    expect(rows[0]).toEqual(["Transactions in RAND (ZAR)", "", "", ""]);
    expect(new Set(rows.map((r) => r.length))).toEqual(new Set([4]));
  });

  // A real statement carries around fifty lines of letterhead, address block
  // and VAT registrations before the table starts. Anything that looks at
  // only the first handful of rows sees none of the transactions.
  it("still parses when the table starts far down the page", async () => {
    const junk = [
      "Branch Number Account Number Date DDA 06/94/HX/KM",
      "665 62104109716 2026/07/08 FNB ASPIRE CURRENT ACCOUNT",
      "MR MALCOLM D BARSKE",
      "2 CHRISTOPHER S PLACE",
      "Customer VAT Registration Number Not Provided",
      "Statement Period : 8 June 2026 to 8 July 2026",
      "Opening Balance 36,916.54 Dr",
      ...Array.from({ length: 40 }, (_, i) => `Filler line ${i}`),
    ].join("\n");

    const { preamble, table } = splitPreamble(textToRows([junk, statement].join("\n")));
    const rows = applyMapping(table, await inferMapping(table, preamble));
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.amount)).toEqual([-203.17, 559.4, -2, -9836.72]);
  });

  // The statement writes its year once in the header and marks direction with
  // a Cr suffix rather than a sign — read naively, every row is positive and
  // undated.
  it("dates rows from the document's year and signs them from the Cr marker", async () => {
    const withHeader = ["Statement Period : 8 June 2026 to 8 July 2026", statement].join("\n");
    const { preamble, table } = splitPreamble(textToRows(withHeader));
    const mapping = await inferMapping(table, preamble);

    expect(mapping.defaultYear).toBe(2026);
    expect(mapping.signFromMarker).toBe(true);

    const rows = applyMapping(table, mapping);
    expect(rows).toEqual([
      { date: "2026-06-08", amount: -203.17, description: "POS Purchase Vinted 400738*1373 06 Jun", counterparty: null },
      { date: "2026-06-10", amount: 559.4, description: "Credit Voucher Vouch Vinted 400738******1373", counterparty: null },
      { date: "2026-06-29", amount: -2, description: null, counterparty: null },
      { date: "2026-07-01", amount: -9836.72, description: "Internal Debit Order Momentum 211456418 Jj6580", counterparty: null },
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
