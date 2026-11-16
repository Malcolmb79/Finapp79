import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { loadSpending } from "./budgetAdvisor.js";
import { loadDebts } from "../services/debtAccounts.js";
import { assumedMinimum, compareStrategies } from "../services/debtStrategy.js";
import { monthsUntil, requiredMonthlySaving } from "../services/goalForecast.js";

/**
 * A coach you can ask anything, on the pages where money decisions get made.
 *
 * The division of labour is the one this app already uses for its two
 * advisers: the arithmetic is computed here from the real rows, and the model
 * decides which of it matters and says so. The difference is scope. The
 * budget adviser answers one question about one thing; this one is asked
 * whatever is on somebody's mind, which means the figures it needs cannot be
 * known in advance — so they are tools it fetches rather than a summary
 * composed up front.
 *
 * Three rules hold it to the ground, and they are the same three everywhere
 * else in this codebase:
 *
 *   **Nothing is estimated.** Every figure comes back from a tool reading the
 *   database. A coach that works out a payoff date in its head is a coach
 *   producing a confident number nobody can check, and the number will
 *   sometimes be wrong in the direction that costs money.
 *
 *   **Nothing is written.** A settled figure becomes a proposal with a button
 *   on it. The user presses the button; the model never does.
 *
 *   **It is not a regulated adviser** and says so. Product recommendations,
 *   anything turning on circumstances it cannot see, and anything that would
 *   need to know the user's tax position are referred on rather than guessed.
 */

export const coachRouter = Router();
coachRouter.use(requireAuth);

const MODEL = "claude-opus-5";
const BASE_CURRENCY = "EUR";

// Enough for a real back-and-forth, bounded so a runaway exchange cannot run
// up an unbounded bill. Same shape as the budget adviser's.
const MAX_TURNS = 24;
const MAX_TOOL_ROUNDS = 6;

/** The pages the coach is offered on, and what it should lead with on each. */
const PAGE_FOCUS: Record<string, string> = {
  dashboard: "They are on their dashboard, looking at the whole position. Start wide unless they narrow it.",
  debt: "They are on the debt planner, so debts are the likely subject: order of payoff, what an extra payment buys, whether to refinance.",
  savings:
    "They are on the savings page, so goals are the likely subject: whether a target is reachable by its date, and what it would take.",
  btl: "They are on the buy-to-let page appraising a deal. Irish rules apply and differ from UK ones in ways a UK spreadsheet gets wrong — no second-home stamp duty surcharge, interest fully deductible but only with RTB registration, USC and PRSI on top of income tax, and Local Property Tax is the landlord's.",
};

const SYSTEM_PROMPT = [
  "You are a personal finance coach inside somebody's own accounts app. They can see their figures; you can look them up.",
  "",
  "Every figure you state must come from a tool call. Do not calculate totals, averages, payoff dates or interest yourself, and never estimate one — call the tool and quote what comes back. If a tool cannot tell you something, say that you do not know it rather than producing a plausible number.",
  "",
  "Be brief and concrete. Two or three sentences, then the one question that would most change your answer. Do not list options nobody asked for, and do not restate figures they can already see unless the point turns on them.",
  "",
  "Lead with the thing that would make the biggest difference, and say what it is worth per month or per year. Advice without a figure attached is not actionable.",
  "",
  "When a course of action is settled — or when you are recommending one — call the matching propose tool so it appears as a button they can press. Never say anything has been set, changed or applied: you propose, they decide.",
  "",
  "You are not a regulated financial adviser, and you do not recommend specific products, providers or investments. Anything turning on their tax position, their employment, their health or circumstances you cannot see goes to a qualified adviser — say so plainly in one line and move on, without a disclaimer paragraph.",
  "",
  "Never be reassuring about a figure you have not checked.",
].join("\n");

