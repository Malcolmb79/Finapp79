/**
 * How long a bank's permission has left.
 *
 * A linked account stops updating roughly a quarter after it was linked,
 * because ninety days is as long as the regulations allow a consent to run.
 * Nothing about that is visible from the outside: the transactions simply
 * stop, which looks exactly like a quiet month.
 *
 * So this is said twice and early — a fortnight's warning while reconnecting
 * is a small job, and plainly once it has lapsed.
 */

/** Far enough ahead to act on, close enough that saying it means something. */
export const ACCESS_WARN_DAYS = 14;

export type AccessState = { state: "expired"; days: number } | { state: "expiring"; days: number } | null;

export function bankAccess(validUntil: string | null | undefined, now = new Date()): AccessState {
  if (!validUntil) return null;
  const expiry = Date.parse(validUntil);
  if (Number.isNaN(expiry)) return null;

  const days = Math.ceil((expiry - now.getTime()) / 86_400_000);
  if (days <= 0) return { state: "expired", days };
  if (days <= ACCESS_WARN_DAYS) return { state: "expiring", days };
  // Nothing to say for most of the ninety days, which is the point: a warning
  // that is always on screen is not a warning.
  return null;
}
