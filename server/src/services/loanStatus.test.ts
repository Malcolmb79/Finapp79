import { describe, expect, it } from "vitest";
import { assemble, impliedPrincipal, reconciles, sniffImageType } from "./loanStatus.js";

/**
 * The lender, the reference and the amounts here are invented; the *shape* is
 * what was real, and the shape is what is being tested. A fixture goes into a
 * repository, and somebody's actual loan balance has no business in one.
 *
 * What matters is the arithmetic, because that is where the trap is. These
 * figures are a 4,000 loan over 36 months at 180.00 a month: 36 payments make
 * 6,480.00, twelve of them have been made, and the "remaining balance" of
 * 4,320.00 is the twenty-four still to come — not 4,320.00 of principal.
 * Nothing about the label says so.
 */

const quoted = (value: number, quote: string) => ({ value, quote });

describe("reconciles", () => {
  // 2,160.00 paid + 4,320.00 left = 6,480.00 to repay. When that holds, the
  // remaining figure carries the future interest inside it.
  it("spots a remaining balance that is really the rest of the instalments", () => {
    expect(reconciles(2160.0, 4320.0, 6480.0)).toBe(true);
  });

  // A balance that is the outstanding principal does not add up this way,
  // because the interest still to come is in neither number.
  it("stays quiet when the balance is the outstanding principal", () => {
    expect(reconciles(2160.0, 3076.0, 6480.0)).toBe(false);
  });

  it("allows for rounding on a final instalment", () => {
    expect(reconciles(2160.0, 4320.01, 6480.0)).toBe(true);
    expect(reconciles(2160.0, 4321.0, 6480.0)).toBe(false);
  });

  it("claims nothing when a figure is missing", () => {
    expect(reconciles(null, 4320.0, 6480.0)).toBe(false);
    expect(reconciles(2160.0, null, 6480.0)).toBe(false);
    expect(reconciles(2160.0, 4320.0, null)).toBe(false);
  });
});

describe("impliedPrincipal", () => {
  /**
   * 24 payments of 180.00 at 35% a year. The answer has to be materially below
   * the 4,320.00 of instalments — that gap is the interest that would
   * otherwise be charged a second time by the payoff projection.
   */
  it("values the payments still to come, not their face total", () => {
    const principal = impliedPrincipal(4320.0, 180.0, 35);
    expect(principal).not.toBeNull();
    expect(principal!).toBeGreaterThan(2800);
    expect(principal!).toBeLessThan(3300);
  });

  // With no interest quoted there is nothing to discount, so what is left to
  // pay is what is owed.
  it("returns the remaining instalments when no interest is charged", () => {
    expect(impliedPrincipal(1200, 100, 0)).toBe(1200);
  });

  it("declines rather than guessing when something is missing", () => {
    expect(impliedPrincipal(null, 180.0, 35)).toBeNull();
    expect(impliedPrincipal(4320.0, null, 35)).toBeNull();
    expect(impliedPrincipal(4320.0, 180.0, null)).toBeNull();
    expect(impliedPrincipal(4320.0, 0, 35)).toBeNull();
  });

  // A payment far larger than the balance implies no sensible schedule.
  it("declines a schedule that makes no sense", () => {
    expect(impliedPrincipal(50, 1000, 10)).toBeNull();
  });
});

describe("sniffImageType", () => {
  it("knows the formats a phone produces", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe("image/gif");

    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  // A PDF reaching the image reader is a mistake worth catching here rather
  // than as an opaque 400 from the API.
  it("refuses something that is not an image", () => {
    expect(sniffImageType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});

describe("assemble", () => {
  /** A lender's page, as the model would transcribe it. Invented throughout. */
  const pass = {
    reference: "0000000",
    lender: "Example Finance",
    currency: "gbp",
    remaining_balance: quoted(4320.0, "Remaining balance GBP4,320.00"),
    amount_paid: quoted(2160.0, "You've paid GBP2,160.00"),
    loan_amount: quoted(4000, "Loan amount GBP4,000.00"),
    total_to_repay: quoted(6480.0, "Total to repay GBP6,480.00"),
    monthly_payment: quoted(180.0, "Monthly repayments GBP180.00"),
    interest_rate: quoted(35.0, "Interest rate (fixed) 35.00%"),
    term_months: quoted(36, "Loan duration (months) 36 months"),
    start_date: { value: "2025-10-31", quote: "Start 31 Oct 2025" },
    end_date: null,
    next_payment_amount: quoted(180.0, "A payment of GBP180.00 will be deducted"),
    next_payment_date: { value: "2026-12-01", quote: "on 1 Dec 2026" },
  };

  it("reads a lender's loan page", () => {
    const status = assemble(pass);
    expect(status.reference).toBe("0000000");
    expect(status.currency).toBe("GBP");
    expect(status.remainingBalance?.value).toBe(4320.0);
    expect(status.monthlyPayment?.value).toBe(180.0);
    expect(status.termMonths?.value).toBe(36);
    expect(status.startDate?.value).toBe("2025-10-31");
    expect(status.nextPaymentDate?.value).toBe("2026-12-01");
    expect(status.readFrom).toBe("image");
  });

  // The whole reason this reader reports the flag rather than just a balance.
  it("flags that the remaining balance carries future interest", () => {
    expect(assemble(pass).balanceIncludesInterest).toBe(true);
  });

  /**
   * A rate that looks implausible can still be what the page says, and these
   * products do quote rates in the tens of percent. Refusing one for being
   * surprising would be the reader overruling the document.
   */
  it("keeps a high rate the page actually states", () => {
    const steep = assemble({ ...pass, interest_rate: quoted(49.9, "Interest rate (fixed) 49.90%") });
    expect(steep.interestRate?.value).toBe(49.9);
  });

  /**
   * The safeguard shared with the contract reader: a figure is re-derived from
   * the digits in its own quote, so a number the model asserted but did not
   * read is dropped rather than stored.
   */
  it("drops a figure its quote does not support", () => {
    const invented = assemble({ ...pass, remaining_balance: quoted(9999.99, "Remaining balance GBP4,320.00") });
    expect(invented.remainingBalance).toBeNull();
    // And with it goes the claim that depended on it.
    expect(invented.balanceIncludesInterest).toBe(false);
  });

  it("reports nothing for what the page does not show", () => {
    expect(assemble(pass).endDate).toBeNull();
  });

  it("survives a pass with nothing in it", () => {
    const status = assemble({});
    expect(status.remainingBalance).toBeNull();
    expect(status.balanceIncludesInterest).toBe(false);
    expect(status.reference).toBeNull();
  });
});
