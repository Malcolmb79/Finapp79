import { Router } from "express";
import { createHash } from "node:crypto";
import { db, withTransaction } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { resolveBank } from "../services/bankLogo.js";
import { extractPdfRows, looksLikePdf } from "../services/pdfStatement.js";
import { applyMapping, hasDateShape, inferMapping, parseDelimited, splitPreamble, type StatementMapping } from "../services/statementParser.js";

export const importStatementRouter = Router();

importStatementRouter.use(requireAuth);

// Statements are small, but the default JSON body limit would reject a long
// export and the failure would look like a server error rather than a size
// problem. 8MB is far more than any realistic statement.
const MAX_BYTES = 8 * 1024 * 1024;
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
  /** The file's bytes, base64-encoded. CSV and PDF both arrive this way. */
  content_base64?: string;
  /** Plain-text fallback, kept so a caller can post CSV text directly. */
  content?: string;
  mapping?: StatementMapping;
  /** Set the account's logo/institution from the bank detected in the file. */
  apply_bank_logo?: boolean;
}

type Failure = { error: string; status: number };

function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && "error" in value;
}

/**
 * Produces the row grid, whatever the file was.
 *
 * The format is decided by the bytes, not the filename: bank exports are
 * routinely delivered with no extension, or with .txt on something that's
 * really a PDF, so trusting the name means failing on files that are
 * perfectly readable.
 */
async function gridFromBody(body: StatementBody): Promise<string[][] | Failure> {
  if (typeof body.content_base64 === "string" && body.content_base64 !== "") {
    const bytes = Buffer.from(body.content_base64, "base64");
    if (bytes.length === 0) return { error: "the uploaded file is empty", status: 400 };
    if (bytes.length > MAX_BYTES) return { error: "statement is too large", status: 413 };

    if (looksLikePdf(new Uint8Array(bytes))) {
      try {
        return await extractPdfRows(new Uint8Array(bytes));
      } catch (err) {
        console.error("PDF text extraction failed:", err);
        return {
          error: "This PDF's text could not be read. If it's a scanned image rather than a text PDF, export a CSV from your bank instead.",
          status: 422,
        };
      }
    }
    return parseDelimited(bytes.toString("utf-8"));
  }

  if (typeof body.content === "string" && body.content.trim() !== "") {
    if (body.content.length > MAX_BYTES) return { error: "statement is too large", status: 413 };
    return parseDelimited(body.content);
  }

  return { error: "account_id and a file are required", status: 400 };
}

async function ownedAccount(accountId: string, userId: string) {
  return db.prepare("SELECT currency FROM accounts WHERE id = ? AND user_id = ?").get<{ currency: string }>(accountId, userId);
}

