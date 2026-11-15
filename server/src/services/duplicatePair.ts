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
    .replace(/[^a-z0-9 .-]/g, "")
    .trim();
}

/**
 * The part of a description that names the merchant.
 *
 * Banks wrap the name in their own furniture: a scheme prefix like VDP- or
 * VDA- on one copy and not the other, and a trailing word such as "purchase"
 * on both. Comparing whole strings therefore fails on the pair this rule
 * exists for - one copy carries the prefix, the other does not, and the
 * truncation is in the middle rather than at the end, so neither string is a
 * prefix of the other however they are lined up.
 *
 * The longest token is the merchant in practice: the scheme codes are short,
 * the filler words are short, and what is left is the name or the domain.
 */
function merchantToken(text: string): string {
  const stripped = text.replace(/^[a-z]{2,4}-/, "");
  const tokens = stripped.split(" ").filter((t) => !FILLER.has(t));
  return tokens.reduce((longest, token) => (token.length > longest.length ? token : longest), "");
}

/** Words that appear on half the ledger and name nothing. */
const FILLER = new Set(["purchase", "payment", "pos", "card", "debit", "credit", "transaction", "ref", "to", "from"]);

/**
 * Whether one description is the other cut short.
 *
 * Tried on the whole string first, then on the merchant alone, because the
 * two copies of one payment are rarely wrapped identically. False for two
 * identical descriptions either way: identical is what two genuine repeat
 * purchases look like, and a string cut at two lengths is what one payment
 * looks like when two pipelines describe it.
 */
export function isTruncationOf(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y || x === y) return false;

  const prefixOf = (p: string, q: string) => {
    const [short, long] = p.length <= q.length ? [p, q] : [q, p];
    return short.length >= MIN_PREFIX && long.startsWith(short);
  };

  if (prefixOf(x, y)) return true;

  const left = merchantToken(x);
  const right = merchantToken(y);
  // Equal merchants with different wrapping are not evidence of anything: the
  // same shop twice in a week writes the same name twice.
  return left !== right && prefixOf(left, right);
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
