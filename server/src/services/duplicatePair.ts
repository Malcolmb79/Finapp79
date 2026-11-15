/**
 * Whether two stored rows are the same payment twice.
 *
 * The delete route will remove a synced transaction only when the server has
 * satisfied itself that a second copy exists — a client asking nicely is not
 * enough, or the rule that synced rows stay put would be a suggestion. This is
 * that check.
 *
 * It began as "same account, same day, same amount", which is the shape a
 * statement import and a bank sync produce when they both pick up one payment.
 * It missed the commoner shape entirely. A bank announces a card payment and
 * then records it: a day apart, each with its own reference, and described by
 * two pipelines that cut the string at different lengths — "help.hbomax.co"
 * against "help.hbomax.com". The screen offered those to be removed and the
 * server refused them, which is the worst of both answers.
 *
 * The widened rule mirrors the one the screen uses. Deliberately so: a
 * duplicate the user is shown and a duplicate the server will delete have to
 * be the same set, and they live apart because the two halves share no code.
 * Changing one means changing the other, and the tests on both sides say so.
 */

/** How far apart two copies of one payment can be booked. */
export const NEAR_DAYS = 4;

/** The shortest prefix that can identify a merchant rather than half the ledger. */
const MIN_PREFIX = 6;

function normalise(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 .]/g, "")
    .trim();
}

/**
 * Whether one description is the other cut short.
 *
 * False for two identical strings, and that is the point. Identical is what
 * two genuine repeat purchases look like — the same shop, the same price, two
 * days running. A string cut at two different lengths is one payment described
 * twice.
 */
export function isTruncationOf(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y || x === y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= MIN_PREFIX && long.startsWith(short);
}

/** Whole days between two ISO dates, however they are ordered. */
export function daysApart(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.abs(Math.round(ms / 86_400_000));
}

export interface PairCandidate {
  booking_date: string;
  description: string | null;
}

/**
 * Whether `other` is a second copy of `row`.
 *
 * The caller has already narrowed to the same account, the same amount and a
 * different id; what is left to decide is the date and the description. Same
 * day asks nothing of the description, because a date and an amount matching
 * exactly is already the strong case. Days apart has to clear the higher bar.
 */
export function isDuplicatePair(row: PairCandidate, other: PairCandidate): boolean {
  const gap = daysApart(row.booking_date, other.booking_date);
  if (gap === 0) return true;
  return gap <= NEAR_DAYS && isTruncationOf(row.description, other.description);
}
