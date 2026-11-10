import { detectRecurring, type Cadence, type RecurringPayment } from "./recurring.js";

/**
 * What is going to happen to the balance, from what keeps happening.
 *
 * Everything else in this app reports: here is what you spent, here is what
 * you owe. This is the one view that answers the question people actually
 * open a banking app to ask — will there be enough before payday — and it
 * needs no new machinery, only the recurring detection that already finds the
 * standing commitments and the balances that are already known.
 *
 * It is a projection and says so everywhere it surfaces. It knows about what
 * repeats; it knows nothing about the week you decide to replace a boiler.
 * The honest framing is "if nothing unusual happens", and the figure is worth
 * having precisely because the unusual is what you are trying to leave room
 * for.
 */

const DAY = 86_400_000;

const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  monthly: 30.4,
  quarterly: 91,
  yearly: 365,
};

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  return addDays(iso, days);
}

export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * A commitment's next few due dates, counting forward from its last charge.
 *
 * Stepping from the last charge rather than from today is what keeps the day
 * of the month right: rent charged on the 3rd stays on the 3rd, where "every
 * 30.4 days from now" would drift off it within two months.
 *
 * A commitment whose last charge is already older than its own cadence is
 * overdue or finished, and this catches up to the present rather than
 * projecting a run of dates that have been and gone.
 */
export function nextDueDates(payment: { cadence: Cadence; lastCharged: string }, from: string, until: string): string[] {
  const step = CADENCE_DAYS[payment.cadence];
  const dates: string[] = [];

  let due = addDays(payment.lastCharged, step);
  // A cap rather than a while(true): a corrupt date would otherwise spin here
  // forever, and no cadence produces more than a few hundred dates in a year.
  for (let guard = 0; guard < 400; guard++) {
    if (due > until) break;
    if (due >= from) dates.push(due);
    due = addDays(due, step);
  }

  return dates;
}

export interface UpcomingBill {
  key: string;
  label: string;
  dueDate: string;
  /** Positive — what leaves the account. */
  amount: number;
  cadence: Cadence;
  /** How many times it has actually been charged, so "likely" can be judged. */
  occurrences: number;
}

/**
 * What is due between two dates, soonest first.
 *
 * Only ever drawn from what has charged at least three times, because that is
 * what `detectRecurring` will vouch for — a bill predicted off one past
 * payment is a guess dressed as a commitment.
 */
export function upcomingBills(
  transactions: Parameters<typeof detectRecurring>[0],
  { from, until }: { from: string; until: string }
): UpcomingBill[] {
  const bills: UpcomingBill[] = [];

  for (const payment of detectRecurring(transactions)) {
    for (const dueDate of nextDueDates(payment, from, until)) {
      bills.push({
        key: `${payment.key}:${dueDate}`,
        label: payment.label,
        dueDate,
        amount: payment.amount,
        cadence: payment.cadence,
        occurrences: payment.occurrences,
      });
    }
  }

  return bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.amount - a.amount);
}

export interface ForecastPoint {
  date: string;
  balance: number;
}

export interface Forecast {
  points: ForecastPoint[];
  /** The worst it gets, which is the figure the whole view exists to show. */
  low: ForecastPoint | null;
  /** Commitments the projection is built from, so it can say how much it knows. */
  commitments: number;
  /** Regular income it found. None means the line only ever goes down. */
  incomeFound: boolean;
}

/**
 * The balance day by day, from today's figure and what repeats.
 *
 * Income is detected the same way outgoings are, rather than assumed from an
 * average: a salary is a recurring credit, and finding it the same way means
 * the forecast is wrong in the same direction for both sides instead of
 * pairing measured outgoings with an invented income.
 *
 * When no regular income is found the line only falls, and that is reported
 * rather than patched — a forecast quietly missing the salary would show a
 * household running out of money every month.
 */
export function forecastBalance(
  transactions: Parameters<typeof detectRecurring>[0],
  openingBalance: number,
  { from, days }: { from: string; days: number }
): Forecast {
  const until = addDays(from, days);

  const outgoings = detectRecurring(transactions);
  const income = detectRecurring(transactions, { direction: "in" });

  const movements = new Map<string, number>();
  const add = (date: string, amount: number) => movements.set(date, (movements.get(date) ?? 0) + amount);

  for (const payment of outgoings) {
    for (const date of nextDueDates(payment, from, until)) add(date, -payment.amount);
  }
  for (const payment of income) {
    for (const date of nextDueDates(payment, from, until)) add(date, payment.amount);
  }

  const points: ForecastPoint[] = [];
  let balance = openingBalance;
  let low: ForecastPoint | null = null;

  for (let offset = 0; offset <= days; offset++) {
    const date = addDays(from, offset);
    balance += movements.get(date) ?? 0;
    const point = { date, balance };
    points.push(point);
    // Strictly less, so the low is the first day it reaches its worst rather
    // than the last — which is the day worth naming.
    if (low === null || balance < low.balance) low = point;
  }

  return { points, low, commitments: outgoings.length, incomeFound: income.length > 0 };
}

/** Re-exported so callers need only this module to work with a projection. */
export type { RecurringPayment };
