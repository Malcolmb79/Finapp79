import type { Property } from "../api/client.js";

/**
 * What a property is actually doing, as a lender or a landlord would ask it.
 *
 * Four figures, and the discipline is in what each one excludes.
 *
 * **Equity** is what is owned of it: value less the mortgage. Not what was put
 * in, and not what it cost.
 *
 * **NOI** — net operating income — is rent after vacancy and after running
 * costs, and deliberately *before* the mortgage. That exclusion is the whole
 * point of the measure: it says what the building earns, which is a fact about
 * the building, separately from how it was financed, which is a fact about the
 * buyer. Fold the mortgage in and two identical houses report different
 * performance because one owner borrowed more.
 *
 * **Cap rate** is NOI over value — the yield the property throws off
 * unlevered, and the number that lets a house in one town be compared with a
 * house in another.
 *
 * **DSCR** — debt service coverage — is NOI over the mortgage payment, and is
 * the one a lender asks first. Below 1 the building does not cover its own
 * borrowing and the shortfall comes out of the owner's salary every month.
 *
 * Every one of them returns null rather than zero when the figure it needs is
 * missing. A property with no value recorded has an unknown cap rate, not a
 * cap rate of nothing, and a column of confident zeroes is how a portfolio
 * gets judged on figures nobody entered.
 */

export const PROPERTY_TYPES: { value: Property["property_type"]; label: string }[] = [
  { value: "residence", label: "Home I live in" },
  { value: "rental", label: "Single rental" },
  { value: "multi_family", label: "Multi-family" },
  { value: "commercial", label: "Commercial" },
  { value: "land", label: "Land" },
];

export interface PropertyMetrics {
  /** Value less what is owed on it. Null when no value is recorded. */
  equity: number | null;
  /** Rent after an allowance for the months it sits empty. */
  effectiveRent: number | null;
  /** Monthly net operating income: effective rent less running costs, before the mortgage. */
  noi: number | null;
  /** Annual NOI as a share of value, as a percentage. */
  capRate: number | null;
  /** NOI over the mortgage payment. Below 1 the building does not cover its own debt. */
  dscr: number | null;
  /** What is actually left each month once the mortgage is paid too. */
  cashFlow: number | null;
}

export function propertyMetrics(property: Property): PropertyMetrics {
  const value = property.market_value;
  const mortgage = property.mortgage_balance ?? 0;
  const payment = property.mortgage_payment ?? 0;
  const rent = property.monthly_rent;
  const expenses = property.monthly_expenses ?? 0;

  const equity = value === null || value === undefined ? null : value - mortgage;

  // A vacancy allowance is part of the income figure rather than a cost,
  // because an empty month does not cost money — it fails to earn it. Outside
  // 0–100 the field is nonsense and is ignored rather than applied.
  const vacancy = property.vacancy_rate ?? 0;
  const usableVacancy = vacancy >= 0 && vacancy <= 100 ? vacancy : 0;
  const effectiveRent = rent === null || rent === undefined ? null : rent * (1 - usableVacancy / 100);

  const noi = effectiveRent === null ? null : effectiveRent - expenses;

  // Guarded on the value being above zero rather than merely present: a
  // property entered with a value of nothing would otherwise produce an
  // infinite yield, which prints as "∞%" and looks like a spectacular asset.
  const capRate = noi === null || !value || value <= 0 ? null : ((noi * 12) / value) * 100;

  // No mortgage means nothing to cover, which is not a coverage of zero — and
  // not an infinitely good one either. A property that owes nothing simply has
  // no ratio, and the screen says so.
  const dscr = noi === null || payment <= 0 ? null : noi / payment;

  const cashFlow = noi === null ? null : noi - payment;

  return { equity, effectiveRent, noi, capRate, dscr, cashFlow };
}

export interface PortfolioTotals {
  value: number;
  mortgages: number;
  equity: number;
  monthlyRent: number;
  monthlyNoi: number;
  monthlyCashFlow: number;
  /** Properties whose figures were too incomplete to contribute, so a total can say so. */
  incomplete: number;
}

/**
 * The portfolio added up.
 *
 * Only properties with the figure in question contribute to that total, and
 * the count of the rest is returned rather than hidden. A portfolio NOI that
 * silently treats three un-costed houses as earning nothing is a figure that
 * understates by exactly the amount nobody has entered yet — and reads as a
 * bad portfolio rather than an unfinished one.
 */
