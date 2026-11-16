import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

categoriesRouter.get("/", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY name").all(req.user!.id));
});

/**
 * A starter set of categories, for an account that has none.
 *
 * Deliberately a fixed list rather than a model call. The AI categoriser
 * proposes categories too, but only while importing a statement — so someone
 * who has not imported anything yet has no way to get a first set at all, and
 * the one feature that could give them one is also the one that goes quiet
 * when no API key is configured. A starter set that depends on the same key
 * would fail in exactly the situation it exists for.
 *
 * Broad and everyday on purpose. These are meant to be reused across hundreds
 * of transactions, not to describe any particular one — a category per
 * merchant is just the merchant name with extra steps.
 */
const STARTER_CATEGORIES = [
  "Groceries",
  "Eating out",
  "Transport",
  "Fuel",
  "Housing",
  "Utilities",
  "Insurance",
  "Health",
  "Subscriptions",
  "Shopping",
  "Entertainment",
  "Income",
  "Transfers",
  "Fees & interest",
];

/**
 * What the user doesn't already have, so the list never offers a duplicate.
 * Nothing is written here — the client confirms the selection first, the same
 * way every other suggestion in this app is confirmed before it is stored.
 */
categoriesRouter.get("/starter", async (req, res) => {
  const existing = (await db
    .prepare("SELECT name FROM categories WHERE user_id = ?")
    .all(req.user!.id)) as unknown as { name: string }[];

  const have = new Set(existing.map((row) => row.name.trim().toLowerCase()));
  res.json({
    suggestions: STARTER_CATEGORIES.filter((name) => !have.has(name.toLowerCase())),
    hasAny: existing.length > 0,
  });
});

categoriesRouter.post("/", async (req, res) => {
  const { name, parent_id } = req.body;
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  // Returning the existing category rather than creating a second one, and
  // matching case-insensitively: the unique index is case-sensitive, so
  // "Groceries" and "groceries" would otherwise both be created and then
  // compete for the same transactions. Callers get a usable category back
  // either way, so creating one from a dropdown is safe to repeat.
  const existing = await db
    .prepare("SELECT * FROM categories WHERE user_id = ? AND LOWER(name) = LOWER(?)")
    .get(req.user!.id, trimmed);
  if (existing) {
    res.status(200).json(existing);
    return;
  }

  const created = await db
    .prepare("INSERT INTO categories (user_id, name, parent_id) VALUES (?, ?, ?) RETURNING *")
    .get(req.user!.id, trimmed, parent_id ?? null);
  res.status(201).json(created);
});

/**
 * Changes a category — today, only whether it counts as regular income.
 *
 * The forecast would otherwise wait to be convinced: income is found by
 * pattern, needing three credits of a consistent amount before it believes in
 * a salary. Someone who has just started a job, changed employer, or is paid
 * from more than one place has a projection whose line only falls, and no way
 * to tell it otherwise. This is the way to tell it.
 */
/**
 * What a category's three flags become after a patch, or null if it says
 * nothing usable.
 *
 * Two combinations cannot mean anything, so the rules are applied here rather
 * than left to whichever screen wrote last:
 *
 *   - Occasional income on a category that is not income. Clearing income
 *     clears occasional with it; declaring something occasional declares it
 *     income.
 *   - Income on a category that is a transfer. A transfer is the household's
 *     own money arriving from the household's own account — it is neither
 *     income nor spending, and a category claiming to be both would have
 *     every total disagree with itself depending which flag it read.
 */
