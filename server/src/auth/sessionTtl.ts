/**
 * How long a session lasts.
 *
 * Ported from theultracyclist, which pairs this with a cookie carrying no
 * Max-Age. The two together are the point: the cookie dies when the browser
 * or app closes, and the server-side expiry ends it after this long anyway —
 * so opening the app asks for a passkey rather than resuming a session issued
 * days ago.
 *
 * Before this, the cookie was a persistent seven-day one. That is why a
 * second window, a reopened tab, or a different day all walked straight in:
 * a week-long cookie is a week-long session, wherever it is presented from.
 *
 * What it still cannot do — and no cookie setting can — is ask again in a new
 * window while the browser is open. Every window and tab of one browser
 * shares one cookie jar, so a second window is the same session by
 * definition. What this gets you is re-authentication after the app is
 * closed, and after this many minutes of not using it.
 *
 * Capped rather than trusted: a typo that reads as 100000 minutes would be a
 * ten-week session on a financial account, which is worse than any value
 * someone would set on purpose.
 */

const DEFAULT_SESSION_TTL_MINUTES = 60;
const MAX_SESSION_TTL_MINUTES = 1440; // a day

export function sessionTtlMs(): number {
  const configured = Number(process.env.SESSION_TTL_MINUTES);
  const minutes =
    Number.isFinite(configured) && configured > 0
      ? Math.min(configured, MAX_SESSION_TTL_MINUTES)
      : DEFAULT_SESSION_TTL_MINUTES;
  return minutes * 60 * 1000;
}
