import type { Account } from "../api/client.js";

/**
 * The accounts whose statements have stopped arriving.
 *
 * An account fed by statement import fails silently when you forget it. There
 * is no error and nothing turns red — it simply stops changing, which on
 * screen is indistinguishable from an account with nothing happening on it.
 * The same quiet failure a broken bank sync has, and the reason that one is
 * already an alert.
 *
 * What makes it answerable is that the app records two different dates about
 * an import, and only one of them is the useful one. `last_import_at` is when
 * you uploaded; `last_imported_date` is how far the statements actually
 * reach. An upload done yesterday carrying nothing newer than March means the
 * account has been fed and is still three months stale, so coverage is what
 * this measures and the upload date is only context.
 */

/**
 * How far behind coverage has to fall before it is worth saying.
 *
 * Not thirty days, though "a month behind" is the question being asked. A
 * monthly statement covering the 8th to the 7th is only issued on the 7th, so
 * coverage on a perfectly maintained account drifts to thirty-odd days old
 * every month purely by waiting for the next statement to exist. Firing at
 * thirty would mean nagging every account every month for being up to date.
 *
 * Forty is "the next statement should exist by now, and it isn't here".
 */
export const STALE_AFTER_DAYS = 40;

export interface StatementDue {
  account: Account;
  /** How far the imported statements reach. */
  coversTo: string;
  /** When the last import was actually done — context, not the measure. */
  lastImportAt: string | null;
  /** Days between `coversTo` and today. */
  daysBehind: number;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/**
 * Accounts behind on statements, worst first.
 *
 * Three kinds of account are deliberately never listed, and each omission is
 * the difference between a prompt worth reading and one worth muting:
 *
 *   **Linked accounts**, which are fed by the nightly sync and take no
 *   statements at all. When one of those goes quiet it is a sync failure or a
 *   lapsed authorisation, both of which already say so in their own words.
 *
 *   **Accounts never imported to.** An account kept by hand, or one created
 *   an hour ago, has no statement habit to be behind on. Inferring one from
 *   nothing would put every manual account on this list permanently.
 *
 *   **Hidden accounts**, which count towards nothing by the owner's own
 *   instruction.
 */
export function statementsDue(accounts: Account[], today: string, staleAfterDays = STALE_AFTER_DAYS): StatementDue[] {
  const due = accounts
    .map((account) => statementDue(account, today, staleAfterDays))
    .filter((entry): entry is StatementDue => entry !== null);

  return due.sort((a, b) => b.daysBehind - a.daysBehind || a.account.name.localeCompare(b.account.name));
}

/**
 * The same judgement for one account, which is what the Accounts page needs.
 *
 * Kept as the primitive and the list as a map over it, so the dashboard
 * widget, the alert in the bell and the flag beside the account can never
 * end up disagreeing about whether an account is behind — the same rule the
 * net worth figures live under.
 */
export function statementDue(account: Account, today: string, staleAfterDays = STALE_AFTER_DAYS): StatementDue | null {
  if (account.hidden) return null;
  if (account.source !== "manual") return null;
  // Never imported to: no habit, so nothing to be behind on.
  if (!account.last_import_at) return null;

  // Coverage is the measure. Where an import somehow brought no dated rows
  // there is nothing to measure, and the upload date would answer a different
  // question than the one being asked.
  const coversTo = account.last_imported_date;
  if (!coversTo) return null;

  const daysBehind = daysBetween(coversTo, today);
  if (!Number.isFinite(daysBehind) || daysBehind < staleAfterDays) return null;

  return { account, coversTo, lastImportAt: account.last_import_at, daysBehind };
}

/** How long it has been, in the words somebody would use. */
export function behindPhrase(daysBehind: number): string {
  const months = Math.floor(daysBehind / 30);
  if (months >= 2) return `${months} months behind`;
  return `${daysBehind} days behind`;
}
