import type { Transaction } from "../api/client.js";
import { cleanDescription } from "./cleanDescription.js";
import { merchantKey } from "./recurring.js";

/**
 * The other transactions from the same merchant.
 *
 * One correction is almost never about one row. Filing a merchant under the
 * right category, or giving it a name a person would recognise, is a statement
 * about every transaction from that merchant — and making somebody repeat it
 * forty times is how a category stays wrong, because the cost of fixing it
 * comes to exceed the cost of living with it.
 *
 * "Same merchant" is `merchantKey`, already used to spot subscriptions and
 * price rises: the cleaned name with digits and punctuation stripped, so the
 * till reference that differs between two visits to the same shop doesn't
 * split them into two merchants.
 *
 * Reusing that key matters beyond saving code. If this screen decided
 * similarity differently from the way the recurring-payments screen does, two
 * parts of the app would disagree about what counts as one merchant, and
 * neither would be wrong in a way anybody could see.
 */

/** The key to match on, taken before any edit so a rename can still find its siblings. */
export function matchKey(transaction: Pick<Transaction, "description" | "counterparty">): string {
  return merchantKey({ description: transaction.description, counterparty: transaction.counterparty ?? null });
}

/**
 * Transactions a change would actually alter, excluding the one being edited.
 *
 * Rows that already hold the new value are left out, so the count offered is
 * the number of rows that will really change. Offering "apply to 40 others"
 * and then changing three is the kind of small dishonesty that teaches people
 * to distrust a number.
 *
 * A merchant with no readable name matches nothing: an empty key would
 * otherwise sweep up every other nameless transaction in the account, which
 * is the one case where a bulk change could do real damage.
 */
export function similarTransactions(
  all: Transaction[],
  subject: Transaction,
  key: string,
  change: { categoryId?: number | null; description?: string }
): Transaction[] {
  if (!key) return [];

  return all.filter((candidate) => {
    if (candidate.id === subject.id) return false;
    if (matchKey(candidate) !== key) return false;

    if (change.description !== undefined && (candidate.description ?? "") !== change.description) return true;
    if (change.categoryId !== undefined && (candidate.category_id ?? null) !== change.categoryId) return true;
    return false;
  });
}

/**
 * What to call the merchant on screen, for the offer's wording.
 *
 * The cleaned name, because that is what the row the person just clicked
 * says. Naming the merchant twice — once as the bank writes it and once as
 * the app does — would make an offer about forty rows read as though it
 * concerned something other than the row in front of them.
 */
export function merchantLabel(transaction: Pick<Transaction, "description" | "counterparty">): string {
  return cleanDescription(transaction.description) || (transaction.counterparty ?? "").trim() || "this merchant";
}
