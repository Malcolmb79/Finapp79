/**
 * A month of spending as a calendar, one square per day.
 *
 * A total for a month says how much; it never says when. The shape of a month
 * — the quiet stretch, the weekend that cost more than the week around it,
 * the one day that was most of the month — is in every ledger already and
 * visible in none of them, because a list is read a row at a time and a
 * pattern is not in any single row.
 *
 * Laid out as a real calendar rather than a strip of days, since the pattern
 * people are usually looking for is weekly and only a calendar puts the
 * Saturdays under each other.
 */

export interface CalendarDay {
  date: string;
  /** Spent that day, as a positive number. Zero for a day with none. */
  amount: number;
  /** False for the leading and trailing blanks that square up the weeks. */
  inMonth: boolean;
}

export interface SpendingCalendar {
  /** Whole weeks, Monday first, padded either end so the grid is square. */
  weeks: CalendarDay[][];
  /** The heaviest day, which is what the shading is scaled against. */
  peak: number;
  total: number;
  /** The day the most went out, for naming it rather than leaving it to be hunted. */
  busiest: CalendarDay | null;
}

interface Spendable {
  amount: number;
  booking_date: string;
}

const DAY = 86_400_000;

function iso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Monday as the first column.
 *
 * `getUTCDay` counts from Sunday, and a week that starts on Sunday puts the
 * two weekend days at opposite ends of the row — which is the one pattern
 * this chart exists to make visible.
 */
function mondayIndex(time: number): number {
  return (new Date(time).getUTCDay() + 6) % 7;
}

export function spendingCalendar(transactions: Spendable[], month: string): SpendingCalendar {
  const byDay = new Map<string, number>();
  let total = 0;

  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    if (!tx.booking_date.startsWith(month)) continue;
    const spent = Math.abs(tx.amount);
    byDay.set(tx.booking_date, (byDay.get(tx.booking_date) ?? 0) + spent);
    total += spent;
  }

  const first = Date.parse(`${month}-01T00:00:00Z`);
  if (Number.isNaN(first)) return { weeks: [], peak: 0, total: 0, busiest: null };

  // The month's own length, from the first of the next one — no table of
  // month lengths and no leap-year rule to get wrong.
  const [year, index] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const next = Date.parse(index === 12 ? `${year + 1}-01-01T00:00:00Z` : `${year}-${String(index + 1).padStart(2, "0")}-01T00:00:00Z`);
  const length = Math.round((next - first) / DAY);

  const days: CalendarDay[] = [];
  // Blanks before the first, so the first lands in its real column.
  for (let i = 0; i < mondayIndex(first); i++) {
    days.push({ date: "", amount: 0, inMonth: false });
  }
  for (let d = 0; d < length; d++) {
    const date = iso(first + d * DAY);
    days.push({ date, amount: byDay.get(date) ?? 0, inMonth: true });
  }
  // Blanks after the last, so the final row is a full week.
  while (days.length % 7 !== 0) days.push({ date: "", amount: 0, inMonth: false });

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const spentDays = days.filter((day) => day.inMonth && day.amount > 0);
  const peak = spentDays.reduce((most, day) => Math.max(most, day.amount), 0);
  const busiest = spentDays.reduce<CalendarDay | null>((worst, day) => (!worst || day.amount > worst.amount ? day : worst), null);

  return { weeks, peak, total, busiest };
}

/**
 * How dark a day's square is, from 0 to 1.
 *
 * Square-rooted rather than linear. One large day — a rent payment, an annual
 * premium — otherwise sets the scale and leaves every ordinary day at the
 * palest shade, which is the opposite of what the chart is for: it would hide
 * the everyday pattern behind the one exception.
 */
export function shade(amount: number, peak: number): number {
  if (amount <= 0 || peak <= 0) return 0;
  return Math.sqrt(Math.min(1, amount / peak));
}
