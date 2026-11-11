import { cleanDescription } from "./cleanDescription.js";
import { detectRecurring, merchantKey, type Cadence, type RecurringPayment } from "./recurring.js";

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
/**
 * Regular income the owner has declared, rather than income inferred.
 *
 * Detection needs three credits of a consistent amount before it believes in
 * a salary. Someone who has just started a job, changed employer, or is paid
 * from more than one place therefore gets a projection whose line only ever
 * falls — and waiting three months to be believed is a poor answer when they
 * knew on day one. Filing the pay into a category marked as income says it
 * outright, and this is what reads that.
 *
 * One entry per merchant, so two jobs stay two incomes rather than averaging
 * into one that matches neither. The amount is the most recent payment, not
 * the mean: a raise should show up next month, not be diluted by the year
 * before it.
 *
 * The cadence comes from the spacing when there are two payments to measure,
 * and is monthly otherwise. That default is a guess and the only one here —
 * it is made because the alternative is projecting no income at all from a
 * salary the owner has explicitly pointed at, which is worse.
 */
export function declaredIncome(
  transactions: Parameters<typeof detectRecurring>[0],
  isIncomeCategory: (categoryId: number | null | undefined) => boolean
): RecurringPayment[] {
  const byMerchant = new Map<string, { charges: { date: string; amount: number }[]; label: string }>();

  for (const tx of transactions) {
    if (tx.amount <= 0) continue;
    if (!isIncomeCategory(tx.category_id)) continue;
    const key = merchantKey(tx);
    // The same guard detection uses: a merchant with no readable name would
    // otherwise collect every other nameless credit into one income.
    if (key.length < 3) continue;

    const entry = byMerchant.get(key) ?? { charges: [], label: cleanDescription(tx.description) || key };
    entry.charges.push({ date: tx.booking_date, amount: tx.amount });
    byMerchant.set(key, entry);
  }

  const incomes: RecurringPayment[] = [];
  for (const [key, entry] of byMerchant) {
    const charges = [...entry.charges].sort((a, b) => a.date.localeCompare(b.date));
    const latest = charges[charges.length - 1];
    if (!latest || latest.amount <= 0) continue;

    const cadence = cadenceFromDates(charges.map((charge) => charge.date));
    const annualised = latest.amount * PER_YEAR[cadence];

    incomes.push({
      key,
      label: entry.label,
      cadence,
      // The most recent payment, not the mean: a raise should show next
      // month rather than being diluted by the year before it.
      amount: latest.amount,
      occurrences: charges.length,
      lastCharged: latest.date,
      annualised,
      monthly: annualised / 12,
      charges,
    });
  }

  return incomes;
}

/** How often each cadence comes round, for annualising a declared income. */
const PER_YEAR: Record<Cadence, number> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };

/**
 * Monthly unless the spacing says otherwise.
 *
 * The default is the only guess in here, and it is made deliberately: the
 * alternative is projecting nothing at all from a salary the owner has
 * explicitly pointed at, which is worse than assuming the commonest pay
 * cycle. Two payments are enough to measure instead of assume.
 */
function cadenceFromDates(dates: string[]): Cadence {
  if (dates.length < 2) return "monthly";
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push((Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`)) / 86_400_000);
  }
  const typical = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  // Fortnightly pay has no cadence of its own here, and rounds to weekly
  // rather than monthly — a fortnightly salary projected monthly would show
  // half the income actually arriving.
  if (typical <= 18) return "weekly";
  if (typical <= 45) return "monthly";
  if (typical <= 150) return "quarterly";
  return "yearly";
}

export function forecastBalance(
  transactions: Parameters<typeof detectRecurring>[0],
  openingBalance: number,
  { from, days, isIncomeCategory }: { from: string; days: number; isIncomeCategory?: (id: number | null | undefined) => boolean }
): Forecast {
  const until = addDays(from, days);

  const outgoings = detectRecurring(transactions);
  const detected = detectRecurring(transactions, { direction: "in" });

  /**
   * Declared income wins over detected for the same merchant.
   *
   * Both describe the same payments, and the owner's own statement is the
   * better authority — it carries the current amount rather than one averaged
   * across a period that may include a raise. Merchants only detection found
   * are kept: marking one category as income is not a claim that nothing else
   * is.
   */
  const declared = isIncomeCategory ? declaredIncome(transactions, isIncomeCategory) : [];
  const declaredKeys = new Set(declared.map((entry) => entry.key));
  const income = [...declared, ...detected.filter((entry) => !declaredKeys.has(entry.key))];

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
