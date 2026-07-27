import { Router } from "express";
import { createHash } from "node:crypto";
import { db, withTransaction } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { resolveBank } from "../services/bankLogo.js";
import { categoriseImport } from "../services/importCategorise.js";
import { checkStatement } from "../services/statementMatch.js";
import { extractPdfRows, looksLikePdf } from "../services/pdfStatement.js";
import {
  applyMapping,
  hasDateShape,
  inferMapping,
  parseDelimited,
  splitPreamble,
  type ParsedRow,
  type StatementMapping,
} from "../services/statementParser.js";

export const importStatementRouter = Router();

importStatementRouter.use(requireAuth);

// Statements are small, but the default JSON body limit would reject a long
// export and the failure would look like a server error rather than a size
// problem. 8MB is far more than any realistic statement.
const MAX_BYTES = 8 * 1024 * 1024;
// The dialog lists every row rather than a sample — a statement you can only
// see eight rows of isn't really being confirmed. The cap exists so a
// pathological file can't produce an unbounded response.
const PREVIEW_ROWS = 2000;

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
  /**
   * Category per parsed row, aligned by index with the preview's rows. The
   * rows themselves are re-derived here from the same content and mapping, so
   * the client sends only the choices, never the transactions.
   */
  categories?: (number | null)[];
  /**
   * Rows to leave out, aligned by index. Used for duplicates the user chose
   * to skip; a duplicate they chose to keep is simply not marked.
   */
  skip?: boolean[];
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
    // A PDF that arrives as text was read with file.text() by an old client
    // bundle, which mangles the bytes beyond recovery. Parsed as delimited
    // text it yields hundreds of rows of PDF internals and a date column of
    // "%PDF-1.3" — technically a successful parse, which is exactly why it's
    // confusing. Say what actually happened instead.
    if (body.content.trimStart().startsWith("%PDF")) {
      return {
        error: "This PDF reached the server as text, which means the page is running an out-of-date version. Reload the page (pull down to refresh) and try again.",
        status: 422,
      };
    }
    return parseDelimited(body.content);
  }

  return { error: "account_id and a file are required", status: 400 };
}

/**
 * Finds rows that already exist on this account.
 *
 * Matched on date and amount rather than the content hash the importer
 * dedupes with: a statement re-downloaded a month later often has the same
 * transaction with its description reworded or padded differently, which
 * changes the hash but is still plainly the same payment. Matching on the two
 * fields that don't drift catches those, at the cost of occasionally flagging
 * two genuinely identical purchases — which is the right trade, because the
 * user decides per row and a missed duplicate is the more expensive mistake.
 */
async function findExisting(accountId: string, userId: string, rows: ParsedRow[]) {
  if (rows.length === 0) return rows.map(() => null);

  const dates = rows.map((r) => r.date).sort();
  const existing = (await db
    .prepare(
      `SELECT id, booking_date, amount, description, counterparty
       FROM transactions
       WHERE account_id = ? AND user_id = ? AND booking_date BETWEEN ? AND ?`
    )
    .all(accountId, userId, dates[0], dates[dates.length - 1])) as unknown as {
    id: string;
    booking_date: string;
    amount: number;
    description: string | null;
    counterparty: string | null;
  }[];

  const key = (date: string, amount: number) => `${date}|${amount.toFixed(2)}`;
  const byKey = new Map<string, (typeof existing)[number][]>();
  for (const row of existing) {
    const k = key(row.booking_date, row.amount);
    byKey.set(k, [...(byKey.get(k) ?? []), row]);
  }

  // Each existing transaction can only account for one incoming row, so a
  // statement legitimately containing the same purchase twice only has its
  // first occurrence flagged when the account holds one of them.
  const used = new Map<string, number>();
  return rows.map((row) => {
    const k = key(row.date, row.amount);
    const candidates = byKey.get(k) ?? [];
    const taken = used.get(k) ?? 0;
    if (taken >= candidates.length) return null;
    used.set(k, taken + 1);
    const match = candidates[taken];
    return {
      id: match.id,
      date: match.booking_date,
      amount: match.amount,
      description: match.description ?? match.counterparty,
    };
  });
}

