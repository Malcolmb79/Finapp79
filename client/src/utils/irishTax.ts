/**
 * Irish tax, as a buy-to-let needs it.
 *
 * This exists because a UK landlord's spreadsheet gives the wrong answer here,
 * and gives it confidently. Three differences do most of the damage:
 *
 * **There is no Section 24.** A UK sheet adds 20% of the mortgage interest
 * back onto the personal tax bill, because since 2020 a UK landlord cannot
 * deduct interest and gets a basic-rate credit instead. Ireland restored full
 * relief: interest on money borrowed to buy, improve or repair a let
 * residential property is 100% deductible under s97(2)(e) TCA 1997. Carrying
 * the UK add-back over overstates the Irish tax bill on every leveraged deal.
 *
 * **The deduction is conditional on RTB registration.** Not reduced —
 * *lost*, for the whole year, for that property. It is the single largest
 * cliff edge in Irish landlord taxation and nothing on a UK sheet hints at it.
 *
 * **A company is worse here, not better.** The UK answer is usually "buy it in
 * a limited company", because Section 24 makes personal ownership punitive
 * against 19–25% corporation tax. In Ireland rental profit in a company is
 * charged at 25%, and a close company retaining it pays a further 20%
 * surcharge on what is left — about 40% all in — while a personal landlord
 * with full interest relief faces their marginal rate. Taking the money out
 * afterwards is taxed again at the shareholder's marginal rate. The structure
 * the UK sheet concludes with is frequently the wrong one on this side.
 *
 * None of this is tax advice and the rates change every Finance Act. They are
 * gathered in one dated block below so they can be checked and updated in one
 * place rather than hunted through the arithmetic.
 */

/**
 * Rates as they stand for 2026. Each one is the figure a return would use,
 * not an average, so the arithmetic below can stay free of judgement.
 */
export const IRISH_RATES_YEAR = 2026;

/** Stamp duty on residential property, in bands, from 2 October 2024. */
export const STAMP_DUTY_BANDS = [
  { upTo: 1_000_000, rate: 0.01 },
  { upTo: 1_500_000, rate: 0.02 },
  { upTo: Infinity, rate: 0.06 },
];

/**
 * Three or more apartments in one block stop at 2% — the 6% band does not
 * reach them. A quirk worth encoding rather than rounding away, because it is
 * exactly the kind of purchase a landlord makes.
 */
export const APARTMENT_BANDS = [
  { upTo: 1_000_000, rate: 0.01 },
  { upTo: Infinity, rate: 0.02 },
];

/** Ten or more residential units inside twelve months: 15% of the whole consideration (s31E SDCA 1999). */
export const BULK_RATE = 0.15;
export const BULK_THRESHOLD_UNITS = 10;

/** Income tax bands a landlord's rental profit lands in, on top of other income. */
export const STANDARD_RATE = 0.2;
export const HIGHER_RATE = 0.4;

/** The USC band rental profit falls in for someone already earning. 8% is the top standard band. */
export const USC_TOP = 0.08;

/** Class S, blended across the 2026 change from 4.2% to 4.35% on 1 October. */
export const PRSI_CLASS_S = 0.042375;

/** Corporation tax on rental and other passive income. Not the 12.5% trading rate. */
export const CORPORATION_TAX_PASSIVE = 0.25;

/** Close company surcharge on undistributed after-tax rental income. */
export const CLOSE_COMPANY_SURCHARGE = 0.2;

/** Below this, the undistributed excess escapes the surcharge entirely. */
export const SURCHARGE_DE_MINIMIS = 2000;

/** Residential Premises Rental Income Relief: 20% of profit, capped, income tax only. */
export const RPRIR_RATE = 0.2;
export const RPRIR_CAP = 1000;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Euro, with separators, for the sentences this module writes.
 *
 * Hard-coded rather than passed in, and that is correct here rather than
 * lazy: every rate in this file is an Irish one and an Irish tax bill is
 * denominated in euro. A caller formatting it as sterling would be formatting
 * a figure that does not exist.
 */
const euro = (value: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);

/* ------------------------------------------------------------ stamp duty */

export interface StampDutyInput {
  price: number;
  /** Part of a purchase of three or more apartments in one block — the 6% band does not apply. */
  apartmentBlock?: boolean;
  /** Part of ten or more residential units inside twelve months — 15% on the whole price. */
  bulkPurchase?: boolean;
}

export interface StampDuty {
  total: number;
  /** Each band that bit, so the figure can be checked rather than taken. */
  bands: { from: number; to: number; rate: number; amount: number }[];
  /** The rate as a share of the price, which is what people compare. */
  effectiveRate: number;
  note: string | null;
}

