import type { Account, TransactionRule } from "../api/client.js";
import { isLiability } from "./accountBalance.js";
import { distinctiveWords } from "./distinctiveWords.js";
import type { RecurringPayment } from "./recurring.js";

/**
 * A loan nothing is repaying, beside a payment nothing has claimed.
 *
 * `subscriptions()` keeps loan repayments out of the subscriptions list, but
 * only once the app has been told which payment repays which loan — a rule on
 * the loan's own account. Until then the direct debit is just a charge that
 * comes back every month, which is the exact description of a subscription,
 * and the list says so: "Direct Debit to Novuna Personal Fi · Monthly ·
 * €187.24/mo", sitting above Netflix as though stopping it were an option.
 *
 * So the one case worth speaking up about is the one where the app can see
 * both halves and nobody has joined them: a loan or card account whose balance
 * nothing is moving, and a payment on the same rhythm carrying that account's
 * own name.
 *
 * The name is what makes it a reading rather than a guess. The owner called
 * the account "Novuna" and the bank wrote "Novuna" on the payment — that is
 * evidence from two independent places, in the same spirit as
 * `statementCharges.ts` quoting the document rather than inferring from it.
 * Nothing is written until it is confirmed, and what gets written is the
 * ordinary repayment rule, not a hidden flag of this feature's own.
 */

export interface UnclaimedRepayment {
  payment: RecurringPayment;
  /** The loan or card this looks like the repayment for. */
  account: Account;
  /** The word both the account name and the payment carry. */
  matchText: string;
  /** The account the payment leaves, when every charge agrees on one. */
  fromAccountId: string | null;
}

function textOf(payment: RecurringPayment): string {
  return `${payment.label} ${payment.key}`.toLowerCase();
}

/**
 * Pairs worth offering, and only the ones that are unambiguous.
 *
 * Two refusals do the work here, and both are the same discipline
 * `nameUnnamedRows` uses in `statementCharges.ts`: where more than one answer
 * fits, picking one is inventing it.
 *
 *   A loan matching **two** recurring payments says nothing about which is the
 *   repayment — a lender charging a monthly fee alongside the instalment is
 *   the ordinary case, not a strange one.
 *
 *   A payment matching **two** loans is the same problem from the other side,
 *   which is what happens to anybody who has two cards with one bank.
 *
 * A loan already named by a rule is left alone whether or not the rule is
 * currently matching anything: the owner has answered this question, and
 * asking it again because their answer isn't working is a different prompt
 * that `RepaymentRule` already shows beside the account.
 */
export function unclaimedRepayments(
  payments: RecurringPayment[],
  accounts: Account[],
  rules: TransactionRule[]
): UnclaimedRepayment[] {
  const claimed = new Set(rules.map((rule) => rule.repays_account_id).filter(Boolean));
  const candidates = accounts.filter((account) => isLiability(account) && !account.hidden && !claimed.has(account.id));

  const hits: UnclaimedRepayment[] = [];
  for (const account of candidates) {
    const words = distinctiveWords(account.name);
    if (words.length === 0) continue;

    const matched = payments
      .map((payment) => ({ payment, word: words.find((word) => textOf(payment).includes(word)) }))
      .filter((hit): hit is { payment: RecurringPayment; word: string } => hit.word !== undefined);

    if (matched.length !== 1) continue;

    const { payment, word } = matched[0];
    const from = new Set(payment.charges.map((charge) => charge.accountId));
    hits.push({
      payment,
      account,
      matchText: word,
      // Scoped to the funding account where every charge agrees on one, which
      // is what keeps the rule safe: the same lender's name on a different
      // account is a different arrangement. Where they disagree the rule is
      // deliberately left open rather than pinned to whichever came last.
      fromAccountId: from.size === 1 ? ([...from][0] ?? null) : null,
    });
  }

  // A payment claimed by two different loans is as ambiguous as a loan with
  // two candidate payments, and is dropped for the same reason.
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.payment.key, (counts.get(hit.payment.key) ?? 0) + 1);
  return hits.filter((hit) => counts.get(hit.payment.key) === 1);
}
