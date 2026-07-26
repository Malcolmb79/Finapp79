import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.js";

/**
 * Categorises unfamiliar merchants with Claude, filling the gap
 * categorySuggestion.ts leaves open: that one only recognises a merchant the
 * user has already reviewed at least once, so a freshly linked bank account —
 * where nothing has been reviewed yet — gets no suggestions at all.
 *
 * History still wins. This is only consulted for merchants the user's own
 * past decisions can't place, so a category the user has actually chosen is
 * never overridden by a guess.
 *
 * Results are cached per (user, merchant), so an unfamiliar merchant costs one
 * model call ever rather than one per pending-list fetch. Misses are cached
 * too (category_id NULL) — a merchant Claude can't place shouldn't be re-asked
 * on every refresh.
 *
 * This only ever populates `suggested_category_id`. Nothing here approves a
 * transaction or writes `category_id`; the user still confirms every one.
 */

const MODEL = "claude-opus-5";

// One call covers every unknown merchant in the batch. The cap bounds the
// prompt on a first sync, where a 90-day backfill can surface hundreds of
// unseen merchants at once; the remainder resolve on the next fetch, by
// which point the ones handled here are cached.
const MAX_MERCHANTS_PER_CALL = 60;

// Returned by the model when a merchant genuinely doesn't fit any of the
// user's categories. Kept out of the category enum so "no idea" is a first-
// class answer rather than the model being forced into a bad guess.
const NO_MATCH = "__none__";

export interface MerchantSample {
  /** Lowercased counterparty/description — the same key categorySuggestion.ts matches on. */
  matchKey: string;
  /** The merchant as it appears on the statement, shown to the model. */
  label: string;
  /** Signed amount from one example transaction: negative = spend, positive = income. */
  sampleAmount: number;
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (cachedClient) return cachedClient;
  // An unset key is a supported configuration rather than an error: the app
  // falls back to history-only suggestions and everything else still works.
  if (!process.env.ANTHROPIC_API_KEY) return null;
  cachedClient = new Anthropic();
  return cachedClient;
}

function buildSchema(categoryNames: string[]) {
  return {
    type: "object",
    properties: {
      assignments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            merchant: { type: "string" },
            // Enumerating the user's own category names means the model
            // cannot invent a category that doesn't exist — every answer maps
            // back to a real row without fuzzy name matching.
            category: { type: "string", enum: [...categoryNames, NO_MATCH] },
          },
          required: ["merchant", "category"],
          additionalProperties: false,
        },
      },
    },
    required: ["assignments"],
    additionalProperties: false,
  };
}

function buildPrompt(merchants: MerchantSample[], categoryNames: string[]): string {
  const lines = merchants.map((m) => {
    const direction = m.sampleAmount >= 0 ? "money in" : "money out";
    return `- ${m.label} (${direction}, example amount ${Math.abs(m.sampleAmount).toFixed(2)})`;
  });

  return [
    "Assign each bank-statement merchant below to one of the user's existing categories.",
    "",
    "Categories:",
    ...categoryNames.map((name) => `- ${name}`),
    "",
    "Merchants:",
    ...lines,
    "",
    `Return one assignment per merchant, using the merchant text exactly as given. Use "${NO_MATCH}" when a merchant does not clearly belong to any category — a wrong guess costs the user more than no guess, because they have to notice it and correct it.`,
  ].join("\n");
}

async function readCache(userId: string, matchKeys: string[]): Promise<Map<string, number | null>> {
  const placeholders = matchKeys.map(() => "?").join(", ");
  const rows = (await db
    .prepare(
      `SELECT match_key, category_id FROM ai_category_cache
       WHERE user_id = ? AND match_key IN (${placeholders})`
    )
    .all(userId, ...matchKeys)) as unknown as { match_key: string; category_id: number | null }[];

  return new Map(rows.map((r) => [r.match_key, r.category_id]));
}

async function writeCache(userId: string, entries: { matchKey: string; categoryId: number | null }[]) {
  const statement = db.prepare(
    `INSERT INTO ai_category_cache (user_id, match_key, category_id)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id, match_key) DO UPDATE SET category_id = EXCLUDED.category_id`
  );
  for (const entry of entries) {
    await statement.run(userId, entry.matchKey, entry.categoryId);
  }
}

export async function suggestCategoriesWithAi(
  userId: string,
  merchants: MerchantSample[],
  categories: { id: number; name: string }[]
): Promise<Map<string, number>> {
  const resolved = new Map<string, number>();
  if (merchants.length === 0 || categories.length === 0) return resolved;

  const cached = await readCache(userId, merchants.map((m) => m.matchKey));
  for (const [key, categoryId] of cached) {
    if (categoryId != null) resolved.set(key, categoryId);
  }

  const unknown = merchants.filter((m) => !cached.has(m.matchKey)).slice(0, MAX_MERCHANTS_PER_CALL);
  if (unknown.length === 0) return resolved;

  const client = getClient();
  if (!client) return resolved;

  const idByName = new Map(categories.map((c) => [c.name, c.id]));

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Classification is a shallow task and this runs inline on a page
      // load, so low effort keeps it cheap and quick. Thinking stays on
      // (the default) — disabling it buys little here and risks the model
      // narrating instead of answering.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: buildSchema(categories.map((c) => c.name)) },
      },
      system:
        "You categorise bank transactions. You are given the user's own category list and a set of merchant names taken from their statements. Match each merchant to the category a careful person would file it under.",
      messages: [{ role: "user", content: buildPrompt(unknown, categories.map((c) => c.name)) }],
    });

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") return resolved;

    const parsed = JSON.parse(text.text) as { assignments: { merchant: string; category: string }[] };

    // The model echoes back the label it was shown, so map labels to their
    // match keys to write the cache under the same identity the history
    // suggester uses.
    const keyByLabel = new Map(unknown.map((m) => [m.label, m.matchKey]));
    const writes: { matchKey: string; categoryId: number | null }[] = [];

    for (const assignment of parsed.assignments ?? []) {
      const matchKey = keyByLabel.get(assignment.merchant);
      if (!matchKey) continue;
      const categoryId = idByName.get(assignment.category) ?? null;
      writes.push({ matchKey, categoryId });
      if (categoryId != null) resolved.set(matchKey, categoryId);
    }

    // Anything the model skipped is cached as a miss too, so a merchant it
    // silently dropped doesn't get re-sent on every subsequent fetch.
    const answered = new Set(writes.map((w) => w.matchKey));
    for (const merchant of unknown) {
      if (!answered.has(merchant.matchKey)) writes.push({ matchKey: merchant.matchKey, categoryId: null });
    }

    await writeCache(userId, writes);
  } catch (err) {
    // A categorisation failure must never take the pending list down with
    // it — the user still gets their transactions, just without AI
    // suggestions for the merchants this batch covered.
    console.error("AI category suggestion failed:", err);
  }

  return resolved;
}