const TOOLS: Anthropic.Tool[] = [
  {
    name: "position",
    description:
      "Their accounts and what each holds, plus the spendable total and total borrowed. Call this for anything about what they have, what is where, or whether they can afford something.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "spending",
    description:
      "What they spend by category: a typical month, the range, how steady it is, which way it is moving, and a typical month's income. Call this for anything about outgoings, affordability or where money is going.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "debts",
    description:
      "Every debt with balance, APR and minimum, plus what avalanche and snowball each cost in time and interest at a given extra monthly payment. Call it again with a different extra to see what more money buys.",
    input_schema: {
      type: "object" as const,
      properties: {
        extra_per_month: { type: "number", description: "Extra above the minimums, in EUR. 0 for the baseline." },
      },
    },
  },
  {
    name: "savings_goals",
    description:
      "Their goals with target, progress, target date, and what each needs per month to land on time. Call this before saying whether a goal is reachable.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "propose_savings_goal",
    description:
      "Puts a savings goal in front of them as a button. Use for a new goal or to change an existing one's target or date. Not applied — they press it.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "The goal's name. Use the exact existing name to change one." },
        target_amount: { type: "number" },
        target_date: { type: "string", description: "YYYY-MM-DD, or omit if there is no deadline" },
        reason: { type: "string", description: "One sentence, referring to the figures you looked up" },
      },
      required: ["name", "target_amount", "reason"],
    },
  },
  {
    name: "propose_budget_limit",
    description:
      "Puts a monthly limit for one category in front of them as a button. The category must be one of theirs, exactly as spelled in the spending tool. Not applied — they press it.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: { type: "string" },
        monthly_limit: { type: "number", description: "In EUR" },
        reason: { type: "string", description: "One sentence, referring to the figures you looked up" },
      },
      required: ["category", "monthly_limit", "reason"],
    },
  },
];

export interface CoachProposal {
  kind: "savings_goal" | "budget_limit";
  /** What the button says it will do. */
  label: string;
  reason: string;
  /** Everything needed to apply it, already validated against their own rows. */
  savingsGoal?: { id: number | null; name: string; target_amount: number; target_date: string | null; current: number | null };
  budgetLimit?: { categoryId: number; category: string; monthly_limit: number; currentLimit: number | null };
}

async function accountPosition(userId: string) {
  const rows = (await db
    .prepare(
      `SELECT a.id, a.name, a.currency, a.account_type, a.balance, a.synced_balance,
              COALESCE(SUM(t.amount), 0) AS movement
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id AND t.reviewed_at IS NOT NULL
        WHERE a.user_id = ? AND NOT a.hidden
        GROUP BY a.id, a.name, a.currency, a.account_type, a.balance, a.synced_balance`
    )
    .all(userId)) as unknown as {
    id: string;
    name: string;
    currency: string;
    account_type: string | null;
    balance: number | null;
    synced_balance: number | null;
    movement: number;
  }[];

  return rows.map((row) => ({
    name: row.name,
    type: row.account_type ?? "current",
    currency: row.currency,
    // The entered or synced balance where there is one, else what the
    // transactions add up to. Never both added together, which would double
    // every account that has an opening figure.
    balance: Math.round((row.synced_balance ?? row.balance ?? row.movement) * 100) / 100,
  }));
}

async function goalLines(userId: string) {
  const rows = (await db
    .prepare("SELECT id, name, target_amount, current_amount, target_date FROM savings_goals WHERE user_id = ?")
    .all(userId)) as unknown as {
    id: number;
    name: string;
    target_amount: number;
    current_amount: number;
    target_date: string | null;
  }[];

  return rows.map((row) => {
    const remaining = Math.max(0, row.target_amount - row.current_amount);
    return {
      name: row.name,
      target: row.target_amount,
      saved: row.current_amount,
      remaining,
      targetDate: row.target_date,
      monthsLeft: row.target_date ? monthsUntil(row.target_date) : null,
      neededPerMonth: row.target_date ? requiredMonthlySaving(remaining, row.target_date) : null,
    };
  });
}

