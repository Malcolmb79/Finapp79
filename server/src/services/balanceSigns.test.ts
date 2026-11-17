import { describe, expect, it } from "vitest";
import { applyMapping, balanceSigns, withBalanceSigns, type StatementMapping } from "./statementParser.js";

/**
 * A Barclayloan statement, as the PDF extractor actually hands it over.
 *
 * The file prints *Payments out £* and *Payments in £* as two columns and
 * fills exactly one of them per row, so the whitespace fallback collapses
 * them into one — and what is lost is the direction. Every interest charge,
 * the advance itself and every direct debit then import as money arriving.
 *
 * The document does say which way each row ran. It says it in the balance
 * printed beside every one of them.
 */
const LOAN: string[][] = [
  ["Date", "Description", "Payments out £", "Balance £"],
  ["21 May 2025", "Opening Balance", "0.00", ""],
  ["21 May 2025", "Loan Funds Issued", "22900.00", "22900.00 DR"],
  ["01 Jul 2025", "Interest", "361.61", "23261.61 DR"],
  ["01 Jul 2025", "Direct Debit Payment", "535.84", "22725.77 DR"],
  ["01 Aug 2025", "Interest", "271.34", "22997.11 DR"],
  ["01 Aug 2025", "Direct Debit Payment", "535.84", "22461.27 DR"],
  ["11 May 2026", "Closing Balance", "22461.27 DR", ""],
];

const base: StatementMapping = {
  hasHeader: true,
  dateColumn: 0,
  dateFormat: "dmy",
  amountColumn: 2,
  debitColumn: null,
  creditColumn: null,
  debitIsPositive: true,
  descriptionColumn: 1,
  counterpartyColumn: null,
  decimalSeparator: ".",
  invertAmounts: false,
  defaultYear: null,
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

describe("withBalanceSigns", () => {
  it("finds the balance column and trusts it when the file reconciles", () => {
    const mapping = withBalanceSigns(base, LOAN);
    expect(mapping.balanceColumn).toBe(3);
    expect(mapping.signFromBalance).toBe(true);
  });

  /**
   * The guard that mattered. This statement signs nothing — and still ends
   * with "Closing Balance 22,461.27 DR", whose `DR` parses as the only
   * negative in the file. Treating one negative as "the statement has already
   * said which way it runs" left the whole thing importing as income.
   */
  it("is not put off by a single DR on a summary line", () => {
    expect(withBalanceSigns(base, LOAN).signFromBalance).toBe(true);
  });

  // A statement that signs its own amounts has said which way they run, and
  // this must not second-guess it.
  it("leaves a genuinely signed statement alone", () => {
    const signed = [
      ["Date", "Description", "Amount", "Balance"],
      ["01 Jul 2025", "Shop", "-20.00", "980.00"],
      ["02 Jul 2025", "Wages", "500.00", "1480.00"],
      ["03 Jul 2025", "Rent", "-400.00", "1080.00"],
      ["04 Jul 2025", "Shop", "-30.00", "1050.00"],
    ];
    expect(withBalanceSigns(base, signed).signFromBalance).toBe(false);
  });

  // A column of numbers that happens to sit beside the amounts is not a
  // running balance, and reading a coincidence as an explanation is the one
  // failure this must not have.
  it("refuses a column that does not reconcile", () => {
    const noise = [
      ["Date", "Description", "Amount", "Ref"],
      ["01 Jul 2025", "Shop", "20.00", "100001"],
      ["02 Jul 2025", "Shop", "30.00", "100002"],
      ["03 Jul 2025", "Shop", "40.00", "100003"],
      ["04 Jul 2025", "Shop", "50.00", "100004"],
    ];
    expect(withBalanceSigns(base, noise).signFromBalance).toBe(false);
  });

  it("has nothing to say when there is no amount column", () => {
    const mapping = withBalanceSigns({ ...base, amountColumn: null, debitColumn: 2, creditColumn: 3 }, LOAN);
    expect(mapping.signFromBalance).toBe(false);
  });
});

describe("balanceSigns", () => {
  const mapping = withBalanceSigns(base, LOAN);
  const body = LOAN.slice(1);

  /**
   * Order-free on purpose. The PDF this came from puts a row from the top of
   * page two ahead of the address block, and two rows dated 01 September have
   * no order between them that the page preserves — so each row is tested
   * against the balances of the whole statement rather than against the row
   * before it.
   */
  it("reads each row's direction without needing the file in order", () => {
    const shuffled = [body[3], body[1], body[5], body[2], body[4], body[0], body[6]];
    const signs = balanceSigns(shuffled, mapping);
    const byDescription = new Map(shuffled.map((row, i) => [row[1], signs?.[i]]));
    expect(byDescription.get("Interest")).toBe(-1);
    expect(byDescription.get("Direct Debit Payment")).toBe(1);
    expect(byDescription.get("Loan Funds Issued")).toBe(-1);
  });

  /**
   * The first movement on the statement is the one whose previous balance is
   * printed as a summary line rather than in the balance column — and it is
   * the largest row in the file.
   */
  it("settles the opening advance from the opening balance line", () => {
    const signs = balanceSigns(body, mapping)!;
    expect(signs[body.findIndex((row) => row[1] === "Loan Funds Issued")]).toBe(-1);
  });

  // Nothing moved, so there is no direction in it to read, and both
  // candidates are the same figure.
  it("leaves a zero row undecided rather than guessing", () => {
    const signs = balanceSigns(
      [
        ["01 Jul 2025", "Nothing", "0.00", "100.00"],
        ["02 Jul 2025", "Shop", "20.00", "80.00"],
        ["03 Jul 2025", "Shop", "30.00", "50.00"],
      ],
      { ...mapping, balanceColumn: 3 }
    )!;
    expect(signs[0]).toBeNull();
  });
});

describe("applying it", () => {
  const mapping = withBalanceSigns(base, LOAN);
  const rows = applyMapping(LOAN, mapping);

  it("reads a charge as money out and a repayment as money in", () => {
    const byDescription = new Map(rows.map((r) => [r.description, r.amount]));
    expect(byDescription.get("Interest")).toBeLessThan(0);
    expect(byDescription.get("Direct Debit Payment")).toBe(535.84);
    expect(byDescription.get("Loan Funds Issued")).toBe(-22900);
  });

  /**
   * The check worth having: on a running-balance statement the transactions
   * must add up to the closing balance. Nothing else proves the signs are
   * right rather than merely plausible.
   */
  it("adds up to the balance the statement closes on", () => {
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBeCloseTo(-22461.27, 2);
  });

  /**
   * A movement on this kind of statement prints the balance it produced. A
   * row with an amount and no balance is a summary line — and importing the
   * closing one puts the account out by the whole of itself.
   */
  it("drops the opening and closing balance lines", () => {
    expect(rows.map((r) => r.description)).not.toContain("Closing Balance");
    expect(rows.map((r) => r.description)).not.toContain("Opening Balance");
    expect(rows).toHaveLength(5);
  });

  // Only where a balance is otherwise on every row, so a statement that
  // prints one only sometimes keeps all of its transactions.
  it("keeps rows without a balance when the statement often omits it", () => {
    const patchy = [
      ["Date", "Description", "Amount", "Balance"],
      ["01 Jul 2025", "Shop", "20.00", "80.00"],
      ["02 Jul 2025", "Shop", "30.00", ""],
      ["03 Jul 2025", "Shop", "40.00", ""],
      ["04 Jul 2025", "Shop", "10.00", ""],
    ];
    expect(applyMapping(patchy, withBalanceSigns(base, patchy))).toHaveLength(4);
  });
});
