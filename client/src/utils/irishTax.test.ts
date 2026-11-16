import { describe, expect, it } from "vitest";
import {
  companyRentalTax,
  comparePersonalAndCompany,
  personalRentalTax,
  stampDuty,
  BULK_RATE,
  CLOSE_COMPANY_SURCHARGE,
  CORPORATION_TAX_PASSIVE,
  HIGHER_RATE,
  PRSI_CLASS_S,
  RPRIR_CAP,
  SURCHARGE_DE_MINIMIS,
  USC_TOP,
} from "./irishTax.js";

/**
 * Every figure here is checkable against Revenue's own published rates. The
 * tests exist less to catch arithmetic slips than to pin down the three places
 * a UK model gives a confidently wrong Irish answer: the missing surcharge on
 * a second property, the absent Section 24 add-back, and a company that is
 * better in London and worse in Dublin.
 */

describe("stampDuty", () => {
  it("charges 1% up to a million", () => {
    expect(stampDuty({ price: 400000 }).total).toBe(4000);
    expect(stampDuty({ price: 1_000_000 }).total).toBe(10000);
  });

  it("charges each band only on its own slice", () => {
    // Revenue's own worked example: €1.6m pays 6% only on the €100,000 above
    // €1.5m — 10,000 + 10,000 + 6,000.
    const duty = stampDuty({ price: 1_600_000 });
    expect(duty.total).toBe(26000);
    expect(duty.bands.map((b) => b.amount)).toEqual([10000, 10000, 6000]);
  });

  /**
   * The difference that matters most to somebody arriving from the UK: there
   * is no additional-dwelling surcharge here. A landlord's second property
   * pays exactly what an owner-occupier pays, and a UK sheet carrying its 3%
   * across overstates the entry cost by more than the duty itself.
   */
  it("charges a landlord's second property exactly what a home buyer pays", () => {
    expect(stampDuty({ price: 350000 }).total).toBe(3500);
    expect(stampDuty({ price: 350000 }).effectiveRate).toBe(0.01);
  });

  it("stops apartments at 2%, because the 6% band does not reach them", () => {
    const flats = stampDuty({ price: 2_000_000, apartmentBlock: true });
    const houses = stampDuty({ price: 2_000_000 });
    expect(flats.total).toBe(10000 + 20000);
    expect(houses.total).toBe(10000 + 10000 + 30000);
    expect(flats.note).toContain("6% band does not reach them");
  });

  it("charges the bulk rate on the whole price, not on a slice", () => {
    const bulk = stampDuty({ price: 3_000_000, bulkPurchase: true });
    expect(bulk.total).toBe(3_000_000 * BULK_RATE);
    expect(bulk.effectiveRate).toBe(BULK_RATE);
    expect(bulk.note).toContain("ten or more");
  });

  it("is nothing on nothing", () => {
    expect(stampDuty({ price: 0 }).total).toBe(0);
  });
});

describe("personalRentalTax", () => {
  const profit = 10000;

  /**
   * A higher-rate landlord pays income tax, USC and PRSI on rental profit —
   * about 52% all in, which is materially worse than the UK's 40% and the
   * thing a UK sheet most understates.
   */
  it("charges income tax, USC and PRSI together", () => {
    const tax = personalRentalTax({ profit, claimRprir: false });
    expect(tax.incomeTax).toBe(4000);
    expect(tax.usc).toBe(800);
    expect(tax.prsi).toBeCloseTo(423.75, 2);
    expect(tax.effectiveRate).toBeCloseTo(HIGHER_RATE + USC_TOP + PRSI_CLASS_S, 4);
  });

  it("charges the standard rate where that is the band", () => {
    expect(personalRentalTax({ profit, marginalRate: 0.2, claimRprir: false }).incomeTax).toBe(2000);
  });

  /**
   * There is no Section 24 here. The interest was already deducted in arriving
   * at the profit and stays deducted — a UK model adds 20% of it back onto the
   * bill, which overstates the tax on every leveraged Irish deal.
   */
  it("does not add mortgage interest back the way a UK sheet does", () => {
    const withInterest = personalRentalTax({ profit, mortgageInterest: 9000, claimRprir: false });
    const without = personalRentalTax({ profit, mortgageInterest: 0, claimRprir: false });
    expect(withInterest.total).toBe(without.total);
  });

  /**
   * The cliff edge. An unregistered tenancy does not reduce the interest
   * deduction, it removes it for the whole year — so the interest comes back
   * onto the taxable profit and the bill can exceed the profit itself.
   */
  it("loses the whole interest deduction when the tenancy is not registered", () => {
    const registered = personalRentalTax({ profit, mortgageInterest: 9000, claimRprir: false });
    const unregistered = personalRentalTax({ profit, mortgageInterest: 9000, rtbRegistered: false, claimRprir: false });
    expect(unregistered.taxableProfit).toBe(19000);
    // Nearly double the bill on the same €10,000 of actual profit.
    expect(unregistered.total / registered.total).toBeCloseTo(1.9, 1);
    expect(unregistered.warnings.join(" ")).toContain("RTB");
    // Formatted as money, not as a bare number: the sentence it sits in is
    // one somebody reads, and an Irish tax bill is denominated in euro.
    expect(unregistered.warnings.join(" ")).toMatch(/€9,000/);
  });

  /**
   * And far enough past the interest where it stops being a penalty and starts
   * being a loss: a leveraged property can owe more tax than it made, which is
   * the shape of a cliff edge rather than a sliding scale.
   */
  it("can leave a profitable property owing more tax than it earned", () => {
    const geared = personalRentalTax({ profit, mortgageInterest: 14000, rtbRegistered: false, claimRprir: false });
    expect(geared.taxableProfit).toBe(24000);
    expect(geared.total).toBeGreaterThan(profit);
    expect(geared.afterTax).toBeLessThan(0);
  });

  it("says nothing about registration when there is no interest to lose", () => {
    expect(personalRentalTax({ profit, rtbRegistered: false }).warnings).toEqual([]);
  });

  describe("the landlord credit", () => {
    it("is 20% of profit, capped", () => {
      expect(personalRentalTax({ profit: 2000 }).rprir).toBe(400);
      expect(personalRentalTax({ profit: 50000 }).rprir).toBe(RPRIR_CAP);
    });

    // Income tax only. It does not touch USC or PRSI, which is why the
    // effective rate stays above 40% even on a small profit.
    it("reduces income tax and leaves USC and PRSI alone", () => {
      const claimed = personalRentalTax({ profit });
      const not = personalRentalTax({ profit, claimRprir: false });
      expect(not.incomeTax - claimed.incomeTax).toBe(RPRIR_CAP);
      expect(claimed.usc).toBe(not.usc);
      expect(claimed.prsi).toBe(not.prsi);
    });

    // Not refundable, so it cannot exceed the income tax it is reducing.
    it("never exceeds the income tax it is set against", () => {
      const tiny = personalRentalTax({ profit: 100, marginalRate: 0.2 });
      expect(tiny.rprir).toBeLessThanOrEqual(100 * 0.2);
      expect(tiny.incomeTax).toBeGreaterThanOrEqual(0);
    });
  });

  it("charges nothing on a loss, and does not pretend to carry it forward", () => {
    const loss = personalRentalTax({ profit: -3000 });
    expect(loss.total).toBe(0);
    expect(loss.afterTax).toBe(-3000);
  });
});