importStatementRouter.post("/preview", async (req, res) => {
  const body = req.body as StatementBody;
  if (!body.account_id) {
    res.status(400).json({ error: "account_id is required" });
    return;
  }

  const account = await ownedAccount(body.account_id, req.user!.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }

  const grid = await gridFromBody(body);
  if (isFailure(grid)) {
    res.status(grid.status).json({ error: grid.error });
    return;
  }

  const { preamble, table } = splitPreamble(grid);
  const mapping = body.mapping ?? (await inferMapping(table, preamble));
  const rows = applyMapping(table, mapping);

  // A statement that parses locally and returns nothing in production has no
  // other way of being diagnosed: the file can't be reproduced from an empty
  // result, and the difference between the two environments (the model runs
  // in one and not the other) is invisible from the response. This logs the
  // shape of what the server actually saw — row counts and the first rows of
  // the grid, not the statement's contents beyond what's needed to see how it
  // was split.
  console.log(
    "[statement preview]",
    JSON.stringify({
      gridRows: grid.length,
      widths: [...grid.reduce((m, r) => m.set(r.length, (m.get(r.length) ?? 0) + 1), new Map<number, number>())].sort(),
      preambleRows: preamble.length,
      tableRows: table.length,
      firstDataRow: table.findIndex((r) => r.length > 1 && r.some((c) => hasDateShape(c))),
      mappingSource: mapping.source,
      dateColumn: mapping.dateColumn,
      amountColumn: mapping.amountColumn,
      debitColumn: mapping.debitColumn,
      creditColumn: mapping.creditColumn,
      defaultYear: mapping.defaultYear,
      signFromMarker: mapping.signFromMarker,
      hasHeader: mapping.hasHeader,
      parsed: rows.length,
      firstGridRows: table.slice(0, 3).map((r) => r.map((c) => c.slice(0, 24))),
    })
  );

  res.json({
    mapping,
    // Column labels for the editor's dropdowns: the header row when there is
    // one, otherwise the first row's values so the columns are still
    // recognisable rather than being bare indices.
    columns: (table[0] ?? []).map((cell, index) => ({ index, label: mapping.hasHeader ? cell : `Column ${index + 1}: ${cell}` })),
    sample: rows.slice(0, PREVIEW_ROWS),
    parsed: rows.length,
    // Rows the mapping dropped — a large number here usually means the date
    // column or format is wrong, so it's worth showing rather than hiding.
    ignored: Math.max(0, (mapping.hasHeader ? table.length - 1 : table.length) - rows.length),
    currency: account.currency,
    // Counted over every row, not just the sample: a statement whose amounts
    // are all one direction is the signature of an unsigned amount column,
    // where money-out is implied by convention rather than written. The
    // numbers can't distinguish that from genuine income, so the dialog has
    // to raise it — a whole statement silently imported as income is the
    // failure this is here to prevent.
    direction: {
      inflow: rows.filter((r) => r.amount > 0).length,
      outflow: rows.filter((r) => r.amount < 0).length,
    },
    // Offered rather than applied: the user sees which bank was matched, with
    // its logo, and decides. A wrong logo is worse than no logo.
    detectedBank: await resolveBank(mapping.bankName, mapping.bankCountry),
  });
});

importStatementRouter.post("/", async (req, res) => {
  const body = req.body as StatementBody;
  if (!body.account_id) {
    res.status(400).json({ error: "account_id is required" });
    return;
  }

  const account = await ownedAccount(body.account_id, req.user!.id);
  if (!account) {
    res.status(404).json({ error: "account not found" });
    return;
  }

  const grid = await gridFromBody(body);
  if (isFailure(grid)) {
    res.status(grid.status).json({ error: grid.error });
    return;
  }

  const { preamble, table } = splitPreamble(grid);
  const mapping = body.mapping ?? (await inferMapping(table, preamble));
  const rows = applyMapping(table, mapping);

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
      // Content-hashed id: re-importing an overlapping statement is a no-op
      // rather than a pile of duplicates, which matters because exports
      // routinely overlap at the period boundary.
      const hashInput = `${body.account_id}:${row.date}:${row.amount}:${row.description ?? ""}:${row.counterparty ?? ""}`;
      const id = createHash("sha256").update(hashInput).digest("hex");
      const result = await insert.run(
        id,
        req.user!.id,
        body.account_id,
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
  if (body.apply_bank_logo) {
    const bank = await resolveBank(mapping.bankName, mapping.bankCountry);
    if (bank?.logo) {
      const result = await db
        .prepare(
          `UPDATE accounts SET logo = ?, institution_name = COALESCE(institution_name, ?)
           WHERE id = ? AND user_id = ? AND logo IS NULL`
        )
        .run(bank.logo, bank.name, body.account_id, req.user!.id);
      if (result.changes > 0) brandedAs = bank.name;
    }
  }

  // Imported rows land unreviewed, so they go through the same approve-with-a-
  // category flow as a bank sync rather than straight into the totals.
  res.json({ imported, duplicates: rows.length - imported, parsed: rows.length, brandedAs });
});
