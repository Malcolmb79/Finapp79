import { describe, expect, it } from "vitest";
import { looksTabular } from "./pdfStatement.js";
import { applyMapping, voidSectionFrom, type StatementMapping } from "./statementParser.js";

/**
 * Three faults a Revolut statement exposed, each of which produced a
 * confident import of figures that were not on the document.
 */

const base: StatementMapping = {
  hasHeader: false,
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

describe("a grid that split in the wrong places", () => {
  /**
   * The whitespace splitter glued each amount to the description beside it
   * and left the running balance alone in a column of its own. That passed
   * the old test — there were amounts outside the first column — so the
   * position-based reader was never tried, and every row imported at the
   * balance that followed it: €1,400.00, then €1,376.37, then €1,275.87. A
   * plausible-looking ledger of entirely invented figures.
   */
  it("rejects a grid whose dated rows glue prose to money", () => {
    const glued = [
      ["Date", "Description Money out Balance", "", ""],
      ["25 Aug 2026", "Apple Pay top-up by *3964 €1,400.00 €", "1,400.00", ""],
      ["26 Aug 2026", "Tesco €23.63 €", "1,376.37", ""],
      ["26 Aug 2026", "Smiggle €100.50 €", "1,275.87", ""],
      ["26 Aug 2026", "Next €40.00 €", "1,235.87", ""],
      ["26 Aug 2026", "Dunnes Stores €46.00 €", "1,189.87", ""],
      ["27 Aug 2026", "Next €55.00 €", "1,134.87", ""],
    ];
    expect(looksTabular(glued)).toBe(false);
  });

  /**
   * The line *beneath* a transaction is full of prose and money quite
   * legitimately. Counting those condemned a Barclays grid that had
   * separated perfectly well, and sent it back to a whitespace split that
   * read two rows out of thirty-eight.
   */
  it("keeps a grid whose continuation lines mention money", () => {
    const fine = [
      ["Date", "Description", "Money out", "Balance"],
      ["15 Oct", "Card Payment to Amazon.IE", "59.29", "97.65"],
      ["", "Luxembourg EUR 70.10 On 14 Oct", "", ""],
      ["", "at VISA Exchange Rate 1.18", "", ""],
      ["19 Oct", "Card Payment to Amazon.IE Ireland", "3.99", "93.66"],
      ["", "EUR 4.71 On 17 Oct at VISA", "", ""],
      ["23 Oct", "Payment to Malcolm", "1400.00", "-1306.34"],
      ["26 Oct", "Card Payment to Quidmarket", "724.94", "-2031.28"],
      ["28 Oct", "Card Payment to Amazon.Co.UK On", "9.49", "-2040.77"],
      ["", "27 Oct", "", ""],
      ["30 Oct", "Card Payment to Zwift USA On 29", "17.99", "-2058.76"],
    ];
    expect(looksTabular(fine)).toBe(true);
  });

  // A `DR` beside a figure is a convention, not prose, and a loan statement
  // marks every balance that way.
  it("does not read a DR marker as prose", () => {
    const loan = [
      ["21 May 2025", "Loan Funds Issued", "22900.00", "22900.00 DR"],
      ["01 Jul 2025", "Interest", "361.61", "23261.61 DR"],
      ["01 Jul 2025", "Direct Debit Payment", "535.84", "22725.77 DR"],
      ["01 Aug 2025", "Interest", "271.34", "22997.11 DR"],
      ["01 Aug 2025", "Direct Debit Payment", "535.84", "22461.27 DR"],
      ["01 Sep 2025", "Interest", "268.18", "22729.45 DR"],
    ];
    expect(looksTabular(loan)).toBe(true);
  });
});

describe("a row that borrows its date", () => {
  /**
   * A Revolut transfer prints the other currency underneath it — "58.78 ZAR"
   * in the money-out column, being what the €3.19 was sent as. With the date
   * carried down from the row above and nothing else asked of it, that line
   * arrived as a second €58.78 payment nobody made.
   */
  it("is not a transaction without a name of its own", () => {
    const rows = [
      ["23 Sept 2026", "Transfer to LIZETTE BARSKE", "3.19", ""],
      ["", "", "58.78", ""],
      ["23 Sept 2026", "Tesco", "66.98", ""],
    ];
    const parsed = applyMapping(rows, base);
    expect(parsed.map((r) => r.amount)).toEqual([-3.19, -66.98]);
  });

  // The ordinary case the carry-forward exists for is untouched.
  it("is a transaction when it names itself", () => {
    const rows = [
      ["02 Nov 2026", "Direct Debit to Aviva", "85.77", ""],
      ["", "Direct Debit to Barclays Bank UK", "535.84", ""],
    ];
    expect(applyMapping(rows, base).map((r) => r.amount)).toEqual([-85.77, -535.84]);
  });

  /**
   * A row with its own date and no description is a different thing
   * entirely — an FNB cheque account prints its fee postings that way — and
   * `strayName` exists for it.
   */
  it("keeps a dated row that the statement never named", () => {
    const rows = [
      ["02 Nov 2026", "Direct Debit to Aviva", "85.77", ""],
      ["03 Nov 2026", "", "6.00", ""],
    ];
    expect(applyMapping(rows, base)).toHaveLength(2);
  });
});

describe("an appendix of money that never moved", () => {
  /**
   * A Revolut statement ends with a second table headed "Reverted from 25
   * August 2026 to 17 November 2026" — authorisations that were released.
   * Its own balance summary excludes them, which is the proof rather than
   * the claim. Importing them records money that did not leave, and most
   * will arrive later as the real thing on a different date, which is a
   * duplicate nothing can recognise as one.
   */
  const withAppendix = (): string[][] => [
    ...Array.from({ length: 12 }, (_, i) => [`0${(i % 9) + 1} Oct 2026`, `Shop ${i}`, "10.00", ""]),
    ["Reverted from 25 August 2026 to 17 November 2026", "", "", ""],
    ["Start date", "Description", "Money out", "Money in"],
    ["9 Oct 2026", "Hello Fresh", "1.00", ""],
    ["25 Oct 2026", "Hello Fresh", "1.00", ""],
  ];

  it("stops where the appendix starts", () => {
    const rows = withAppendix();
    expect(voidSectionFrom(rows, 0)).toBe(12);
    expect(applyMapping(rows, base)).toHaveLength(12);
  });

  /**
   * Only at the end of the file. These appendices are printed after the
   * statement proper, and the same word matched halfway up a document is
   * more likely to be prose — where cutting the file short would lose real
   * transactions silently, which is the worse of the two faults.
   */
  it("ignores the word halfway up the document", () => {
    const rows = [
      ["", "Your pending transactions appear in the app", "", ""],
      ...Array.from({ length: 12 }, (_, i) => [`0${(i % 9) + 1} Oct 2026`, `Shop ${i}`, "10.00", ""]),
    ];
    expect(voidSectionFrom(rows, 0)).toBe(rows.length);
    expect(applyMapping(rows, base)).toHaveLength(12);
  });

  it("has nothing to say about a statement with no appendix", () => {
    const rows = Array.from({ length: 8 }, (_, i) => [`0${i + 1} Oct 2026`, `Shop ${i}`, "10.00", ""]);
    expect(voidSectionFrom(rows, 0)).toBe(rows.length);
  });
});
