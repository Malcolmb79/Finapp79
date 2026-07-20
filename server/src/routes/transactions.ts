import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { suggestCategoryId } from "../services/categorySuggestion.js";
import type { Transaction } from "../types.js";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

// Defaults to reviewed transactions only (reviewed_at IS NOT NULL) — every
// aggregate in the app (Dashboard, Analytics, manual-account balances) reads
// from this endpoint, so this is what keeps pending transactions out of
// net worth/cash-flow/spend-by-category until the user approves them.
// ?pending=true flips to the opposite set, for the review widget/bell, and
// enriches each row with a suggested category learned from the user's own
// past categorizations (see services/categorySuggestion.ts).
transactionsRouter.get("/", async (req, res) => {
  const { accountId, from, to, pending } = req.query;
  const isPending = pending === "true";

  let query = "SELECT * FROM transactions WHERE user_id = ?";
  const params: string[] = [req.user!.id];
  query += isPending ? " AND reviewed_at IS NULL" : " AND reviewed_at IS NOT NULL";

  if (accountId) {
    query += " AND account_id = ?";
    params.push(String(accountId));
  }
  if (from) {
    query += " AND booking_date >= ?";
    params.push(String(from));
  }
  if (to) {
    query += " AND booking_date <= ?";
    params.push(String(to));
  }
  query += " ORDER BY booking_date DESC";

  const rows = (await db.prepare(query).all(...params)) as unknown as Transaction[];

  if (!isPending) {
    res.json(rows);
    return;
  }

  const withSuggestions = await Promise.all(
    rows.map(async (t) => ({
      ...t,
      suggested_category_id: await suggestCategoryId(req.user!.id, t.counterparty ?? t.description),
    }))
  );
  res.json(withSuggestions);
});

transactionsRouter.post("/", async (req, res) => {
  const { account_id, booking_date, amount, currency, description, counterparty, category_id } = req.body;

  if (!account_id || !booking_date || typeof amount !== "number") {
    res.status(400).json({ error: "account_id, booking_date, and amount are required" });
    return;
  }

  const account = await db.prepare("SELECT 1 FROM accounts WHERE id = ? AND user_id = ?").get(account_id, req.user!.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }

  const id = randomUUID();
  await db
    .prepare(
      `INSERT INTO transactions (id, user_id, account_id, category_id, booking_date, amount, currency, description, counterparty, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`
    )
    .run(
      id,
      req.user!.id,
      account_id,
      category_id ?? null,
      booking_date,
      amount,
      currency ?? "USD",
      description ?? null,
      counterparty ?? null
    );

  const created = await db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
  res.status(201).json(created);
});

// Approving is what moves a transaction out of "pending" — sets the
// category the user picked (or confirmed from the suggestion) and stamps
// reviewed_at, which is what every total/chart's WHERE clause keys off.
transactionsRouter.post("/:id/approve", async (req, res) => {
  const { category_id } = req.body as { category_id?: number | null };

  const result = await db
    .prepare("UPDATE transactions SET category_id = ?, reviewed_at = (now() AT TIME ZONE 'utc')::text WHERE id = ? AND user_id = ?")
    .run(category_id ?? null, req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "transaction not found" });
    return;
  }

  res.json(await db.prepare("SELECT * FROM transactions WHERE id = ?").get(req.params.id));
});

// Bulk variant for the "Approve all" action in the review widget — each
// item carries whatever category the user had selected (or left as the
// suggestion) for that row at the moment they submitted.
transactionsRouter.post("/bulk-approve", async (req, res) => {
  const { items } = req.body as { items?: { id: string; category_id: number | null }[] };
  if (!Array.isArray(items)) {
    res.status(400).json({ error: "items array is required" });
    return;
  }

  let approved = 0;
  for (const item of items) {
    const result = await db
      .prepare("UPDATE transactions SET category_id = ?, reviewed_at = (now() AT TIME ZONE 'utc')::text WHERE id = ? AND user_id = ?")
      .run(item.category_id ?? null, item.id, req.user!.id);
    approved += result.changes;
  }

  res.json({ approved });
});

transactionsRouter.patch("/:id", async (req, res) => {
  const existing = await db.prepare("SELECT * FROM transactions WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id);

  if (!existing) {
    res.status(404).json({ error: "transaction not found" });
    return;
  }

  // Only touch fields the caller actually sent, so e.g. clearing category_id
  // to null (uncategorizing) is distinguishable from "leave it alone".
  const hasCategory = "category_id" in req.body;
  const hasDescription = "description" in req.body;

  await db
    .prepare(
      `UPDATE transactions SET
         category_id = ${hasCategory ? "?" : "category_id"},
         description = ${hasDescription ? "?" : "description"}
       WHERE id = ? AND user_id = ?`
    )
    .run(
      ...[hasCategory ? req.body.category_id : undefined, hasDescription ? req.body.description : undefined, req.params.id, req.user!.id].filter(
        (v) => v !== undefined
      )
    );

  res.json(await db.prepare("SELECT * FROM transactions WHERE id = ?").get(req.params.id));
});

transactionsRouter.delete("/:id", async (req, res) => {
  const result = await db
    .prepare("DELETE FROM transactions WHERE id = ? AND user_id = ? AND source = 'manual'")
    .run(req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "manual transaction not found" });
    return;
  }
  res.status(204).send();
});