// Labels each column from the header row when there is one, falling back to a
// sample value from the first data row so a column is still recognisable.
function columnLabels(table: string[][], mapping: StatementMapping) {
  const firstData = table.findIndex((row) => row.length > 1 && row.some((c) => hasDateShape(c)));
  const dataRow = table[firstData] ?? table[0] ?? [];
  const headerRow = firstData > 0 ? table[firstData - 1] : mapping.hasHeader ? table[0] : undefined;
  const width = Math.max(dataRow.length, headerRow?.length ?? 0);

  return Array.from({ length: width }, (_, index) => {
    const heading = (headerRow?.[index] ?? "").trim();
    const sample = (dataRow[index] ?? "").trim();
    const label = heading || sample || "";
    return { index, label: label ? `${index + 1}. ${label.slice(0, 40)}` : `Column ${index + 1}` };
  });
}

async function ownedAccount(accountId: string, userId: string) {
  return db
    .prepare("SELECT currency, iban FROM accounts WHERE id = ? AND user_id = ?")
    .get<{ currency: string; iban: string | null }>(accountId, userId);
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
    // Column labels for the editor's dropdowns, taken from the first row that
    // actually carries data — not table[0]. On a PDF the top of the grid is
    // letterhead, and labelling from it offers a single unusable column with
    // no amount to select, whatever the mapping underneath found.
    columns: columnLabels(table, mapping),
    // Every row, not a sample: the dialog is where the import is checked, and
    // checking it means seeing all of what's about to land. Capped only to
    // keep a pathological file from producing an unbounded response.
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
    // Whether this statement belongs to the account it's being imported into,
    // and what period it covers. Neither is visible in a row-by-row preview:
    // the right statement imported into the wrong account parses perfectly.
    check: checkStatement(mapping, rows, account),
    // Aligned with sample by index: null where the row is new, otherwise the
    // transaction already on the account that it appears to repeat.
    duplicates: (await findExisting(body.account_id, req.user!.id, rows)).slice(0, PREVIEW_ROWS),
  });
});

/**
 * Suggested categories for every row, on demand.
 *
 * Separate from /preview because the dialog re-previews on every mapping
 * tweak, and a model call per keystroke would be slow and wasteful. This runs
 * once, when the user asks for suggestions.
 */
importStatementRouter.post("/categorise", async (req, res) => {
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

  res.json(await categoriseImport(req.user!.id, rows));
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

  // Only categories belonging to this user can be attached — an id from the
  // request body is otherwise an open door to writing against someone else's
  // category.
  const ownedCategories = new Set(
    ((await db.prepare("SELECT id FROM categories WHERE user_id = ?").all(req.user!.id)) as unknown as { id: number }[]).map(
      (c) => c.id
    )
  );
  const chosenCategories = body.categories ?? [];
  const skipRows = body.skip ?? [];

  let imported = 0;
  let skipped = 0;
  await withTransaction(async (tx) => {
    const insert = tx.prepare(
      `INSERT INTO transactions (id, user_id, account_id, booking_date, amount, currency, description, counterparty, category_id, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv')
       ON CONFLICT (id) DO NOTHING`
    );
    for (const [index, row] of rows.entries()) {
      if (skipRows[index]) {
        skipped++;
        continue;
      }
      const chosen = chosenCategories[index];
      const categoryId = chosen != null && ownedCategories.has(chosen) ? chosen : null;
      // Content-hashed id: re-importing an overlapping statement is a no-op
      // rather than a pile of duplicates, which matters because exports
      // routinely overlap at the period boundary.
      const hashInput = `${body.account_id}:${row.date}:${row.amount}:${row.description ?? ""}:${row.counterparty ?? ""}`;

      // A row the user chose to keep despite it matching one already on the
      // account hashes to the same id, so the insert would be swallowed and
      // silently ignore their decision. Retry with a discriminator until it
      // lands: they asked for a second copy, so a second copy is correct.
      let inserted = false;
      for (let attempt = 0; attempt < 10 && !inserted; attempt++) {
        const id = createHash("sha256")
          .update(attempt === 0 ? hashInput : `${hashInput}:${attempt + 1}`)
          .digest("hex");
        const result = await insert.run(
          id,
          req.user!.id,
          body.account_id,
          row.date,
          row.amount,
          account.currency,
          row.description,
          row.counterparty,
          categoryId
        );
        inserted = result.changes > 0;
        // Only a row the user actively kept should be retried. An untouched
        // duplicate colliding on the first attempt is the dedupe working.
        if (!inserted && skipRows[index] !== false) break;
      }
      if (inserted) imported++;
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
  res.json({ imported, skipped, duplicates: rows.length - imported - skipped, parsed: rows.length, brandedAs });
});
