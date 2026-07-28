import { db } from "../db/client.js";
import { ASSUMED_CARD_PAYMENT_EUR, type DebtInput } from "./debtStrategy.js";
import { fromBase, loadRates } from "./exchangeRates.js";

/**
 * The user's borrowing, as the simulator needs it.
 *
 * Shared rather than owned by one route: the adviser, the projections and the
 * monthly plan all have to agree about what is owed and what is being paid
 * against it, and three separate readings would eventually disagree.
 */

interface AccountRow {
  id: string;
  name: string;
  currency: string;
  account_type: string | null;
  balance: number | null;
  balance_is_manual: boolean | null;
  overdraft_limit: number | null;
  loan_rate: number | null;
  loan_monthly_payment: number | null;
  loan_end_date: string | null;
  source: string;
}

/**
 * The user's debts, as the simulator needs them.
 *
 * Mirrors the client's rule for what counts as borrowing: a negative balance
 * whatever the account is called. Balances come from the same place the
 * Accounts page reads them from, so the advisor and the screen can't disagree.
 *
 * @param everythingBorrowable Keeps accounts that currently owe nothing: those
 *   with an untouched facility, and cards and loans regardless of balance. The
 *   charts want those, because the Debt Planner lists them and an account
 *   present in the table but absent from the charts reads as a bug — and
 *   because a card with no balance recorded disappearing without explanation
 *   is indistinguishable from the app having lost it.
 *
 *   The adviser does not: an account owing nothing is not something to plan a
 *   payoff for, and listing it among the debts would mislead.
 */
export async function loadDebts(userId: string, everythingBorrowable = false): Promise<DebtInput[]> {
  // Converted once here rather than per simulation, so every projection and
  // every answer the adviser gives uses the same figure for a given card.
  const rates = await loadRates("EUR");

  const accounts = (await db
    .prepare("SELECT * FROM accounts WHERE user_id = ?")
    .all(userId)) as unknown as AccountRow[];

  const sums = (await db
    .prepare("SELECT account_id, SUM(amount) AS total FROM transactions WHERE user_id = ? GROUP BY account_id")
    .all(userId)) as unknown as { account_id: string; total: number }[];
  const byAccount = new Map(sums.map((s) => [s.account_id, Number(s.total)]));

  return accounts
    .map((a) => {
      const derived = byAccount.get(a.id) ?? 0;
      const balance =
        a.balance_is_manual && a.balance != null
          ? a.balance
          : a.source === "enablebanking" && a.balance != null
            ? a.balance
            : derived;
      return { account: a, owed: Math.max(0, -balance) };
    })
    .filter(({ account, owed }) => {
      if (owed > 0) return true;
      if (!everythingBorrowable) return false;
      const type = account.account_type ?? "current";
      return (account.overdraft_limit ?? 0) > 0 || type === "credit_card" || type === "loan";
    })
    .map(({ account, owed }) => ({
      id: account.id,
      name: account.name,
      balance: owed,
      rate: account.loan_rate ?? 0,
      minimumPayment: account.loan_monthly_payment ?? 0,
      currency: account.currency,
      type: (account.account_type ?? "current") as DebtInput["type"],
      // Falls back to the euro figure when rates are unavailable. That is
      // wrong for a rand card, but it is wrong by a knowable amount and only
      // while the rate provider is down — better than refusing to project.
      assumedCardPayment:
        fromBase(ASSUMED_CARD_PAYMENT_EUR, account.currency, rates) ?? ASSUMED_CARD_PAYMENT_EUR,
    }));
}
