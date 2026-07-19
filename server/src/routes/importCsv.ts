import { Router } from "express";
import { createHash } from "node:crypto";
import { db, withTransaction } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const importCsvRouter = Router();

importCsvRouter.use(requireAuth);

/**
 * Expects a pre-parsed array of rows from the client (date, amount, description),
 * plus the target account_id. Row ids are content-hashed so re-importing the
 * same CSV is a no-op instead of creating duplicate transactions.
 */
importCsvRouter.post("/", (req, res) => {
  const { account_id, rows } = req.body as {
    account_id: string;
    rows: { date: string; amount: number; description?: string }[];
  };

  if (!account_id || !Array.isArray(rows)) {
    res.status(400).json({ error: "account_id and rows are required" });
    return;
  }

  const account = db.prepare("SELECT 1 FROM accounts WHERE id = ? AND user_id = ?").get(account_id, req.user!.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO transactions (id, user_id, account_id, booking_date, amount, currency, description, source)
     VALUES (?, ?, ?, ?, ?, 'USD', ?, 'csv')`
  );

  let imported = 0;
  withTransaction(() => {
    for (const row of rows) {
      const hashInput = `${account_id}:${row.date}:${row.amount}:${row.description ?? ""}`;
      const id = createHash("sha256").update(hashInput).digest("hex");
      const result = insert.run(id, req.user!.id, account_id, row.date, row.amount, row.description ?? null);
      if (result.changes > 0) imported++;
    }
  });

  res.json({ imported, skipped: rows.length - imported });
});