export function portfolioTotals(properties: Property[]): PortfolioTotals {
  const totals: PortfolioTotals = {
    value: 0,
    mortgages: 0,
    equity: 0,
    monthlyRent: 0,
    monthlyNoi: 0,
    monthlyCashFlow: 0,
    incomplete: 0,
  };

  for (const property of properties) {
    const metrics = propertyMetrics(property);
    if (property.market_value) totals.value += property.market_value;
    totals.mortgages += property.mortgage_balance ?? 0;
    if (metrics.equity !== null) totals.equity += metrics.equity;
    if (metrics.effectiveRent !== null) totals.monthlyRent += metrics.effectiveRent;
    if (metrics.noi !== null) totals.monthlyNoi += metrics.noi;
    if (metrics.cashFlow !== null) totals.monthlyCashFlow += metrics.cashFlow;
    if (!property.market_value) totals.incomplete += 1;
  }

  return totals;
}

/**
 * What this property adds to net worth, which is nothing unless asked.
 *
 * Exactly the mechanism a policy uses, for a related reason. `equity` is the
 * usual answer. `value` exists for a household whose mortgage is already a
 * loan account in this app: counting the equity there would subtract the same
 * debt twice, and the screens that use the figure say which was chosen rather
 * than letting the decision disappear into a total.
 */
export function propertyContribution(property: Property): number {
  switch (property.net_worth_source) {
    case "equity":
      return propertyMetrics(property).equity ?? 0;
    case "value":
      return property.market_value ?? 0;
    default:
      return 0;
  }
}

/** True when the mortgage is deliberately excluded, so a screen can admit it. */
export function countsAtValue(property: Property): boolean {
  return property.net_worth_source === "value" && (property.mortgage_balance ?? 0) > 0;
}

/**
 * Every property's contribution, as amounts to be converted and totalled.
 *
 * Deliberately the same shape and the same name-ending as
 * `policyContributions` and `holdingContributions`, because every screen that
 * builds a net worth figure has to add all three or disagree with the ones
 * that do. A property set to count while one screen ignores it produces two
 * right numbers that cannot both be believed — which is the fault this app
 * has already been bitten by once.
 */
export function propertyContributions(properties: Property[]): { amount: number; currency: string }[] {
  return properties
    .filter((property) => property.net_worth_source !== "none")
    .map((property) => ({ amount: propertyContribution(property), currency: property.currency }))
    .filter((entry) => entry.amount !== 0);
}

/**
 * What property added to net worth on a given date, for the trend.
 *
 * A property has no valuation history the way a policy does — one figure is
 * recorded and revised in place — so there is nothing to look up for a past
 * date and the honest options are both imperfect.
 *
 * It contributes from the date it was bought onwards, at today's figure, and
 * nothing before. Projecting backwards past the purchase would show a
 * household owning a house in years it did not, which is the worse of the two
 * errors: it invents wealth. Carrying today's value back across the years it
 * *was* held overstates the past whenever the property has appreciated, which
 * is a flat line where a rising one belongs — visibly an approximation rather
 * than an invention, and the screen says so.
 *
 * A property with no purchase date recorded falls back to when it was entered
 * here, on the same reasoning.
 */
export function propertyContributionsAt(properties: Property[], date: string): { amount: number; currency: string }[] {
  return properties.flatMap((property) => {
    if (property.net_worth_source === "none") return [];
    const held = property.purchase_date ?? property.created_at?.slice(0, 10);
    if (held && date < held) return [];
    const amount = propertyContribution(property);
    return amount === 0 ? [] : [{ amount, currency: property.currency }];
  });
}

/**
 * How a DSCR reads, since the number alone means nothing to most people.
 *
 * The absent case is two different facts and has to say which. A ratio is
 * missing either because the property earns nothing — a home somebody lives in
 * — or because it owes nothing. Collapsing them printed "No mortgage to cover"
 * under a house carrying two hundred and ninety-eight thousand of one, which
 * is not a vaguer version of the truth but a different claim.
 */
export function dscrVerdict(
  dscr: number | null,
  property?: Property
): { label: string; tone: "good" | "bad" | "muted" } {
  if (dscr === null) {
    const owes = (property?.mortgage_payment ?? 0) > 0;
    const earns = (property?.monthly_rent ?? 0) > 0;
    if (property && owes && !earns) return { label: "Earns nothing, so there is no ratio to take", tone: "muted" };
    return { label: "No mortgage to cover", tone: "muted" };
  }
  if (dscr >= 1.25) return { label: "Comfortably covers its mortgage", tone: "good" };
  if (dscr >= 1) return { label: "Just covers its mortgage", tone: "good" };
  return { label: "Does not cover its mortgage", tone: "bad" };
}