coachRouter.post("/chat", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "The coach needs an AI key configured." });
    return;
  }

  const { messages, page, context } = req.body as { messages?: unknown; page?: unknown; context?: unknown };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages is required" });
    return;
  }

  const history = messages
    .filter(
      (m): m is { role: string; content: string } =>
        !!m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant")
    )
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  if (history.length === 0) {
    res.status(400).json({ error: "no usable messages" });
    return;
  }

  const userId = req.user!.id;
  const focus = typeof page === "string" ? (PAGE_FOCUS[page] ?? "") : "";
  // Whatever the page is modelling that is not in the database — the
  // buy-to-let appraisal is worked out entirely in the browser, so without
  // this the coach would be the only thing on that screen unable to see the
  // deal being discussed. Capped, and clearly labelled as the user's own
  // screen rather than as a looked-up figure.
  const onScreen = typeof context === "string" ? context.slice(0, 4000) : "";

  try {
    const proposals: CoachProposal[] = [];
    const client = new Anthropic();
    const conversation: Anthropic.MessageParam[] = [...history];

    const system = [
      SYSTEM_PROMPT,
      focus ? `\n${focus}` : "",
      onScreen ? `\nWhat is on their screen right now (their own figures, not a tool result):\n${onScreen}` : "",
      `\nAll money figures from tools are in ${BASE_CURRENCY} unless the tool says otherwise.`,
    ].join("\n");

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system,
        tools: TOOLS,
        messages: conversation,
      });

      if (response.stop_reason !== "tool_use") {
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();
        res.json({ reply: text || "I couldn't work that one out — try asking it a different way.", proposals });
        return;
      }

      conversation.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const input = (block.input ?? {}) as Record<string, unknown>;
        const reply = (value: unknown) =>
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(value) });

        if (block.name === "position") {
          const accounts = await accountPosition(userId);
          reply({
            accounts,
            note: "Balances are per account in that account's own currency; do not add different currencies together.",
          });
          continue;
        }

        if (block.name === "spending") {
          const { analysis, dropped } = await loadSpending(userId, req.accountScope);
          reply({ ...analysis, droppedCurrencies: dropped });
          continue;
        }

        if (block.name === "debts") {
          const debts = await loadDebts(userId, true, req.accountScope);
          const extra = Number(input.extra_per_month);
          const extraPerMonth = Number.isFinite(extra) && extra > 0 ? extra : 0;
          reply({
            debts: debts.map((debt) => ({
              name: debt.name,
              balance: debt.balance,
              rate: debt.rate,
              currency: debt.currency,
              minimum: assumedMinimum(debt),
            })),
            extraPerMonth,
            comparison: debts.length > 0 ? compareStrategies(debts, extraPerMonth) : null,
          });
          continue;
        }

        if (block.name === "savings_goals") {
          reply({ goals: await goalLines(userId) });
          continue;
        }

        if (block.name === "propose_savings_goal") {
          const name = String(input.name ?? "").trim();
          const target = Number(input.target_amount);
          if (!name || !Number.isFinite(target) || target <= 0) {
            reply({ error: "Refused: a goal needs a name and a positive target." });
            continue;
          }
          const existing = (await db
            .prepare("SELECT id, current_amount FROM savings_goals WHERE user_id = ? AND lower(name) = lower(?)")
            .get(userId, name)) as unknown as { id: number; current_amount: number } | undefined;
          const date = typeof input.target_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.target_date) ? input.target_date : null;

          proposals.push({
            kind: "savings_goal",
            label: existing ? `Change “${name}” to ${target}` : `Create “${name}” at ${target}`,
            reason: String(input.reason ?? ""),
            savingsGoal: {
              id: existing?.id ?? null,
              name,
              target_amount: Math.round(target * 100) / 100,
              target_date: date,
              current: existing?.current_amount ?? null,
            },
          });
          reply({ shown: true, existing: Boolean(existing) });
          continue;
        }

        if (block.name === "propose_budget_limit") {
          const categoryName = String(input.category ?? "").trim();
          const limit = Number(input.monthly_limit);
          const category = (await db
            .prepare("SELECT id, name FROM categories WHERE user_id = ? AND lower(name) = lower(?)")
            .get(userId, categoryName)) as unknown as { id: number; name: string } | undefined;

          if (!category || !Number.isFinite(limit) || limit <= 0) {
            // Named rather than a bare refusal, so the next attempt can be
            // right instead of being the same guess again.
            const names = (await db.prepare("SELECT name FROM categories WHERE user_id = ?").all(userId)) as unknown as {
              name: string;
            }[];
            reply({
              error: `Refused: either that is not one of their categories or the limit is not a positive number. Their categories: ${names
                .map((row) => row.name)
                .join(", ")}`,
            });
            continue;
          }

          const current = (await db
            .prepare("SELECT monthly_limit FROM budgets WHERE user_id = ? AND category_id = ?")
            .get(userId, category.id)) as unknown as { monthly_limit: number } | undefined;

          const proposal: CoachProposal = {
            kind: "budget_limit",
            label: `Set ${category.name} to ${Math.round(limit)} a month`,
            reason: String(input.reason ?? ""),
            budgetLimit: {
              categoryId: category.id,
              category: category.name,
              monthly_limit: Math.round(limit * 100) / 100,
              currentLimit: current?.monthly_limit ?? null,
            },
          };
          // Replaces rather than repeats: a figure argued down twice should
          // leave one button, showing where it landed.
          const index = proposals.findIndex((p) => p.budgetLimit?.categoryId === category.id);
          if (index >= 0) proposals[index] = proposal;
          else proposals.push(proposal);
          reply({ shown: true, ...proposal.budgetLimit });
          continue;
        }

        reply({ error: `No tool called ${block.name}.` });
      }

      conversation.push({ role: "user", content: results });
    }

    res.json({
      reply: "That took more looking up than I can do in one go — try asking it one piece at a time.",
      proposals,
    });
  } catch (err) {
    console.error("Coach chat failed:", err);
    res.status(502).json({ error: "The coach couldn't answer just then. Worth trying again." });
  }
});

export default coachRouter;