/**
 * Stamp duty on a residential purchase.
 *
 * Note what is *absent*: Ireland has no additional-dwelling surcharge. A
 * landlord buying a second property pays exactly what an owner-occupier pays,
 * which is the opposite of the UK's 3% (now 5%) uplift — so a UK sheet
 * carrying its surcharge across overstates the entry cost of every Irish deal,
 * typically by more than the duty itself.
 */
export function stampDuty({ price, apartmentBlock = false, bulkPurchase = false }: StampDutyInput): StampDuty {
  if (!(price > 0)) {
    return { total: 0, bands: [], effectiveRate: 0, note: null };
  }

  if (bulkPurchase) {
    return {
      total: round(price * BULK_RATE),
      bands: [{ from: 0, to: price, rate: BULK_RATE, amount: round(price * BULK_RATE) }],
      effectiveRate: BULK_RATE,
      note: "15% applies to the whole price on ten or more residential units acquired within twelve months (s31E SDCA 1999).",
    };
  }

  const bands = apartmentBlock ? APARTMENT_BANDS : STAMP_DUTY_BANDS;
  const applied: StampDuty["bands"] = [];
  let total = 0;
  let from = 0;

  for (const band of bands) {
    if (price <= from) break;
    const to = Math.min(price, band.upTo);
    const amount = round((to - from) * band.rate);
    applied.push({ from, to, rate: band.rate, amount });
    total += amount;
    from = band.upTo;
  }

  return {
    total: round(total),
    bands: applied,
    effectiveRate: round((total / price) * 10000) / 10000,
    note: apartmentBlock
      ? "Three or more apartments in one block stop at 2% — the 6% band does not reach them."
      : null,
  };
}

/* -------------------------------------------------- personal landlord tax */

export interface PersonalTaxInput {
  /** Rental profit after every allowable expense, interest included. */
  profit: number;
  /** 0.2 or 0.4 — the band this profit lands in on top of other income. */
  marginalRate?: number;
  uscRate?: number;
  prsiRate?: number;
  /**
   * Whether the tenancy is registered with the RTB.
   *
   * Not a formality. Interest relief is conditional on it, and the profit
   * handed in here was computed with the interest already deducted — so an
   * unregistered tenancy has to add it back before anything else happens.
   */
  rtbRegistered?: boolean;
  /** Interest deducted in arriving at that profit, needed only to undo it. */
  mortgageInterest?: number;
  /** Whether the landlord credit is being claimed. */
  claimRprir?: boolean;
}

export interface PersonalTax {
  taxableProfit: number;
  incomeTax: number;
  usc: number;
  prsi: number;
  /** The landlord credit, which reduces income tax only. */
  rprir: number;
  total: number;
  /** Tax as a share of the profit actually made. */
  effectiveRate: number;
  afterTax: number;
  warnings: string[];
}

export function personalRentalTax(input: PersonalTaxInput): PersonalTax {
  const {
    profit,
    marginalRate = HIGHER_RATE,
    uscRate = USC_TOP,
    prsiRate = PRSI_CLASS_S,
    rtbRegistered = true,
    mortgageInterest = 0,
    claimRprir = true,
  } = input;

  const warnings: string[] = [];

  /**
   * The cliff edge. An unregistered tenancy does not reduce the interest
   * deduction, it removes it — for the whole year, for that property — so the
   * interest already taken off in arriving at `profit` has to go back on.
   */
  const taxableProfit = rtbRegistered ? profit : profit + mortgageInterest;
  if (!rtbRegistered && mortgageInterest > 0) {
    warnings.push(
      `Without an RTB registration the full ${euro(mortgageInterest)} of interest is not deductible, so the taxable profit is that much higher.`
    );
  }

  // A loss is a loss: no tax on it, and nothing here pretends to carry it
  // forward against future years, which is a return's job and not a
  // calculator's.
  if (taxableProfit <= 0) {
    return {
      taxableProfit: round(taxableProfit),
      incomeTax: 0,
      usc: 0,
      prsi: 0,
      rprir: 0,
      total: 0,
      effectiveRate: 0,
      afterTax: round(profit),
      warnings,
    };
  }

  const incomeTaxBefore = taxableProfit * marginalRate;
  // Capped at 20% of profit and at the cash cap, and set against income tax
  // only — it does not touch USC or PRSI, and it is not refundable, so it can
  // never exceed the income tax it is reducing.
  const rprir = claimRprir ? Math.min(RPRIR_CAP, taxableProfit * RPRIR_RATE, incomeTaxBefore) : 0;
  const incomeTax = incomeTaxBefore - rprir;
  const usc = taxableProfit * uscRate;
  const prsi = taxableProfit * prsiRate;
  const total = incomeTax + usc + prsi;

  return {
    taxableProfit: round(taxableProfit),
    incomeTax: round(incomeTax),
    usc: round(usc),
    prsi: round(prsi),
    rprir: round(rprir),
    total: round(total),
    effectiveRate: profit > 0 ? round((total / profit) * 10000) / 10000 : 0,
    afterTax: round(profit - total),
    warnings,
  };
}

