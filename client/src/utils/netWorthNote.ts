/**
 * What the headline net worth is made of, beyond the accounts.
 *
 * The figure has never been only the accounts: policies the owner asked to
 * count, and investment holdings, join it on the same terms. The dashboard
 * card says so. The sidebar, which is the copy on screen all the time, said
 * nothing at all, and that is where it misleads.
 *
 * The shape of the mistake is specific. Hide every account but one and the
 * accounts page shows a single balance of -2,975, while the sidebar reads
 * +8,814 - because two rand policies worth about 11,790 euro are quietly
 * inside it. Both numbers are right and they cannot both be believed, so the
 * one with more in it has to say what.
 *
 * Cover is called out by name on top of that. A sum assured is what pays out
 * on death, not money anybody holds, and counting it is allowed precisely
 * because every screen that does is supposed to admit it rather than let it
 * disappear into a total.
 */

export interface NetWorthParts {
  /** Policies counted, already converted into the displayed currency. */
  policyTotal: number;
  /** Investment holdings, likewise. */
  holdingTotal: number;
  /** Names of policies counted at their cover amount rather than a cash value. */
  coverNames: string[];
  /** Formats a figure in the currency being displayed. */
  money: (value: number) => string;
}

/**
 * One line for under the figure, or null when the figure really is just the
 * accounts and there is nothing to disclose.
 */
export function netWorthNote({ policyTotal, holdingTotal, coverNames, money }: NetWorthParts): string | null {
  const parts: string[] = [];
  if (policyTotal !== 0) parts.push(`${money(policyTotal)} in policies`);
  if (holdingTotal !== 0) parts.push(`${money(holdingTotal)} in investments`);
  if (parts.length === 0) return null;

  const base = `incl. ${parts.join(" and ")}`;
  if (coverNames.length === 0) return base;

  // Named rather than counted: "one at cover" leaves somebody hunting for
  // which, and the whole point is that this figure is not money in the bank.
  const named = coverNames.length <= 2 ? coverNames.join(" and ") : `${coverNames.length} policies`;
  return `${base} — ${named} at cover, which pays out rather than being held`;
}
