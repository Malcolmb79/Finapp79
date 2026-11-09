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