export function categoryFlags(
  current: { counts_as_income: boolean; income_is_occasional: boolean; is_transfer: boolean },
  patch: { counts_as_income?: unknown; income_is_occasional?: unknown; is_transfer?: unknown }
): { counts_as_income: boolean; income_is_occasional: boolean; is_transfer: boolean } | null {
  const hasCounts = "counts_as_income" in patch;
  const hasOccasional = "income_is_occasional" in patch;
  const hasTransfer = "is_transfer" in patch;
  if (!hasCounts && !hasOccasional && !hasTransfer) return null;
  if (hasCounts && typeof patch.counts_as_income !== "boolean") return null;
  if (hasOccasional && typeof patch.income_is_occasional !== "boolean") return null;
  if (hasTransfer && typeof patch.is_transfer !== "boolean") return null;

  const counts = hasCounts ? (patch.counts_as_income as boolean) : current.counts_as_income;
  const occasional = hasOccasional ? (patch.income_is_occasional as boolean) : current.income_is_occasional;
  const transfer = hasTransfer ? (patch.is_transfer as boolean) : current.is_transfer;

  // Marking something a transfer settles the other two: it is not income, so
  // it cannot be occasional income either.
  if (hasTransfer && transfer) return { counts_as_income: false, income_is_occasional: false, is_transfer: true };

  // And declaring income on a category that was a transfer takes the transfer
  // flag off, rather than leaving a row that claims to be both.
  const clearedTransfer = (hasCounts && counts) || (hasOccasional && occasional) ? false : transfer;

  // Only what the patch actually says can move another flag. Reading the
  // carried-over value as an instruction is how "stop treating this as income"
  // turned into no change at all: the occasional flag still sitting on the row
  // put the income flag straight back.
  if (hasCounts && hasOccasional && !counts && occasional) return null;
  if (hasOccasional && occasional) return { counts_as_income: true, income_is_occasional: true, is_transfer: false };
  if (hasCounts && !counts) return { counts_as_income: false, income_is_occasional: false, is_transfer: clearedTransfer };
  return { counts_as_income: counts, income_is_occasional: occasional, is_transfer: clearedTransfer };
}

categoriesRouter.patch("/:id", async (req, res) => {
  const existing = await db
    .prepare("SELECT * FROM categories WHERE id = ? AND user_id = ?")
    .get<{ id: number; counts_as_income: boolean; income_is_occasional: boolean; is_transfer: boolean }>(
      req.params.id,
      req.user!.id
    );
  if (!existing) {
    res.status(404).json({ error: "category not found" });
    return;
  }

  /**
   * Handled on its own rather than through `categoryFlags`.
   *
   * That function exists to settle combinations that cannot mean anything —
   * occasional income on something that is not income, income on a transfer.
   * Being a subscription category is a different axis entirely: it says what
   * kind of spending this is, not whether the money is spending at all, so it
   * has no interaction to resolve and folding it in would only invent one.
   */
  const body = (req.body ?? {}) as Record<string, unknown>;
  const hasSubscription = "is_subscription" in body;
  if (hasSubscription && typeof body.is_subscription !== "boolean") {
    res.status(400).json({ error: "is_subscription must be true or false" });
    return;
  }

  const flags = categoryFlags(
    {
      counts_as_income: !!existing.counts_as_income,
      income_is_occasional: !!existing.income_is_occasional,
      is_transfer: !!existing.is_transfer,
    },
    body
  );
  if (flags === null && !hasSubscription) {
    res
      .status(400)
      .json({ error: "counts_as_income, income_is_occasional, is_transfer or is_subscription must be true or false" });
    return;
  }

  if (flags !== null) {
    await db
      .prepare(
        "UPDATE categories SET counts_as_income = ?, income_is_occasional = ?, is_transfer = ? WHERE id = ? AND user_id = ?"
      )
      .run(flags.counts_as_income, flags.income_is_occasional, flags.is_transfer, req.params.id, req.user!.id);
  }

  if (hasSubscription) {
    await db
      .prepare("UPDATE categories SET is_subscription = ? WHERE id = ? AND user_id = ?")
      .run(body.is_subscription as boolean, req.params.id, req.user!.id);
  }

  res.json(await db.prepare("SELECT * FROM categories WHERE id = ?").get(req.params.id));
});
