/**
 * Adding several debts into one line, and reading the date off it.
 *
 * Apart from the chart that draws it, because this is the part that can be
 * wrong in a way nobody sees. A payoff date is the figure somebody plans
 * around — whether to overpay, whether to consolidate, when the money frees
 * up — and a date that is quietly a year early looks exactly like one that is
 * right.
 */

/**
 * The selected debts added together, and the month the total reaches zero.
 *
 * Each account's series stops at the month that account clears. Read as
 * missing data rather than as nothing owed, a short series would drag the
 * total's end forward and promise a debt-free date earlier than the truth —
 * so a month past the end of a series counts as zero, which is what it is.
 */
export function combine(series: number[][]): { total: number[]; clearsAt: number | null } {
  if (series.length === 0) return { total: [], clearsAt: null };

  const span = Math.max(...series.map((s) => s.length));
  const total: number[] = [];
  for (let month = 0; month < span; month++) {
    total.push(series.reduce((sum, s) => sum + (s[month] ?? 0), 0));
  }

  // Within a penny: a balance amortised to zero rarely lands exactly on it,
  // and a line that visibly touches the axis should say the debt is gone
  // rather than report a fraction of a cent still outstanding.
  const clearsAt = total.findIndex((value) => value <= 0.005);
  return { total, clearsAt: clearsAt === -1 ? null : clearsAt };
}

/** A span of months, the way somebody would say it out loud. */
export function duration(months: number | null): string {
  if (months === null) return "not within the horizon";
  if (months === 0) return "already clear";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${years} year${years === 1 ? "" : "s"}${rest ? ` ${rest} mo` : ""}`;
}
