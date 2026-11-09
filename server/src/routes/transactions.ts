import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, withTransaction } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { suggestCategoriesWithAi, type MerchantSample } from "../services/aiCategorySuggestion.js";
import { categoriseImport } from "../services/importCategorise.js";
import { suggestCategoryId } from "../services/categorySuggestion.js";
import { annotateRepayments, matchedCategoryId } from "../services/transactionRules.js";
import { splitsBalance, type Split } from "../services/splits.js";
import { listRules } from "./rules.js";
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
    // Which loan each payment repays, worked out here rather than stored, so
    // changing a rule changes the figures — see services/transactionRules.ts.
    const annotated = annotateRepayments(rows, await listRules(req.user!.id));
    res.json(await withSplits(annotated, req.user!.id));
    return;
  }

  // A rule outranks everything below it. History is what the owner tended to
  // do and the model is a guess; a rule is a standing instruction they wrote
  // down, so it is the one answer here that was actually asked for.
  const rules = await listRules(req.user!.id);
  const ruleSuggestions = rows.map((t) => matchedCategoryId(t, rules));

  // The user's own reviewed history is next — a category they actually chose
  // for this merchant beats any model guess, so the AI categoriser below never
  // gets a chance to override one.
  const historySuggestions = await Promise.all(
    rows.map((t, i) => (ruleSuggestions[i] != null ? null : suggestCategoryId(req.user!.id, t.counterparty ?? t.description)))
  );

  // Only merchants history can't place go to the model, deduped by match key
  // so twelve Tesco transactions cost one entry in the batch rather than
  // twelve.
  const unplaced = new Map<string, MerchantSample>();
  rows.forEach((t, i) => {
    if (ruleSuggestions[i] != null || historySuggestions[i] != null) return;
    const label = t.counterparty ?? t.description;
    if (!label) return;
    const matchKey = label.toLowerCase();
    if (!unplaced.has(matchKey)) unplaced.set(matchKey, { matchKey, label, sampleAmount: t.amount });
  });

  const categories = (await db
    .prepare("SELECT id, name FROM categories WHERE user_id = ?")
    .all(req.user!.id)) as unknown as { id: number; name: string }[];

  const aiSuggestions = await suggestCategoriesWithAi(req.user!.id, [...unplaced.values()], categories);

  res.json(
    rows.map((t, i) => {
      const label = t.counterparty ?? t.description;
      const aiSuggestion = label ? aiSuggestions.get(label.toLowerCase()) ?? null : null;
      const suggested = ruleSuggestions[i] ?? historySuggestions[i] ?? aiSuggestion;
      return {
        ...t,
        suggested_category_id: suggested,
        // Lets the review UI distinguish "you've filed this merchant here
        // before" from "this is a guess" — the user approves either way, but
        // a guess is the one worth actually reading before clicking through.
        suggestion_source:
          suggested == null ? null : ruleSuggestions[i] != null ? "rule" : historySuggestions[i] != null ? "history" : "ai",
      };
    })
  );
});

/**
 * Category suggestions for everything awaiting review, on demand.
 *
 * The pending list already carries a suggestion per row, but that one runs
 * unattended on every fetch, so it only ever matches categories that already
 * exist. This is the same categoriser the import dialog uses: the user has
 * asked for it, so it may also propose categories they don't have yet, which
 * is what makes a first sync of unfamiliar merchants tractable.
 *
 * Suggestions only; nothing is approved or written here.
 */
