import { Router } from "express";
import { createHash } from "node:crypto";
import { db, withTransaction } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { resolveBank } from "../services/bankLogo.js";
import { applyMapping, inferMapping, parseDelimited, splitPreamble, type StatementMapping } from "../services/statementParser.js";

export const importStatementRouter = Router();

importStatementRouter.use(requireAuth);

// Statements are small, but the default JSON body limit would reject a long
// export and the failure would look like a server error rather than a size
// problem. 8MB is far more than any realistic statement.
const MAX_CHARS = 8 * 1024 * 1024;
const PREVIEW_ROWS = 8;

/**
 * Statement import, in two steps.
 *
 * /preview works out the file's layout and shows what that mapping produces,
 * without writing anything. The user confirms or corrects it, and only then
 * does / import the rows using the mapping they approved.
 *
 * The split exists because an inferred mapping is a guess about someone's
 * money: getting day/month backwards or a debit column's sign wrong produces
 * plausible-looking rows that are quietly wrong. Showing the parse first makes
 * that visible while it's still free to fix.
 *
 * Passing a mapping to /preview skips inference entirely, so the editor can
 * re-preview on every change without another model call.
 */

interface StatementBody {
  account_id?: string;
  content?: string;
  mapping?: StatementMapping;
  /** Set the account's logo/institution from the bank detected in the file. */
  apply_bank_logo?: boolean;
}

function readBody(body: StatementBody): { error: string; status: number } | { content: string; accountId: string } {
  const { account_id, content } = body;
  if (!account_id || typeof content !== "string" || content.trim() === "") {
    return { error: "account_id and content are required", status: 400 };
  }
  if (content.length > MAX_CHARS) return { error: "statement is too large", status: 413 };
  return { content, accountId: account_id };
}

async function ownedAccount(accountId: string, userId: string) {
  return db.prepare("SELECT currency FROM accounts WHERE id = ? AND user_id = ?").get<{ currency: string }>(accountId, userId);
}

importStatementRouter.post("/preview", async (req, res) => {
  const parsedBody = readBody(req.body as StatementBody);
  if ("error" in parsedBody) {
    res.status(parsedBody.status).json({ error: parsedBody.error });
    return;
  }

  const account = await ownedAccount(parsedBody.accountId, req.user!.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }

  const { preamble, table: grid } = splitPreamble(parseDelimited(parsedBody.content));
  const supplied = (req.body as StatementBody).mapping;
  const mapping = supplied ?? (await inferMapping(grid, preamble));
  const rows = applyMapping(grid, mapping);

  res.json({
    mapping,
    // Column labels for the editor's dropdowns: the header row when there is
    // one, otherwise the first row's values so the columns are still
    // recognisable rather than being bare indices.
    columns: (grid[0] ?? []).map((cell, index) => ({ index, label: mapping.hasHeader ? cell : `Column ${index + 1}: ${cell}` })),
    sample: rows.slice(0, PREVIEW_ROWS),
    parsed: rows.length,
    // Rows the mapping dropped — a large number here usually means the date
    // column or format is wrong, so it's worth showing rather than hiding.
    ignored: Math.max(0, (mapping.hasHeader ? grid.length - 1 : grid.length) - rows.length),
    currency: account.currency,
    // Offered rather than applied: the user sees which bank was matched, with
    // its logo, and decides. A wrong logo is worse than no logo.
    detectedBank: await resolveBank(mapping.bankName, mapping.bankCountry),
  });
});

importStatementRouter.post("/", async (req, res) => {
  const parsedBody = readBody(req.body as StatementBody);
  if ("error" in parsedBody) {
    res.status(parsedBody.status).json({ error: parsedBody.error });
    return;
  }

  const account = await ownedAccount(parsedBody.accountId, req.user!.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }

  const { preamble, table: grid } = splitPreamble(parseDelimited(parsedBody.content));
  const supplied = (req.body as StatementBody).mapping;
  const mapping = supplied ?? (await inferMapping(grid, preamble));
  const rows = applyMapping(grid, mapping);

  if (rows.length === 0) {
    res.status(422).json({ error: "No transactions could be read using this mapping.", mapping });
    return;
  }

  let imported = 0;
  await withTransaction(async (tx) => {
    const insert = tx.prepare(
      `INSERT INTO transactions (id, user_id, account_id, booking_date, amount, currency, description, counterparty, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'csv')
       ON CONFLICT (id) DO NOTHING`
    );
    for (const row of rows) {
      // Content-hashed id, matching /import/csv: re-importing an overlapping
      // statement is a no-op rather than a pile of duplicates, which matters
      // because exports routinely overlap at the period boundary.
      const hashInput = `${parsedBody.accountId}:${row.date}:${row.amount}:${row.description ?? ""}:${row.counterparty ?? ""}`;
      const id = createHash("sha256").update(hashInput).digest("hex");
      const result = await insert.run(
        id,
        req.user!.id,
        parsedBody.accountId,
        row.date,
        row.amount,
        account.currency,
        row.description,
        row.counterparty
      );
      if (result.changes > 0) imported++;
    }
  });

  // Branding the account is opt-in and never destructive: an account that
  // already carries a logo (a linked account, or one branded by an earlier
  // import) keeps it rather than being overwritten by a name match.
  let brandedAs: string | null = null;
  if ((req.body as StatementBody).apply_bank_logo) {
    const bank = await resolveBank(mapping.bankName, mapping.bankCountry);
    if (bank?.logo) {
      const result = await db
        .prepare(
          `UPDATE accounts SET logo = ?, institution_name = COALESCE(institution_name, ?)
           WHERE id = ? AND user_id = ? AND logo IS NULL`
        )
        .run(bank.logo, bank.name, parsedBody.accountId, req.user!.id);
      if (result.changes > 0) brandedAs = bank.name;
    }
  }

  // Imported rows land unreviewed, so they go through the same approve-with-a-
  // category flow as a bank sync rather than straight into the totals.
  res.json({ imported, duplicates: rows.length - imported, parsed: rows.length, brandedAs });
});