/* ---------------------------------------------------------- company route */

export interface CompanyTaxInput {
  profit: number;
  /** How much of the after-tax profit stays in the company. 1 is all of it. */
  retainedShare?: number;
  /** The shareholder's marginal rate on a dividend, where one is taken. */
  marginalRate?: number;
  uscRate?: number;
  prsiRate?: number;
}

export interface CompanyTax {
  corporationTax: number;
  afterCorporationTax: number;
  /** 20% of what is retained, unless the retained amount is inside the de minimis. */
  surcharge: number;
  /** Tax on the dividend in the shareholder's hands. */
  dividendTax: number;
  distributed: number;
  retained: number;
  total: number;
  /** Everything paid, as a share of the profit. */
  effectiveRate: number;
  /** What actually reaches the shareholder, plus what is left inside. */
  afterTax: number;
  notes: string[];
}

/**
 * The same profit, earned inside a close company.
 *
 * Both exits are charged, because both are real: what is retained attracts the
 * surcharge, what is distributed attracts the shareholder's marginal rate and
 * escapes the surcharge. A model that charged only one of them would make the
 * company look better than it is, which is the mistake a UK sheet carries over
 * wholesale.
 */
export function companyRentalTax(input: CompanyTaxInput): CompanyTax {
  const {
    profit,
    retainedShare = 1,
    marginalRate = HIGHER_RATE,
    uscRate = USC_TOP,
    prsiRate = PRSI_CLASS_S,
  } = input;

  const notes: string[] = [];

  if (profit <= 0) {
    return {
      corporationTax: 0,
      afterCorporationTax: round(profit),
      surcharge: 0,
      dividendTax: 0,
      distributed: 0,
      retained: round(profit),
      total: 0,
      effectiveRate: 0,
      afterTax: round(profit),
      notes,
    };
  }

  const corporationTax = profit * CORPORATION_TAX_PASSIVE;
  const afterCorporationTax = profit - corporationTax;

  const share = Math.min(1, Math.max(0, retainedShare));
  const retained = afterCorporationTax * share;
  const distributed = afterCorporationTax - retained;

  // The 7.5% reduction is a trading company's and does not reach rental
  // income, so it is deliberately absent. The de minimis does apply.
  const surcharge = retained > SURCHARGE_DE_MINIMIS ? retained * CLOSE_COMPANY_SURCHARGE : 0;
  if (retained > 0 && surcharge === 0) {
    notes.push(`Retained profit is inside the €${SURCHARGE_DE_MINIMIS} de minimis, so no surcharge applies.`);
  }
  if (surcharge > 0) {
    notes.push(
      "Distributing within 18 months of the accounting period end avoids the surcharge — but the dividend is then taxed at your own marginal rate."
    );
  }

  const dividendTax = distributed * (marginalRate + uscRate + prsiRate);
  const total = corporationTax + surcharge + dividendTax;

  return {
    corporationTax: round(corporationTax),
    afterCorporationTax: round(afterCorporationTax),
    surcharge: round(surcharge),
    dividendTax: round(dividendTax),
    distributed: round(distributed),
    retained: round(retained - surcharge),
    total: round(total),
    effectiveRate: round((total / profit) * 10000) / 10000,
    afterTax: round(profit - total),
    notes,
  };
}

/**
 * Which way round comes out better, and by how much.
 *
 * Returned as a comparison rather than a recommendation. The answer swings on
 * the shareholder's own band, on whether the money is needed now or left to
 * compound, and on things no calculator sees — a company's filing costs, its
 * effect on borrowing, what happens on an eventual sale. The arithmetic is the
 * part that can be done honestly here; the choice is not.
 */
export function comparePersonalAndCompany(
  input: PersonalTaxInput & { retainedShare?: number }
): { personal: PersonalTax; company: CompanyTax; betterBy: number; better: "personal" | "company" | "level" } {
  const personal = personalRentalTax(input);
  const company = companyRentalTax({
    profit: input.rtbRegistered === false ? personal.taxableProfit : input.profit,
    retainedShare: input.retainedShare,
    marginalRate: input.marginalRate,
    uscRate: input.uscRate,
    prsiRate: input.prsiRate,
  });

  const difference = round(company.total - personal.total);
  return {
    personal,
    company,
    betterBy: Math.abs(difference),
    better: Math.abs(difference) < 1 ? "level" : difference > 0 ? "personal" : "company",
  };
}
