import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

categoriesRouter.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY name").all(req.user!.id));
});

categoriesRouter.post("/", (req, res) => {
  const { name, parent_id } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const result = db.prepare("INSERT INTO categories (user_id, name, parent_id) VALUES (?, ?, ?)").run(
    req.user!.id,
    name,
    parent_id ?? null
  );
  res.status(201).json(db.prepare("SELECT * FROM categories WHERE id = ?").get(result.lastInsertRowid));
});
