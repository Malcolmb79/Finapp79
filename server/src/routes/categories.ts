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
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const created = await db
    .prepare("INSERT INTO categories (user_id, name, parent_id) VALUES (?, ?, ?) RETURNING *")
    .get(req.user!.id, name, parent_id ?? null);
  res.status(201).json(created);
});