transactionsRouter.post("/categorise-pending", async (req, res) => {
  const rows = (await db
    .prepare(
      `SELECT id, description, counterparty FROM transactions
       WHERE user_id = ? AND reviewed_at IS NULL
       ORDER BY booking_date DESC`
    )
    .all(req.user!.id)) as unknown as { id: string; description: string | null; counterparty: string | null }[];

  const { suggestions, proposed, note } = await categoriseImport(req.user!.id, rows);

  // Keyed by transaction id rather than position: the list can be re-fetched
  // or reordered between asking and applying, and an index would then attach
  // a category to the wrong transaction.
  res.json({
    suggestions: rows.map((row, index) => ({ id: row.id, ...suggestions[index] })),
    proposed,
    // Passed through so the widget can say why nothing came back, instead of
    // appearing to ignore the click.
    note,
  });
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

/**
 * Attaches each transaction's splits, where it has any.
 *
 * One query for the lot rather than one per row: a split is rare enough that
 * most of these come back empty, and a query per transaction would be hundreds
 * of round trips to say "no" several hundred times.
 */
async function withSplits<T extends { id: string }>(rows: T[], userId: string): Promise<(T & { splits: Split[] | null })[]> {
  if (rows.length === 0) return [];

  const splits = (await db
    .prepare("SELECT transaction_id, category_id, amount FROM transaction_splits WHERE user_id = ?")
    .all(userId)) as unknown as { transaction_id: string; category_id: number | null; amount: number }[];

  if (splits.length === 0) return rows.map((row) => ({ ...row, splits: null }));

  const byTransaction = new Map<string, Split[]>();
  for (const split of splits) {
    const list = byTransaction.get(split.transaction_id) ?? [];
    list.push({ category_id: split.category_id, amount: split.amount });
    byTransaction.set(split.transaction_id, list);
  }

  // null rather than [] for an unsplit transaction: "no splits" and "split
  // into nothing" would otherwise look the same to every reader downstream.
  return rows.map((row) => ({ ...row, splits: byTransaction.get(row.id) ?? null }));
}

/**
 * Replaces a transaction's splits wholesale.
 *
 * Wholesale rather than one at a time because the parts have to add up to the
 * whole, and that can only be judged of a complete set — adding a part at a
 * time would mean every intermediate state was invalid.
 *
 * An empty list removes the split, which is how a transaction goes back to
 * being an ordinary one. Nothing about the parent changes either way.
 */
transactionsRouter.put("/:id/splits", async (req, res) => {
  const transaction = (await db
    .prepare("SELECT id, amount FROM transactions WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user!.id)) as unknown as { id: string; amount: number } | undefined;

  if (!transaction) {
    res.status(404).json({ error: "No such transaction." });
    return;
  }

  const { splits } = req.body as { splits?: unknown };
  if (!Array.isArray(splits)) {
    res.status(400).json({ error: "splits must be a list." });
    return;
  }

  const parsed: Split[] = [];
  for (const raw of splits) {
    const amount = typeof raw?.amount === "number" ? raw.amount : Number(raw?.amount);
    if (!Number.isFinite(amount)) {
      res.status(400).json({ error: "Every part needs an amount." });
      return;
    }
    const categoryId = raw?.category_id == null ? null : Number(raw.category_id);
    if (categoryId !== null && !Number.isInteger(categoryId)) {
      res.status(400).json({ error: "That category isn't valid." });
      return;
    }
    if (categoryId !== null) {
      const found = await db.prepare("SELECT id FROM categories WHERE id = ? AND user_id = ?").get(categoryId, req.user!.id);
      if (!found) {
        res.status(404).json({ error: "That category doesn't exist." });
        return;
      }
    }
    parsed.push({ category_id: categoryId, amount });
  }

  // A single part is not a split, it is the transaction — and storing it as
  // one would quietly move the row's category out of the column everything
  // else reads.
  if (parsed.length === 1) {
    res.status(400).json({ error: "A split needs at least two parts. Change the category instead." });
    return;
  }

  // The whole point of the feature is that the parts describe the same money
  // as the parent. Parts that don't add up would make spending by category
  // disagree with the account balance, which is the kind of wrong figure
  // nobody goes looking for.
  if (parsed.length > 0 && !splitsBalance(transaction.amount, parsed)) {
    const sum = parsed.reduce((running, split) => running + split.amount, 0);
    res.status(400).json({
      error: `The parts come to ${sum.toFixed(2)} but the transaction is ${transaction.amount.toFixed(2)}.`,
    });
    return;
  }

  await withTransaction(async (tx) => {
    await tx.prepare("DELETE FROM transaction_splits WHERE transaction_id = ? AND user_id = ?").run(req.params.id, req.user!.id);
    for (const split of parsed) {
      await tx
        .prepare("INSERT INTO transaction_splits (id, user_id, transaction_id, category_id, amount) VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), req.user!.id, req.params.id, split.category_id, split.amount);
    }
  });

  res.json({ splits: parsed.length === 0 ? null : parsed });
});
