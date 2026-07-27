import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.js";

/** Anything with a merchant on it — a parsed statement row or a stored transaction. */
export interface Categorisable {
  description: string | null;
  counterparty: string | null;
}

/**
 * Suggests a category for every row of a statement about to be imported.
 *
 * Distinct from the pending-review suggester: that one only ever matches
 * against categories the user already has, because it runs unattended on
 * every fetch. Here the user is sitting in front of the dialog deciding, so a
 * merchant that fits nothing is more useful as a proposed new category than
 * as a blank — and it costs them one click to accept or ignore.
 *
 * Nothing here creates a category or writes a transaction. Proposals come
 * back as names; the user chooses which to create.
 */

const MODEL = "claude-opus-5";
// One call covers the whole statement. Merchants are deduplicated first, so
// this is a cap on distinct merchants rather than rows — a 500-row statement
// is typically well under a hundred.
const MAX_MERCHANTS = 120;

export interface RowSuggestion {
  /** Existing category, when the merchant fits one. */
  categoryId: number | null;
  /** A category the user doesn't have yet, proposed for this merchant. */
  proposedCategory: string | null;
}

const SCHEMA = {
  type: "object",
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          merchant: { type: "string" },
          category: { type: "string" },
        },
        required: ["merchant", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["assignments"],
  additionalProperties: false,
} as const;

function merchantOf(row: Categorisable): string {
  return (row.counterparty ?? row.description ?? "").trim();
}

export async function categoriseImport(
  userId: string,
  rows: Categorisable[]
): Promise<{ suggestions: RowSuggestion[]; proposed: string[] }> {
  const empty = rows.map(() => ({ categoryId: null, proposedCategory: null }));
  if (rows.length === 0) return { suggestions: empty, proposed: [] };

  const categories = (await db
    .prepare("SELECT id, name FROM categories WHERE user_id = ?")
    .all(userId)) as unknown as { id: number; name: string }[];

  // An unset key is a supported configuration: the dialog simply shows no
  // suggestions and the user categorises by hand.
  if (!process.env.ANTHROPIC_API_KEY) return { suggestions: empty, proposed: [] };

  const merchants = [...new Set(rows.map(merchantOf).filter((m) => m !== ""))].slice(0, MAX_MERCHANTS);
  if (merchants.length === 0) return { suggestions: empty, proposed: [] };

  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system:
        "You categorise bank transactions. You are given the categories a user already has, and merchant names from a statement they are importing. Assign each merchant a category.",
      messages: [
        {
          role: "user",
          content: [
            "Assign each merchant a category.",
            "",
            categories.length > 0 ? "Existing categories:" : "This user has no categories yet.",
            ...categories.map((c) => `- ${c.name}`),
            "",
            "Merchants:",
            ...merchants.map((m) => `- ${m}`),
            "",
            "Prefer an existing category, reusing its name exactly. Where a merchant genuinely doesn't belong to any of them, propose a short new category name instead — a broad everyday one the user is likely to reuse, not one specific to this merchant.",
          ].join("\n"),
        },
      ],
    });

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") return { suggestions: empty, proposed: [] };

    const parsed = JSON.parse(text.text) as { assignments: { merchant: string; category: string }[] };
    const byMerchant = new Map<string, RowSuggestion>();
    const proposed = new Set<string>();

    for (const assignment of parsed.assignments ?? []) {
      const existing = byName.get(assignment.category.trim().toLowerCase());
      if (existing != null) {
        byMerchant.set(assignment.merchant, { categoryId: existing, proposedCategory: null });
      } else {
        const name = assignment.category.trim();
        if (!name) continue;
        byMerchant.set(assignment.merchant, { categoryId: null, proposedCategory: name });
        proposed.add(name);
      }
    }

    return {
      suggestions: rows.map((row) => byMerchant.get(merchantOf(row)) ?? { categoryId: null, proposedCategory: null }),
      proposed: [...proposed].sort(),
    };
  } catch (err) {
    // A categorisation failure must never block the import — the user still
    // gets every row, just without suggestions.
    console.error("Import categorisation failed:", err);
    return { suggestions: empty, proposed: [] };
  }
}
