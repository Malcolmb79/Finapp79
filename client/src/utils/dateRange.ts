export type DateRange = "all" | "month" | "30" | "60" | "90" | "year";

export const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "month", label: "This month" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
  { value: "year", label: "Last year" },
];

export function dateRangeLabel(range: DateRange): string {
  return DATE_RANGES.find((r) => r.value === range)?.label ?? "All time";
}

/**
 * The earliest booking date a range includes, as an ISO date, or null for all.
 *
 * "This month" is the calendar month rather than 30 days back, because that is
 * what it says: on the 3rd it means three days, not five weeks. The day counts
 * are the opposite — a rolling window that ignores where the month boundary
 * falls, which is what makes them comparable week to week.
 */
export function rangeStart(range: DateRange, now = new Date()): string | null {
  if (range === "all") return null;
  if (range === "month") return `${now.toISOString().slice(0, 7)}-01`;
  const days = range === "year" ? 365 : Number(range);
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Transactions booked within a range.
 *
 * This belongs only to figures that describe a period — what was spent, what
 * came in, how a category moved. It must never reach a balance.
 *
 * A balance is a position, not a period: it is derived from an account's whole
 * history, so handing it thirty days of transactions doesn't show thirty days
 * of balance, it shows a wrong balance. On a manual account the effect is
 * severe — the figure becomes the sum of one month's activity and nothing
 * else — and it is silent, because a wrong balance looks exactly like a right
 * one. Dashboard keeps the two lists apart for this reason.
 */
export function withinRange<T extends { booking_date: string }>(transactions: T[], range: DateRange, now = new Date()): T[] {
  const start = rangeStart(range, now);
  if (!start) return transactions;
  return transactions.filter((tx) => tx.booking_date >= start);
}

/**
 * A range expressed as whole months, for charts bucketed by month.
 *
 * A month-bucketed chart can't honour a 30-day window exactly — its smallest
 * unit is a month — so a day range maps to the number of buckets that covers
 * it. The approximation is only ever in the chart's favour: it shows slightly
 * more than asked for rather than cutting a bucket short, which would drop
 * real spending off the end of a bar.
 */
export function rangeMonthCount(range: DateRange): number | null {
  switch (range) {
    case "all":
      return null;
    case "month":
      return 1;
    case "year":
      return 12;
    default:
      return Math.ceil(Number(range) / 30);
  }
}
