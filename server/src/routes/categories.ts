import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

categoriesRouter.get("/", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY name").all(req.user!.id));
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
