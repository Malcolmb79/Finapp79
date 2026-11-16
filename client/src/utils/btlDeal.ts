import { amortize, monthlyPayment } from "./amortization.js";
import {
  companyRentalTax,
  personalRentalTax,
  stampDuty,
  type CompanyTax,
  type PersonalTax,
  type StampDuty,
} from "./irishTax.js";

/**
 * A buy-to-let deal, appraised before it is bought.
 *
 * Modelled on the UK deal sheets landlords actually use, and corrected where
 * Ireland differs — which is almost everywhere that matters. The corrections
 * are not cosmetic: the UK version overstates the entry cost (no second-home
 * surcharge here), overstates the tax (no Section 24 here), understates the
 * tax (USC and PRSI on top of income tax here), and recommends the wrong
 * ownership structure (a close company is charged ~40% on retained rent here).
 *
 * Two things this model does that the sheets generally do not.
 *
 * **Capital repayment is cash out and is not deductible.** A UK sheet sidesteps
 * this by assuming an interest-only mortgage, which is the normal UK BTL
 * product and the unusual Irish one. On a repayment mortgage the cash flow has
 * to carry the whole instalment while the tax computation deducts only the
 * interest part of it — treat them as the same number and a geared deal reads
 * as loss-making when it is not, or profitable when it is not, depending which
 * way round the error goes.
 *
 * **Vacancy is allowed for.** A deal that only works at 100% occupancy is a
 * deal that does not work.
 */

export type Ownership = "personal" | "company";

export interface DealInput {
  name: string;

  /* Purchase */
  purchasePrice: number;
  /** Loan to value as a fraction. Irish BTL lenders rarely go past 0.7. */
  ltv: number;
  /** Annual rate as a percentage: 4.5 means 4.5%. */
  mortgageRate: number;
  interestOnly: boolean;
  termYears: number;
  /** Arrangement and valuation fees rolled into the loan. */
  arrangementFees: number;
  /** Legal, survey, searches — paid up front, never added to the loan. */
  purchaseFees: number;
  /** Part of a purchase of three or more apartments in one block. */
  apartmentBlock?: boolean;
  /** Part of ten or more residential units inside twelve months. */
  bulkPurchase?: boolean;

  /* Works */
  refurbCost: number;
  /** What it is worth once the works are done. */
  valueAfterWorks: number;
  /** Furniture and fittings, which attract wear and tear rather than being deducted at once. */
  furnishingsCost: number;

  /* Income */
  units: number;
  /** Per unit, per month, gross. */
  rentPerUnit: number;
  /** Percentage of the year expected empty. */
  vacancyRate: number;

  /* Running costs */
  /** Percentage of rent taken by an agent. VAT is added on top. */
  managementRate: number;
  /** Local Property Tax, annual. The owner's in Ireland, unlike UK council tax. */
  lptAnnual: number;
  insuranceMonthly: number;
  maintenanceMonthly: number;
  /** Owners' management company charge and any ground rent, monthly. */
  serviceChargeMonthly: number;
  /** RTB registration, annual, per tenancy. */
  rtbFeeAnnual: number;
  otherMonthly: number;

  /* Tax */
  ownership: Ownership;
  /** 0.2 or 0.4. */
  marginalRate: number;
  /** For a company: how much of the after-tax profit stays in it. */
  retainedShare: number;
  rtbRegistered: boolean;
}

/** VAT on an agent's fee. 23% in Ireland, against the UK's 20%. */
export const VAT_RATE = 0.23;

/** Wear and tear on furniture and fittings: 12.5% a year, over eight years. */
export const WEAR_AND_TEAR_RATE = 0.125;
export const WEAR_AND_TEAR_YEARS = 8;

/**
 * Rent cover a lender wants over the stressed mortgage payment.
 *
 * The UK sheet uses 125%. Irish lenders are generally stricter and stress the
 * rate as well as the ratio, so this is the floor rather than the standard.
 */
export const DEFAULT_ICR = 1.25;

/** Points added to the rate before testing cover, because lenders test a worse rate than today's. */
export const ICR_STRESS_POINTS = 2;

export interface DealResult {
  /* Entry */
  stamp: StampDuty;
  mortgageAmount: number;
  deposit: number;
  /** Price plus the fees that are not financed. Excludes stamp duty, which is listed separately. */
  totalPurchaseCost: number;
  /** Everything that has to be found in cash to complete and refurbish. */
  cashRequired: number;

  /* Financing */
  monthlyMortgage: number;
  annualMortgage: number;
  /** Interest alone, in the first year — the only part that is deductible. */
  annualInterest: number;
  /** Capital repaid in the first year. Cash out, not an expense. */
  annualCapital: number;

  /* Income */
  grossMonthlyRent: number;
  effectiveMonthlyRent: number;
  annualGrossRent: number;

