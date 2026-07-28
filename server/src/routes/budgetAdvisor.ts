import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { analyseSpending, baselineLimit, type CategorySpend } from "../services/budgetPlanner.js";
import { loadRates } from "../services/exchangeRates.js";

/**
 * Recommends monthly limits from what has actually been spent.
 *
 * The division of labour is the one used throughout: budgetPlanner.ts works
 * out what each category costs, how steady it is and which way it is moving,
 * and the model decides which of those are worth acting on and says why. Every
 * figure quoted is computed; none is composed.
 *
 * A recommendation is never applied. It comes back as a proposal against the
 * current limit, and the user sets it.
 */

export const budgetAdvisorRouter = Router();
budgetAdvisorRouter.use(requireAuth);

const MODEL = "claude-opus-5";

// Advice on a category with almost nothing in it is noise, and there is a
// limit to how many changes anyone will act on at once.
const MIN_TYPICAL = 5;
const MAX_PROPOSALS = 8;

interface TransactionRow {
  amount: number;
  booking_date: string;
  currency: string;
  category_name: string | null;
}

interface BudgetRow {
  id: number;
  category_id: number;
  category_name: string;
  monthly_limit: number;
}

const BASE_CURRENCY = "EUR";

async function loadSpending(userId: string) {
  const rows = (await db
    .prepare(
      `SELECT t.amount, t.booking_date, t.currency, c.name AS category_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = ? AND t.reviewed_at IS NOT NULL`
    )
    .all(userId)) as unknown as TransactionRow[];

  // Converted before anything is totalled, for the same reason every other
  // combined figure in this app is: adding ZAR to EUR produces a number in no
  // currency, and a budget set from one would be wrong by the exchange rate.
  const rates = await loadRates(BASE_CURRENCY);
  const converted: { amount: number; booking_date: string; category: string | null }[] = [];
  const dropped = new Set<string>();

  for (const row of rows) {
    if (row.currency === BASE_CURRENCY) {
      converted.push({ amount: row.amount, booking_date: row.booking_date, category: row.category_name });
      continue;
    }
    // fromBase converts out of the base; the rate the other way is its
    // reciprocal, so a rate of 20 ZAR per euro turns 100 ZAR into 5 euro.
    const perBase = rates?.rates?.[row.currency];
    if (!perBase) {
      dropped.add(row.currency);
      continue;
    }
    converted.push({ amount: row.amount / perBase, booking_date: row.booking_date, category: row.category_name });
  }

  return { analysis: analyseSpending(converted, BASE_CURRENCY), dropped: [...dropped] };
}