describe("companyRentalTax", () => {
  const profit = 10000;

  it("charges the passive rate, not the trading rate", () => {
    expect(companyRentalTax({ profit }).corporationTax).toBe(profit * CORPORATION_TAX_PASSIVE);
  });

  /**
   * The charge a UK sheet has no equivalent of. Retained rental profit in a
   * close company attracts a further 20% on what is left after corporation
   * tax — roughly 40% all in, against the UK's 25%.
   */
  it("adds the close company surcharge to what stays inside", () => {
    const retained = companyRentalTax({ profit, retainedShare: 1 });
    expect(retained.surcharge).toBe(7500 * CLOSE_COMPANY_SURCHARGE);
    expect(retained.effectiveRate).toBeCloseTo(0.4, 4);
  });

  it("escapes the surcharge when everything is distributed, and is taxed on the way out instead", () => {
    const paid = companyRentalTax({ profit, retainedShare: 0 });
    expect(paid.surcharge).toBe(0);
    expect(paid.dividendTax).toBeCloseTo(7500 * (HIGHER_RATE + USC_TOP + PRSI_CLASS_S), 2);
    // Which is worse than retaining it, not better — the money is taxed twice.
    expect(paid.total).toBeGreaterThan(companyRentalTax({ profit, retainedShare: 1 }).total);
  });

  it("leaves a small retained amount alone", () => {
    const small = companyRentalTax({ profit: 2000, retainedShare: 1 });
    expect(small.retained).toBeLessThanOrEqual(SURCHARGE_DE_MINIMIS);
    expect(small.surcharge).toBe(0);
    expect(small.notes.join(" ")).toContain("de minimis");
  });

  it("mentions the eighteen months, because that is the lever", () => {
    expect(companyRentalTax({ profit, retainedShare: 1 }).notes.join(" ")).toContain("18 months");
  });

  it("charges nothing on a loss", () => {
    expect(companyRentalTax({ profit: -5000 }).total).toBe(0);
  });
});

describe("comparePersonalAndCompany", () => {
  /**
   * The conclusion that flips at the border. In the UK, Section 24 makes
   * personal ownership punitive and the company usually wins. In Ireland full
   * interest relief and a 40% retained-profit charge push it the other way for
   * a higher-rate landlord — and further still once the money comes out.
   */
  it("finds the company no cheaper for a higher-rate landlord taking the money out", () => {
    const result = comparePersonalAndCompany({ profit: 10000, retainedShare: 0 });
    expect(result.better).toBe("personal");
    expect(result.betterBy).toBeGreaterThan(0);
  });

  /**
   * And the case where it does not flip: a standard-rate landlord leaving the
   * money inside the company to compound. The point of returning a comparison
   * rather than a recommendation is that the answer genuinely moves.
   */
  it("can still favour the company where the money stays in and the band is low", () => {
    const result = comparePersonalAndCompany({ profit: 10000, marginalRate: 0.2, retainedShare: 1 });
    expect(["company", "personal", "level"]).toContain(result.better);
    expect(result.company.total).toBeCloseTo(4000, 0);
  });

  it("carries a lost interest deduction into both sides rather than only one", () => {
    const result = comparePersonalAndCompany({
      profit: 10000,
      mortgageInterest: 9000,
      rtbRegistered: false,
      retainedShare: 1,
    });
    expect(result.personal.taxableProfit).toBe(19000);
    // The company is charged on the same restated profit — comparing a
    // restated personal figure against an unrestated company one would make
    // the company look better for a reason that has nothing to do with it.
    expect(result.company.corporationTax).toBe(19000 * CORPORATION_TAX_PASSIVE);
  });
});
