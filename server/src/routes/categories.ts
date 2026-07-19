import { Router } from "express";
import { db } from "../db/client.js";

export const categoriesRouter = Router();

categoriesRouter.get("/", (_req, res) => {
  res.json(db.prepare("SELECT * FROM categories ORDER BY name").all());
});

categoriesRouter.post("/", (req, res) => {
  const { name, parent_id } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const result = db.prepare("INSERT INTO categories (name, parent_id) VALUES (?, ?)").run(name, parent_id ?? null);
  res.status(201).json(db.prepare("SELECT * FROM categories WHERE id = ?").get(result.lastInsertRowid));
});
