import type { Account, Policy } from "../api/client.js";

/**
 * The number that tells one account or policy from another, shortened.
 *
 * Two current accounts at the same bank, or two death benefits on one
 * schedule, are told apart by their number and nothing else — a name is
 * whatever someone typed, and "Current account" twice is the normal case
 * rather than a mistake.
 *
 * Only the tail is shown. The last few characters are the part anybody
 * recognises and the part a bank itself quotes back; the rest is a full
 * account identifier, which is worth keeping off a screen that may be sitting
 * open in a room, shared with a household member, or caught in a screenshot.
 * Nothing is hidden by it — the whole value is still on the record and still
 * editable.
 */

const TAIL = 4;

/** The shortened form of an identifier, or null when there is nothing to show. */
export function shortRef(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").replace(/\s+/g, "");
  if (trimmed.length === 0) return null;
  // Short enough already to be no more revealing whole than in part: a
  // benefit number like "4" would become "••••4", which says less and looks
  // like something is being withheld.
  if (trimmed.length <= TAIL) return trimmed;
  return `••${trimmed.slice(-TAIL)}`;
}

export function accountRef(account: Pick<Account, "iban">): string | null {
  return shortRef(account.iban);
}

export function policyRef(policy: Pick<Policy, "policy_number">): string | null {
  return shortRef(policy.policy_number);
}