  /* Costs */
  costs: { label: string; monthly: number }[];
  totalMonthlyCosts: number;

  /* Result */
  monthlyCashFlow: number;
  annualCashFlow: number;
  /** After every allowable expense including interest, before tax. Not the same as cash flow. */
  taxableProfit: number;
  wearAndTear: number;

  /* Value */
  equity: number;
  equityAfterRefurb: number;
  /** LTV once the works are done — the refinance test on a BRRR deal. */
  newLtv: number | null;
  valueAdded: number;

  /* Yields */
  grossYield: number | null;
  netYield: number | null;
  /** Cash-on-cash: the annual return on the money actually put in. */
  cashOnCash: number | null;

  /* Lender test */
  icr: { requiredRent: number; stressedPayment: number; cover: number | null; passes: boolean };

  /* Tax */
  personal: PersonalTax;
  company: CompanyTax;
  tax: PersonalTax | CompanyTax;
  annualAfterTax: number;
  monthlyAfterTax: number;
  /** After-tax annual profit per €100,000 of purchase price, for comparing unlike deals. */
  perHundredThousand: number | null;

  warnings: string[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function appraiseDeal(input: DealInput): DealResult {
  const price = Math.max(0, input.purchasePrice);
  const stamp = stampDuty({
    price,
    apartmentBlock: input.apartmentBlock,
    bulkPurchase: input.bulkPurchase,
  });

  const mortgageAmount = round(price * Math.min(1, Math.max(0, input.ltv)));
  const deposit = round(price - mortgageAmount);
  // Arrangement fees ride on the loan, so they are borrowed and charged
  // interest rather than found in cash.
  const financed = mortgageAmount + input.arrangementFees;

  const termMonths = Math.max(1, Math.round(input.termYears * 12));
  const rate = input.mortgageRate / 100;

  let monthlyMortgage: number;
  let annualInterest: number;
  let annualCapital: number;

  if (input.interestOnly) {
    annualInterest = round(financed * rate);
    monthlyMortgage = round(annualInterest / 12);
    annualCapital = 0;
  } else {
    monthlyMortgage = monthlyPayment(financed, input.mortgageRate, termMonths);
    // The first twelve rows of the real schedule rather than a flat estimate:
    // early payments are nearly all interest, and averaging across the term
    // would understate the deductible part in exactly the years being
    // appraised.
    const firstYear = amortize({ balance: financed, annualRate: input.mortgageRate, termMonths }).schedule.slice(0, 12);
    annualInterest = round(firstYear.reduce((sum, row) => sum + row.interest, 0));
    annualCapital = round(firstYear.reduce((sum, row) => sum + row.principal, 0));
  }

  const annualMortgage = round(monthlyMortgage * 12);

  const grossMonthlyRent = round(input.units * input.rentPerUnit);
  const vacancy = input.vacancyRate >= 0 && input.vacancyRate <= 100 ? input.vacancyRate : 0;
  const effectiveMonthlyRent = round(grossMonthlyRent * (1 - vacancy / 100));
  const annualGrossRent = round(effectiveMonthlyRent * 12);

  // Management is charged on rent actually collected, and VAT on the fee.
  const management = round(effectiveMonthlyRent * (input.managementRate / 100) * (1 + VAT_RATE));

  const costs: { label: string; monthly: number }[] = [
    { label: "Mortgage", monthly: monthlyMortgage },
    { label: `Management (${input.managementRate}% + ${Math.round(VAT_RATE * 100)}% VAT)`, monthly: management },
    { label: "Service charge & ground rent", monthly: round(input.serviceChargeMonthly) },
    { label: "Local Property Tax", monthly: round(input.lptAnnual / 12) },
    { label: "Insurance", monthly: round(input.insuranceMonthly) },
    { label: "Maintenance", monthly: round(input.maintenanceMonthly) },
    { label: "RTB registration", monthly: round((input.rtbFeeAnnual * input.units) / 12) },
    { label: "Other", monthly: round(input.otherMonthly) },
  ].filter((cost) => cost.monthly !== 0);

  const totalMonthlyCosts = round(costs.reduce((sum, cost) => sum + cost.monthly, 0));
  const monthlyCashFlow = round(effectiveMonthlyRent - totalMonthlyCosts);
  const annualCashFlow = round(monthlyCashFlow * 12);

  /**
   * Taxable profit is not cash flow, and the gap is the point.
   *
   * Capital repaid is cash gone and not an expense, so it comes back on. Wear
   * and tear on furnishings is an expense with no cash attached, so it comes
   * off. A model that reported one number for both would be wrong by the sum
   * of the two, in opposite directions on different deals.
   */
  const wearAndTear = round((input.furnishingsCost * WEAR_AND_TEAR_RATE) || 0);
  const taxableProfit = round(annualCashFlow + annualCapital - wearAndTear);

  const value = input.valueAfterWorks || price;
  const totalPurchaseCost = round(price + input.purchaseFees);
  const cashRequired = round(deposit + input.purchaseFees + stamp.total + input.refurbCost + input.furnishingsCost);

  const equity = round(value - mortgageAmount);
  const equityAfterRefurb = round(value - mortgageAmount - input.refurbCost);
  const newLtv = value > 0 ? round((financed / value) * 10000) / 10000 : null;

  // Stressed at a worse rate than today's, because that is what a lender does
  // and because a deal that only covers at the current rate is a deal with no
  // room in it.
  const stressedPayment = input.interestOnly
    ? round((financed * (rate + ICR_STRESS_POINTS / 100)) / 12)
    : monthlyPayment(financed, input.mortgageRate + ICR_STRESS_POINTS, termMonths);
  const requiredRent = round(stressedPayment * DEFAULT_ICR);
  const cover = stressedPayment > 0 ? round((effectiveMonthlyRent / stressedPayment) * 100) / 100 : null;

  const personal = personalRentalTax({
    profit: taxableProfit,
    marginalRate: input.marginalRate,
    rtbRegistered: input.rtbRegistered,
    mortgageInterest: annualInterest,
  });
  const company = companyRentalTax({
    profit: input.rtbRegistered ? taxableProfit : personal.taxableProfit,
    retainedShare: input.retainedShare,
    marginalRate: input.marginalRate,
  });

  const tax = input.ownership === "company" ? company : personal;
  // Measured against cash flow rather than taxable profit: the tax is real
  // money leaving, and what the owner keeps is what the property generated
  // less what the Revenue takes.
  const annualAfterTax = round(annualCashFlow - tax.total);

  const warnings: string[] = [...personal.warnings];
  if (!input.rtbRegistered) {
    warnings.push("Register the tenancy with the RTB within a month of it starting — the interest deduction depends on it.");
  }
  if (cover !== null && cover < DEFAULT_ICR) {
    warnings.push(
      `Rent covers only ${cover.toFixed(2)}× the stressed mortgage payment. Lenders generally want ${DEFAULT_ICR}× or better.`
    );
  }
  if (monthlyCashFlow < 0) {
    warnings.push("This deal costs money every month before tax is even considered.");
  }
  if (input.vacancyRate === 0) {
    warnings.push("No vacancy allowance. A deal that only works at full occupancy is a deal with no margin in it.");
  }
  if (input.ltv > 0.7) {
    warnings.push("Irish buy-to-let lenders rarely go beyond 70% loan to value — check the deposit is realistic.");
  }

  return {
    stamp,
    mortgageAmount,
    deposit,
    totalPurchaseCost,
    cashRequired,
    monthlyMortgage,
    annualMortgage,
    annualInterest,
    annualCapital,
    grossMonthlyRent,
    effectiveMonthlyRent,
    annualGrossRent,
    costs,
    totalMonthlyCosts,
    monthlyCashFlow,
    annualCashFlow,
    taxableProfit,
    wearAndTear,
    equity,
    equityAfterRefurb,
    newLtv,
    valueAdded: round(value - price),
    grossYield: price > 0 ? round((annualGrossRent / (price + stamp.total + input.purchaseFees)) * 10000) / 10000 : null,
    netYield:
      price > 0 ? round((annualCashFlow / (price + stamp.total + input.purchaseFees)) * 10000) / 10000 : null,
    cashOnCash: cashRequired > 0 ? round((annualCashFlow / cashRequired) * 10000) / 10000 : null,
    icr: { requiredRent, stressedPayment, cover, passes: cover !== null && cover >= DEFAULT_ICR },
    personal,
    company,
    tax,
    annualAfterTax,
    monthlyAfterTax: round(annualAfterTax / 12),
    perHundredThousand: price > 0 ? round((annualAfterTax / price) * 100000) : null,
    warnings,
  };
}

/** A deal with nothing filled in, so a blank form is still a working model. */
export const BLANK_DEAL: DealInput = {
  name: "New deal",
  purchasePrice: 300000,
  ltv: 0.7,
  mortgageRate: 4.5,
  interestOnly: false,
  termYears: 25,
  arrangementFees: 0,
  purchaseFees: 3500,
  refurbCost: 0,
  valueAfterWorks: 300000,
  furnishingsCost: 0,
  units: 1,
  rentPerUnit: 1800,
  vacancyRate: 5,
  managementRate: 8,
  lptAnnual: 315,
  insuranceMonthly: 35,
  maintenanceMonthly: 100,
  serviceChargeMonthly: 0,
  rtbFeeAnnual: 40,
  otherMonthly: 0,
  ownership: "personal",
  marginalRate: 0.4,
  retainedShare: 1,
  rtbRegistered: true,
};
