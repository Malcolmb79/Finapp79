/**
 * Where a category ends the month if it carries on as it has started.
 *
 * The budget alerts already fire at ninety per cent of a limit and again when
 * it is passed, which is accurate and late. A category that will finish the
 * month at four times its limit looks fine on the fourth, says nothing on the
 * tenth, and announces itself once the money is gone - at which point the only
 * available action is to feel bad about it.
 *
 * Pace is the thing worth knowing while there is still a month to act in. It
 * is a crude projection on purpose: spending to date, spread across the days
 * so far, carried to the end of the month. Nothing here tries to model a rent
 * day or a weekly shop, because a category's own rhythm is exactly what a
 * person already knows and the app does not.
 *
 * Two guards keep it from crying wolf:
 *
 * - **Early days are ignored.** One supermarket run on the 2nd projects to
 *   fifteen times itself, which is arithmetic rather than information.
 * - **Already over the limit says nothing new.** That is the existing alert's
 *   job, and two warnings about one category is how a bell gets ignored.
 */

/** Before this day of the month, a projection is mostly noise. */
export const EARLIEST_DAY = 6;

/**
 * How far over the limit a pace has to point before it is worth saying.
 *
 * Ten per cent: a category tracking a little above its line is the ordinary
 * state of a budget, and a warning for it would fire on most categories most
 * months.
 */
export const PACE_TOLERANCE = 1.1;

export interface Pace {
  /** Where the month ends at this rate. */
  projected: number;
  /** Projected spend as a share of the limit. */
  ratio: number;
  /** True when this is worth telling somebody about today. */
  worthSaying: boolean;
}

/**
 * @param spent What has gone out of this category so far this month, positive.
 * @param limit The monthly cap, positive.
 * @param now Any date inside the month being judged.
 */
export function budgetPace(spent: number, limit: number, now = new Date()): Pace | null {
  if (!(limit > 0) || !(spent > 0)) return null;

  const day = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projected = Math.round((spent / day) * daysInMonth * 100) / 100;
  const ratio = projected / limit;

  const worthSaying =
    day >= EARLIEST_DAY &&
    // The rest of the month still has to be able to matter.
    day < daysInMonth &&
    spent < limit &&
    ratio >= PACE_TOLERANCE;

  return { projected, ratio, worthSaying };
}