function buildSchema(categoryNames: string[]) {
  return {
    type: "object",
    properties: {
      summary: { type: "string", description: "Two or three sentences on where the money is going and what would move the needle." },
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            // Enumerated, so a proposal always maps back to a real category
            // rather than one that sounds plausible.
            category: { type: "string", enum: categoryNames },
            monthly_limit: { type: "number", description: "The limit to set, in the base currency" },
            reason: { type: "string", description: "One sentence, referring to the figures given" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["category", "monthly_limit", "reason", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "proposals"],
    additionalProperties: false,
  };
}

const SYSTEM_PROMPT = [
  "You advise someone on their monthly budget, working from what they have actually spent.",
  "",
  "Every figure you refer to is given to you. Do not calculate totals or averages yourself and do not estimate — quote what is in the data.",
  "",
  "A budget has to be livable to be kept. Setting a limit below what a category has ever come in at guarantees it is breached in the first week and then ignored, which is worse than no budget. Cut where the spending is discretionary and the trend is up; leave standing costs alone.",
  "",
  "Say which change is worth making first and what it is worth a month. Be specific and brief — a sentence per category, referring to the numbers.",
  "",
  "Where a category is erratic rather than high, say so: the problem there is planning, not overspending, and a tight limit on it will only fail.",
  "",
  "You are not a regulated adviser. Stick to what the spending shows; leave anything turning on circumstances you cannot see to the user.",
].join("\n");

function describe(analysis: Awaited<ReturnType<typeof loadSpending>>["analysis"], budgets: BudgetRow[]): string {
  const limitByCategory = new Map(budgets.map((b) => [b.category_name, b.monthly_limit]));

  const lines = analysis.categories
    .filter((c) => c.typical >= MIN_TYPICAL || c.mean >= MIN_TYPICAL)
    .map((c) => {
      const limit = limitByCategory.get(c.category);
      const direction = c.trend > 0.05 ? "rising" : c.trend < -0.05 ? "falling" : "steady";
      const steadiness = c.volatility < 0.25 ? "steady month to month" : c.volatility < 0.75 ? "variable" : "very erratic";
      return [
        `- ${c.category}: typically ${c.typical} a month (mean ${c.mean}, range ${c.lowest}–${c.highest}),`,
        `${steadiness}, ${direction}, ${c.transactions} transactions.`,
        `Baseline limit from history: ${baselineLimit(c)}.`,
        limit != null ? `Current budget: ${limit}.` : "No budget set.",
      ].join(" ");
    });

  return [
    `Months covered: ${analysis.monthsCovered.join(", ")} (the current month is excluded as incomplete).`,
    `Typical month: ${analysis.typicalIncome} in, ${analysis.typicalSpend} out. All figures in ${analysis.currency}.`,
    "",
    "Spending by category:",
    ...lines,
  ].join("\n");
}

/** Keeps a proposal only if it is a real category and a number worth acting on. */
function usable(
  proposal: { category: string; monthly_limit: number; reason: string; confidence: string },
  byCategory: Map<string, CategorySpend>
): boolean {
  const spend = byCategory.get(proposal.category);
  if (!spend) return false;
  if (!Number.isFinite(proposal.monthly_limit) || proposal.monthly_limit <= 0) return false;
  // Nothing above the highest month it has ever been: that is not a budget,
  // it is a ceiling nobody would notice hitting.
  return proposal.monthly_limit <= Math.max(spend.highest, baselineLimit(spend)) * 1.5;
}

budgetAdvisorRouter.get("/", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "The adviser needs an AI key configured." });
    return;
  }

  try {
    const { analysis, dropped } = await loadSpending(req.user!.id);
    if (analysis.monthsCovered.length === 0) {
      res.json({ summary: "Not enough history yet — a full month of reviewed transactions is needed before this can say anything.", proposals: [], analysis, dropped });
      return;
    }

    const budgets = (await db
      .prepare(
        `SELECT b.id, b.category_id, c.name AS category_name, b.monthly_limit
           FROM budgets b JOIN categories c ON c.id = b.category_id
          WHERE b.user_id = ?`
      )
      .all(req.user!.id)) as unknown as BudgetRow[];

    const eligible = analysis.categories.filter((c) => c.typical >= MIN_TYPICAL || c.mean >= MIN_TYPICAL);
    if (eligible.length === 0) {
      res.json({ summary: "Nothing is being spent regularly enough to budget yet.", proposals: [], analysis, dropped });
      return;
    }

    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema: buildSchema(eligible.map((c) => c.category)) } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: describe(analysis, budgets) }],
    });

    const text = response.content.find((block) => block.type === "text");
    const parsed = text && text.type === "text" ? JSON.parse(text.text) : { summary: "", proposals: [] };

    const byCategory = new Map(analysis.categories.map((c) => [c.category, c]));
    const limitByCategory = new Map(budgets.map((b) => [b.category_name, b]));

    const proposals = (parsed.proposals ?? [])
      .filter((p: { category: string; monthly_limit: number; reason: string; confidence: string }) => usable(p, byCategory))
      .slice(0, MAX_PROPOSALS)
      .map((p: { category: string; monthly_limit: number; reason: string; confidence: string }) => {
        const spend = byCategory.get(p.category)!;
        const existing = limitByCategory.get(p.category);
        const limit = Math.round(p.monthly_limit);
        return {
          category: p.category,
          categoryId: existing?.category_id ?? null,
          monthlyLimit: limit,
          currentLimit: existing?.monthly_limit ?? null,
          // Against what is actually spent, not against the old limit: a
          // category with no budget has nothing to save against, and the
          // saving that matters is the change in spending either way.
          monthlySaving: Math.round(Math.max(spend.typical, spend.mean) - limit),
          typical: spend.typical,
          highest: spend.highest,
          baseline: baselineLimit(spend),
          reason: p.reason,
          confidence: p.confidence,
        };
      });

    res.json({ summary: parsed.summary ?? "", proposals, analysis, dropped });
  } catch (err) {
    console.error("Budget adviser failed:", err);
    res.status(502).json({ error: "The adviser couldn't put a plan together just then. Worth trying again." });
  }
});
