import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import type { TransactionRule } from "../services/transactionRules.js";

/**
 * Standing rules for what a transaction means.
 *
 * Today that is one thing — which loan a payment repays — and the table is
 * named for the more general job because the next one (filing a merchant under
 * a category without being asked each time) is the same shape: match some
 * text, say what it means.
 */
export const rulesRouter = Router();
rulesRouter.use(requireAuth);

export async function listRules(userId: string): Promise<TransactionRule[]> {
  return (await db
    .prepare(
      `SELECT id, match_text, match_account_id, repays_account_id
         FROM transaction_rules WHERE user_id = ? ORDER BY created_at`
    )
    .all(userId)) as unknown as TransactionRule[];
}

rulesRouter.get("/", async (req, res) => {
  res.json(await listRules(req.user!.id));
});

rulesRouter.post("/", async (req, res) => {
  const { match_text, match_account_id, repays_account_id } = req.body as Record<string, unknown>;

  if (typeof match_text !== "string" || !match_text.trim()) {
    res.status(400).json({ error: "Say what text to look for." });
    return;
  }
  if (typeof repays_account_id !== "string" || !repays_account_id) {
    res.status(400).json({ error: "Say which account these payments repay." });
    return;
  }

  // Both accounts are checked against this user's own, not just for existence
  // — an id from somewhere else would otherwise attach a rule to a stranger's
  // account and quietly move figures on a page nobody here can see.
  const owned = async (id: string) =>
    Boolean(await db.prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ?").get(id, req.user!.id));

  if (!(await owned(repays_account_id))) {
    res.status(404).json({ error: "That account doesn't exist." });
    return;
  }
  const matchAccount = typeof match_account_id === "string" && match_account_id ? match_account_id : null;
  if (matchAccount && !(await owned(matchAccount))) {
    res.status(404).json({ error: "That account doesn't exist." });
    return;
  }
  // A rule pointing an account at itself would mirror every matching payment
  // back onto the account it is already on, doubling it.
  if (matchAccount && matchAccount === repays_account_id) {
    res.status(400).json({ error: "A loan can't repay itself — pick the account the payment comes from." });
    return;
  }

  const row = await db
    .prepare(
      `INSERT INTO transaction_rules (id, user_id, match_text, match_account_id, repays_account_id)
       VALUES (?, ?, ?, ?, ?) RETURNING id, match_text, match_account_id, repays_account_id`
    )
    .get(randomUUID(), req.user!.id, match_text.trim(), matchAccount, repays_account_id);

  res.status(201).json(row);
});

rulesRouter.delete("/:id", async (req, res) => {
  await db.prepare("DELETE FROM transaction_rules WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  res.status(204).end();
});
