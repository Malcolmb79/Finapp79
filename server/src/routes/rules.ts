import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { matchedCategoryId, type TransactionRule } from "../services/transactionRules.js";

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
      `SELECT id, match_text, match_account_id, repays_account_id, category_id
         FROM transaction_rules WHERE user_id = ? ORDER BY created_at`
    )
    .all(userId)) as unknown as TransactionRule[];
}

rulesRouter.get("/", async (req, res) => {
  res.json(await listRules(req.user!.id));
});

rulesRouter.post("/", async (req, res) => {
  const { match_text, match_account_id, repays_account_id, category_id } = req.body as Record<string, unknown>;

  if (typeof match_text !== "string" || !match_text.trim()) {
    res.status(400).json({ error: "Say what text to look for." });
    return;
  }

  const repays = typeof repays_account_id === "string" && repays_account_id ? repays_account_id : null;
  const category = typeof category_id === "number" && Number.isInteger(category_id) ? category_id : null;

  // A rule that says nothing would match transactions and then do nothing with
  // them, which looks from the outside exactly like a rule that is broken.
  if (!repays && category === null) {
    res.status(400).json({ error: "A rule has to do something — file these under a category, or repay a loan." });
    return;
  }

  // Everything is checked against this user's own, not just for existence — an
  // id from somewhere else would otherwise attach a rule to a stranger's
  // account and quietly move figures on a page nobody here can see.
  const owned = async (id: string) =>
    Boolean(await db.prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ?").get(id, req.user!.id));

  if (repays && !(await owned(repays))) {
    res.status(404).json({ error: "That account doesn't exist." });
    return;
  }
  const matchAccount = typeof match_account_id === "string" && match_account_id ? match_account_id : null;
  if (matchAccount && !(await owned(matchAccount))) {
    res.status(404).json({ error: "That account doesn't exist." });
    return;
  }
  if (category !== null) {
    const found = await db.prepare("SELECT id FROM categories WHERE id = ? AND user_id = ?").get(category, req.user!.id);
    if (!found) {
      res.status(404).json({ error: "That category doesn't exist." });
      return;
    }
  }
  // A rule pointing an account at itself would mirror every matching payment
  // back onto the account it is already on, doubling it.
  if (matchAccount && matchAccount === repays) {
    res.status(400).json({ error: "A loan can't repay itself — pick the account the payment comes from." });
    return;
  }

  const row = await db
    .prepare(
      `INSERT INTO transaction_rules (id, user_id, match_text, match_account_id, repays_account_id, category_id)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id, match_text, match_account_id, repays_account_id, category_id`
    )
    .get(randomUUID(), req.user!.id, match_text.trim(), matchAccount, repays, category);

  res.status(201).json(row);
});

/**
 * Files everything this rule already matches.
 *
 * A rule written today is usually written *because* of transactions that
 * arrived months ago, so one that only applied going forward would leave the
 * pile it was meant to clear exactly as it was.
 *
 * Only ever fills a blank. A transaction already carrying a category was
 * categorised by someone — by hand, by an earlier rule, or by the importer —
 * and a rule overwriting that is a rule silently undoing a decision. Clearing
 * the category first is how you ask for it to be refiled.
 */
rulesRouter.post("/:id/apply", async (req, res) => {
  const rule = (await db
    .prepare(
      `SELECT id, match_text, match_account_id, repays_account_id, category_id
         FROM transaction_rules WHERE id = ? AND user_id = ?`
    )
    .get(req.params.id, req.user!.id)) as unknown as TransactionRule | undefined;

  if (!rule) {
    res.status(404).json({ error: "No such rule." });
    return;
  }
  if (rule.category_id == null) {
    // A repayment rule needs no applying: the attribution is worked out on
    // every read, so it already covers everything it matches.
    res.json({ filed: 0 });
    return;
  }

  const candidates = (await db
    .prepare("SELECT * FROM transactions WHERE user_id = ? AND category_id IS NULL")
    .all(req.user!.id)) as unknown as (Parameters<typeof matchedCategoryId>[0] & { id: string })[];

  const toFile = candidates.filter((tx) => matchedCategoryId(tx, [rule]) != null);
  for (const tx of toFile) {
    await db
      .prepare("UPDATE transactions SET category_id = ? WHERE id = ? AND user_id = ?")
      .run(rule.category_id, tx.id, req.user!.id);
  }

  res.json({ filed: toFile.length });
});

rulesRouter.delete("/:id", async (req, res) => {
  await db.prepare("DELETE FROM transaction_rules WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  res.status(204).end();
});
