/**
 * When a savings goal lands, given what is actually left over each month.
 *
 * A target with a date on it is a wish until something checks it against the
 * money. The arithmetic looked easy enough to do by hand - what is left, over
 * what is needed - and doing it by hand got it wrong twice, in the same
 * direction both times, because the surplus is not a constant.
 *
 * **Debts clearing is most of the saving.** Every debt that finishes hands its
 * monthly payment back, so the amount going into the pot steps up each time
 * one clears. On this household the surplus more than doubles between the
 * first month and the month the last loan finishes, and a projection at
 * today's figure puts the goal most of a year late.
 *
 * **A pot that is also the emergency fund cannot be spent to zero.** If the
 * same money absorbs the unplanned, reaching the target and handing all of it
 * over leaves nothing behind. The buffer is part of what has to be saved, not
 * a detail, and it moves the date by months.
 *
 * So the projection walks month by month rather than dividing, and takes the
 * buffer, the draws and any one-off out of the pot as it goes.
 */

export interface FreedPayment {
  name: string;
  /** What stops going out each month once this clears. */
  monthlyPayment: number;
  /** Months from now, as the payoff simulation reports it. */
  monthCleared: number;
}

export interface GoalForecastInput {
  target: number;
  current: number;
  /** Left over each month today, before any debt has cleared. */
  surplusNow: number;
  freed?: FreedPayment[];
  /**
   * Held back rather than spent on the goal, because the pot is also what
   * absorbs the unplanned. Added to the target: the goal is reached when the
   * pot can cover both.
   */
  buffer?: number;
  /** The share of the surplus that really reaches the pot, 0 to 1. */
  share?: number;
  /** Taken out over a year for the unplanned, spread evenly. */
  drawPerYear?: number;
  /** A single planned withdrawal, such as a car deposit. */
  oneOff?: { monthsFromNow: number; amount: number };
}

export interface GoalMilestone {
  month: number;
  name: string;
  /** What goes in each month once this one has cleared. */
  savingAfter: number;
}

export interface GoalForecast {
  /** Months from now, or null when it never gets there. */
  months: number | null;
  /** The month it lands, as YYYY-MM, or null. */
  reachedIn: string | null;
  /** What has to be saved in total, target plus any buffer. */
  effectiveTarget: number;
  /** The pot at the end of each month, for drawing the curve. */
  potByMonth: number[];
  /**
   * Months in which nothing could be set aside, because the month spent more
   * than it brought in.
   *
   * Reported rather than folded into the date. A deficit does not empty a
   * savings pot - it is funded by borrowing, and shows up as debt growing
   * somewhere else - so the pot stays where it is and the months are counted
   * here instead. A projection that quietly let the pot go negative would be
   * drawing a savings curve of money nobody has.
   */
  deficitMonths: number;
  milestones: GoalMilestone[];
  /** Set when it never gets there, saying why. */
  reason?: string;
}

/** Fifty years. Past that it is not a plan, and the loop has to stop. */
const MAX_MONTHS = 600;

function addMonths(from: Date, count: number): string {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + count;
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function forecastGoal(input: GoalForecastInput, now = new Date()): GoalForecast {
  const share = input.share ?? 1;
  const buffer = input.buffer ?? 0;
  const effectiveTarget = Math.round((input.target + buffer) * 100) / 100;
  const freed = [...(input.freed ?? [])].sort((a, b) => a.monthCleared - b.monthCleared);
  const monthlyDraw = (input.drawPerYear ?? 0) / 12;

  const milestones: GoalMilestone[] = [];
  const potByMonth: number[] = [input.current];
  let pot = input.current;
  let deficitMonths = 0;

  // Already there. Worth answering rather than walking a loop to find out.
  if (pot >= effectiveTarget) {
    return { months: 0, reachedIn: addMonths(now, 0), effectiveTarget, potByMonth, deficitMonths, milestones };
  }

  for (let month = 1; month <= MAX_MONTHS; month++) {
    // Every debt cleared by now has handed its payment back.
    const released = freed.filter((f) => f.monthCleared < month).reduce((sum, f) => sum + f.monthlyPayment, 0);
    const surplus = input.surplusNow + released;
    const saved = surplus * share - monthlyDraw;

    if (saved < 0) deficitMonths++;
    pot += saved;
    if (input.oneOff && input.oneOff.monthsFromNow === month) pot -= input.oneOff.amount;
    // Never below empty. A pot that has run out cannot keep paying for a
    // deficit; the shortfall is borrowed, and borrowing is debt rather than
    // negative savings.
    pot = Math.max(0, pot);
    potByMonth.push(Math.round(pot * 100) / 100);

    for (const f of freed) {
      if (f.monthCleared === month - 1) {
        milestones.push({ month, name: f.name, savingAfter: Math.round(saved * 100) / 100 });
      }
    }

    if (pot >= effectiveTarget) {
      return { months: month, reachedIn: addMonths(now, month), effectiveTarget, potByMonth, deficitMonths, milestones };
    }
  }

  // Why it never gets there, in the terms somebody can act on.
  const finalSurplus = input.surplusNow + freed.reduce((sum, f) => sum + f.monthlyPayment, 0);
  const reason =
    finalSurplus * share - monthlyDraw <= 0
      ? "Nothing is left over each month once the unplanned is taken out, so the pot never grows."
      : "At this rate the target is further away than fifty years.";

  return { months: null, reachedIn: null, effectiveTarget, potByMonth, deficitMonths, milestones, reason };
}
