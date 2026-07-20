import { db } from "../db/client.js";

// Suggests a category for a pending transaction by looking at how the user
// has categorized their own past transactions from the same counterparty
// (or description, when counterparty is unset) — no external service, no
// hand-maintained keyword list. Computed at fetch time rather than stored,
// so a suggestion reflects everything reviewed so far, not just what was
// known when the transaction first arrived.
export async function suggestCategoryId(userId: string, matchKey: string | null): Promise<number | null> {
  if (!matchKey) return null;

  const row = await db
    .prepare(
      `SELECT category_id
       FROM transactions
       WHERE user_id = ? AND reviewed_at IS NOT NULL AND category_id IS NOT NULL
         AND LOWER(COALESCE(counterparty, description)) = LOWER(?)
       GROUP BY category_id
       ORDER BY COUNT(*) DESC
       LIMIT 1`
    )
    .get<{ category_id: number }>(userId, matchKey);

  return row?.category_id ?? null;
}
