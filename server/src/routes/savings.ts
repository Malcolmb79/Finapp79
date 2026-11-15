import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const savingsRouter = Router();

savingsRouter.use(requireAuth);

savingsRouter.get("/", async (req, res) => {
  res.json(await db.prepare("SELECT * FROM savings_goals WHERE user_id = ? ORDER BY created_at").all(req.user!.id));
});

savingsRouter.post("/", async (req, res) => {
  const { name, target_amount, target_date } = req.body;
  if (!name || typeof target_amount !== "number" || target_amount <= 0) {
    res.status(400).json({ error: "name and a positive target_amount are required" });
    return;
  }

  const created = await db
    .prepare("INSERT INTO savings_goals (user_id, name, target_amount, target_date) VALUES (?, ?, ?, ?) RETURNING *")
    .get(req.user!.id, name, target_amount, target_date ?? null);

  res.status(201).json(created);
});

// Add (or, with a negative amount, remove) a contribution — the common
// action for a goal — rather than requiring the caller to compute and
// resend the new current_amount themselves.
/**
 * The fields of a goal somebody may change, from a patch body.
 *
 * `current_amount` is deliberately absent. It moves only through
 * /contribute, which adds a delta, so the client never has to read a figure,
 * add to it and write it back - two devices doing that at once lose one of
 * the contributions, and the race is invisible afterwards. Letting a patch
 * set it outright would reopen exactly that.
 *
 * Returns null when the body asks for something impossible, and an empty
 * object when it asks for nothing, which the caller treats differently: the
 * first is a mistake worth reporting and the second is a no-op.
 */
export function goalPatch(body: Record<string, unknown>): { name?: string; target_amount?: number; target_date?: string | null } | null {
  const patch: { name?: string; target_amount?: number; target_date?: string | null } = {};

  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) return null;
    patch.name = body.name.trim();
  }

  if ("target_amount" in body) {
    const amount = body.target_amount;
    // A target of zero or less is not a goal, and the progress bar divides by
    // it.
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
    patch.target_amount = amount;
  }

  if ("target_date" in body) {
    const date = body.target_date;
    if (date === null) patch.target_date = null;
    else if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) patch.target_date = date;
    else return null;
  }

  return patch;
}

savingsRouter.patch("/:id", async (req, res) => {
  const patch = goalPatch((req.body ?? {}) as Record<string, unknown>);
  if (patch === null) {
    res.status(400).json({ error: "name must not be empty, target_amount must be positive, target_date must be YYYY-MM-DD or null" });
    return;
  }

  const existing = await db.prepare("SELECT * FROM savings_goals WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "savings goal not found" });
    return;
  }

  const columns = Object.keys(patch);
  if (columns.length === 0) {
    res.json(existing);
    return;
  }

  await db
    .prepare(`UPDATE savings_goals SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ? AND user_id = ?`)
    .run(...columns.map((c) => patch[c as keyof typeof patch]), req.params.id, req.user!.id);

  res.json(await db.prepare("SELECT * FROM savings_goals WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id));
});

savingsRouter.post("/:id/contribute", async (req, res) => {
  const { amount } = req.body;
  if (typeof amount !== "number") {
    res.status(400).json({ error: "amount is required" });
    return;
  }

  const existing = await db.prepare("SELECT * FROM savings_goals WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "savings goal not found" });
    return;
  }

  await db.prepare("UPDATE savings_goals SET current_amount = GREATEST(0, current_amount + ?) WHERE id = ? AND user_id = ?").run(
    amount,
    req.params.id,
    req.user!.id
  );
  res.json(await db.prepare("SELECT * FROM savings_goals WHERE id = ?").get(req.params.id));
});

savingsRouter.delete("/:id", async (req, res) => {
  const result = await db.prepare("DELETE FROM savings_goals WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "savings goal not found" });
    return;
  }
  res.status(204).send();
});
