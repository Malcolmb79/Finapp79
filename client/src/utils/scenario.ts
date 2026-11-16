import { DEFAULT_REAL_RETURN, DEFAULT_WITHDRAWAL_RATE, projectFire, type FireResult } from "./fire.js";

/**
 * Three futures, side by side.
 *
 * Every projection in this app runs from where the household actually is. The
 * question this answers is the other one: what happens *if* — if the rent goes
 * up, if the second income starts, if the car is bought outright, if the debt
 * is cleared first. Those are not predictions and they are not advice. They
 * are the same arithmetic run on different inputs, which is the only honest
 * way to compare two choices that have not been made yet.
 *
 * The design is deliberately narrow. Four deltas — income, expenses, assets,
 * debt — because those are the four things a life decision actually moves, and
 * because a planner with twenty inputs is one nobody finishes filling in. Each
 * scenario starts from the real baseline rather than from blank fields, so the
 * comparison is against the household as it is rather than against a guess.
 *
 * One subtlety that is a toggle rather than an assumption: whether an asset
 * change counts towards financial independence. Thirty thousand into an index
 * fund brings the date forward; thirty thousand of equity in a house you live
 * in does not, because it does not pay for groceries. A planner that treated
 * those identically would quietly promise an earlier retirement than the one
 * on offer, so it asks.
 */

export interface Baseline {
  netWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  /** Investments and savings — what funds independence. Never the home. */
  investable: number;
  realReturn?: number;
  withdrawalRate?: number;
}

export interface ScenarioChange {
  name: string;
  /** Per month, signed. */
  incomeChange: number;
  /** Per month, signed. A rise in outgoings is positive. */
  expenseChange: number;
  /** One-off, signed. */
  assetChange: number;
  /** One-off, signed. Taking on more borrowing is positive. */
  debtChange: number;
  /** Whether the asset change can be drawn on in retirement. Off by default. */
  assetIsInvestable?: boolean;
}

export interface ScenarioResult {
  name: string;
  netWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyCashFlow: number;
  investable: number;
  annualExpenses: number;
  fire: FireResult;
  /** Against the baseline, so a scenario can say what it changed rather than only what it is. */
  delta: {
    netWorth: number;
    cashFlow: number;
    fireTarget: number;
    /** Months earlier, so positive is better. Null when either side never arrives. */
    fireMonths: number | null;
  };
}

export const EMPTY_CHANGE: Omit<ScenarioChange, "name"> = {
  incomeChange: 0,
  expenseChange: 0,
  assetChange: 0,
  debtChange: 0,
  assetIsInvestable: false,
};

/** The household exactly as it is, expressed as a scenario so it can sit in the same row. */
export function baseScenario(baseline: Baseline, name = "Now"): ScenarioResult {
  return applyScenario(baseline, { name, ...EMPTY_CHANGE });
}

export function applyScenario(baseline: Baseline, change: ScenarioChange, against?: ScenarioResult): ScenarioResult {
  const monthlyIncome = baseline.monthlyIncome + change.incomeChange;
  const monthlyExpenses = baseline.monthlyExpenses + change.expenseChange;
  const monthlyCashFlow = monthlyIncome - monthlyExpenses;

  // Debt taken on reduces net worth by its face value; debt cleared raises it.
  // Nothing here models the interest, deliberately — a slider that silently
  // added an interest cost nobody entered would be inventing a figure, and the
  // Debt Planner is where borrowing is modelled properly.
  const netWorth = baseline.netWorth + change.assetChange - change.debtChange;
  const investable = Math.max(0, baseline.investable + (change.assetIsInvestable ? change.assetChange : 0));

  const annualExpenses = Math.max(0, monthlyExpenses * 12);
  const fire = projectFire({
    investable,
    // Passed through with its sign, deficit and all. Clamping it to zero here
    // looked safer and was worse: the projection then reported a scenario that
    // spends eight thousand a month more than it earns as merely "too slow",
    // because the pot still compounds. The deficit is the reason, and only the
    // signed figure carries it. projectFire refuses a negative outright.
    monthlySaving: monthlyCashFlow,
    annualExpenses,
    realReturn: baseline.realReturn ?? DEFAULT_REAL_RETURN,
    withdrawalRate: baseline.withdrawalRate ?? DEFAULT_WITHDRAWAL_RATE,
  });

  const reference = against ?? null;
  return {
    name: change.name,
    netWorth,
    monthlyIncome,
    monthlyExpenses,
    monthlyCashFlow,
    investable,
    annualExpenses,
    fire,
    delta: {
      netWorth: netWorth - (reference?.netWorth ?? netWorth),
      cashFlow: monthlyCashFlow - (reference?.monthlyCashFlow ?? monthlyCashFlow),
      fireTarget: fire.target - (reference?.fire.target ?? fire.target),
      fireMonths:
        reference === null || reference.fire.months === null || fire.months === null
          ? null
          : reference.fire.months - fire.months,
    },
  };
}

/**
 * How much better or worse off, in one sentence.
 *
 * The date is the headline people reach for, so it leads — but only where
 * there is one on both sides. "Four years earlier" against a baseline that
 * never arrives is not four years of anything.
 */
export function scenarioVerdict(result: ScenarioResult, money: (value: number) => string): string {
  const parts: string[] = [];
  const { fireMonths, cashFlow, netWorth } = result.delta;

  if (fireMonths !== null && fireMonths !== 0) {
    const months = Math.abs(fireMonths);
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const span = years === 0 ? `${rest} mo` : rest === 0 ? `${years} yr` : `${years} yr ${rest} mo`;
    parts.push(`${span} ${fireMonths > 0 ? "sooner" : "later"}`);
  }
  if (Math.round(cashFlow) !== 0) {
    parts.push(`${money(Math.abs(cashFlow))} a month ${cashFlow > 0 ? "more" : "less"}`);
  }
  if (Math.round(netWorth) !== 0) {
    parts.push(`${money(Math.abs(netWorth))} ${netWorth > 0 ? "better" : "worse"} off today`);
  }

  return parts.length === 0 ? "No different from where you are" : parts.join(" · ");
}
