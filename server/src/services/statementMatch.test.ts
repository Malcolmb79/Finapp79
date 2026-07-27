import { describe, expect, it } from "vitest";
import { checkStatement } from "./statementMatch.js";
import type { ParsedRow, StatementMapping } from "./statementParser.js";

const baseMapping: StatementMapping = {
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
  source: "heuristic",
  bankName: null,
  bankCountry: null,
  accountNumber: null,
  periodStart: null,
  periodEnd: null,
};

const rows: ParsedRow[] = [
  { date: "2026-06-10", amount: -10, description: "A", counterparty: null },
  { date: "2026-07-05", amount: -20, description: "B", counterparty: null },
];

describe("account matching", () => {
  it("matches a masked statement number against the stored account", () => {
    const check = checkStatement({ ...baseMapping, accountNumber: "****1373" }, rows, { iban: "IE29AIBK93115211373" });
    expect(check.accountMatches).toBe(true);
  });

  it("matches when the statement prints the number in full", () => {
    const check = checkStatement({ ...baseMapping, accountNumber: "62104109716" }, rows, { iban: "62104109716" });
    expect(check.accountMatches).toBe(true);
  });

  it("flags a genuinely different account", () => {
    const check = checkStatement({ ...baseMapping, accountNumber: "62104109716" }, rows, { iban: "99998888777" });
    expect(check.accountMatches).toBe(false);
  });

  // An unknown must never be reported as a mismatch — most manual accounts
  // have no number stored at all, and a false "wrong account" warning on
  // every import would train the user to ignore it.
  it("reports unknown rather than mismatch when either side has no number", () => {
    expect(checkStatement({ ...baseMapping, accountNumber: "62104109716" }, rows, { iban: null }).accountMatches).toBeNull();
    expect(checkStatement(baseMapping, rows, { iban: "62104109716" }).accountMatches).toBeNull();
  });

  it("refuses to compare on too few digits to be meaningful", () => {
    const check = checkStatement({ ...baseMapping, accountNumber: "*73" }, rows, { iban: "IE29AIBK93115211373" });
    expect(check.accountMatches).toBeNull();
  });
});

describe("statement period", () => {
  it("counts rows falling outside the stated period", () => {
    const check = checkStatement(
      { ...baseMapping, periodStart: "2026-06-01", periodEnd: "2026-06-30" },
      rows,
      { iban: null }
    );
    expect(check.outsidePeriod).toBe(1);
  });

  it("falls back to the range the rows cover when none is stated", () => {
    const check = checkStatement(baseMapping, rows, { iban: null });
    expect(check).toMatchObject({ periodStart: "2026-06-10", periodEnd: "2026-07-05", outsidePeriod: 0 });
  });
});
