import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

/**
 * Notes and things to do, pinned beside the figures that prompted them.
 *
 * Why this is not a task manager is on the table in schema.sql.
 */

export const notesRouter = Router();
notesRouter.use(requireAuth);

/** Long enough for a real reminder, short enough that this is not a document store. */
export const MAX_BODY = 500;

/**
 * A note's text, or null to refuse the request.
 *
 * Trimmed, because a note of three spaces is an empty row that cannot be told
 * from a real one on screen and cannot be deleted by anybody who did not mean
 * to create it.
 */
export function noteBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.trim();
  if (!body || body.length > MAX_BODY) return null;
  return body;
}

/**
 * Where a note sits, given the one it was dropped after.
 *
 * Halfway between its new neighbours, so moving one row writes one row.
 * Renumbering the whole list on every drag is the obvious alternative and it
 * turns a reorder into a write per note — on a shared household list that is
 * a lot of rows changing for one person's drag.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0;
  if (before === null) return after! - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}

notesRouter.get("/", async (req, res) => {
  res.json(
    await db
      // Outstanding first, then by hand order. A list whose done items float
      // among the live ones is a list nobody can scan.
      .prepare("SELECT * FROM notes WHERE user_id = ? ORDER BY (done_at IS NOT NULL), position, created_at")
      .all(req.user!.id)
  );
});

notesRouter.post("/", async (req, res) => {
  const body = noteBody(req.body?.body);
  if (body === null) {
    res.status(400).json({ error: `A note needs some text, and no more than ${MAX_BODY} characters.` });
    return;
  }

  // New notes go to the top, which is where somebody who has just typed one
  // expects to find it.
  const lowest = await db
    .prepare("SELECT MIN(position) AS lowest FROM notes WHERE user_id = ?")
    .get<{ lowest: number | null }>(req.user!.id);

  res.status(201).json(
    await db
      .prepare("INSERT INTO notes (id, user_id, body, position) VALUES (?, ?, ?, ?) RETURNING *")
      .get(randomUUID(), req.user!.id, body, positionBetween(null, lowest?.lowest ?? null))
  );
});

notesRouter.patch("/:id", async (req, res) => {
  const existing = await db
    .prepare("SELECT id FROM notes WHERE id = ? AND user_id = ?")
    .get<{ id: string }>(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "note not found" });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if ("body" in req.body) {
    const body = noteBody(req.body.body);
    if (body === null) {
      res.status(400).json({ error: `A note needs some text, and no more than ${MAX_BODY} characters.` });
      return;
    }
    updates.push("body = ?");
    params.push(body);
  }

  if ("done" in req.body) {
    if (typeof req.body.done !== "boolean") {
      res.status(400).json({ error: "done must be true or false" });
      return;
    }
    // Stamped here rather than taken from the client: when something was
    // ticked off is a fact about this server's clock, and a client sending
    // its own would let two devices disagree about the order of a list.
    updates.push("done_at = ?");
    params.push(req.body.done ? new Date().toISOString() : null);
  }

  if ("position" in req.body) {
    if (typeof req.body.position !== "number" || !Number.isFinite(req.body.position)) {
      res.status(400).json({ error: "position must be a number" });
      return;
    }
    updates.push("position = ?");
    params.push(req.body.position);
  }

  if (updates.length === 0) {
    res.json(await db.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id));
    return;
  }

  res.json(
    await db
      .prepare(`UPDATE notes SET ${updates.join(", ")} WHERE id = ? AND user_id = ? RETURNING *`)
      .get(...params, req.params.id, req.user!.id)
  );
});

notesRouter.delete("/:id", async (req, res) => {
  const result = await db.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "note not found" });
    return;
  }
  res.status(204).send();
});

/** Clears what has already been done, which is the only way a list like this stays short. */
notesRouter.delete("/", async (req, res) => {
  const result = await db.prepare("DELETE FROM notes WHERE user_id = ? AND done_at IS NOT NULL").run(req.user!.id);
  res.json({ cleared: result.changes });
});
