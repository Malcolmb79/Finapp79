import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { compareStrategies, simulate, type DebtInput } from "../services/debtStrategy.js";

/**
 * Answers questions about paying down debt, using the user's own accounts.
 *
 * The division of labour is the same one the rest of this app uses: the model
 * decides what is worth working out and explains what comes back, and the
 * arithmetic is done by debtStrategy.ts. A payoff date has one right answer,
 * and a model asked to produce one directly will produce something plausible
 * instead — which is worse than useless for someone deciding where their money
 * goes. So every figure quoted here has been computed, not composed.
 *
 * Nothing this endpoint does writes anything.
 */

export const debtAdvisorRouter = Router();
debtAdvisorRouter.use(requireAuth);

const MODEL = "claude-opus-5";

// Enough for a conversation with real working in it, bounded so a runaway
// exchange can't run up an unbounded bill.
const MAX_TURNS = 24;
const MAX_TOOL_ROUNDS = 8;

const SIMULATE_TOOL = {
  name: "simulate_payoff",
  description:
    "Works out, month by month, what happens to the user's debts at a given level of extra payment under a given strategy. Returns the payoff time, total interest, the order debts are cleared in, and which debt the extra payment is aimed at. Call this for every figure you quote — never estimate a payoff time or an interest saving yourself. Call it several times to compare, e.g. at different extra amounts.",
  input_schema: {
    type: "object" as const,
    properties: {
      currency: {
        type: "string",
        description: "Which currency's debts to simulate. Debts in different currencies are paid from different pockets and are never combined.",
      },
      monthly_extra: {
        type: "number",
        description: "Amount paid each month on top of the contractual minimums. 0 for the do-nothing baseline.",
      },
      strategy: {
        type: "string",
        enum: ["avalanche", "snowball", "both"],
        description: "avalanche aims the extra at the highest rate, snowball at the smallest balance, both returns each for comparison.",
      },
    },
    required: ["currency", "monthly_extra", "strategy"],
  },
};

const SYSTEM_PROMPT = [
  "You help someone understand their own debts and how to clear them faster. You are looking at their real accounts.",
  "",
  "Every number you state about payoff time, interest, or savings must come from a simulate_payoff call. Never calculate one yourself and never estimate — the tool exists because these have exactly one right answer. Balances and rates you may quote directly from the account list.",
  "",
  "Lead with the answer to what was asked. Be concrete: name the account, give the figure, say what it means. Keep it short — a few sentences and the numbers that support them, not an essay.",
  "",
  "Where the arithmetic is close, say so, and note that snowball's advantage is that clearing something quickly is easier to keep up with, while avalanche always costs less in interest.",
  "",
  "Say plainly when the data can't answer the question — an account with no interest rate recorded, or a debt with no monthly payment, limits what can be worked out, and the fix is to add it on the Accounts page. Never invent a rate.",
  "",
  "You are not a regulated adviser. Give the arithmetic and the trade-offs; leave anything turning on circumstances you cannot see — job security, other savings, penalties for overpaying — to the user, and say when that is what it turns on.",
].join("\n");

interface AccountRow {
  id: string;
  name: string;
  currency: string;
  account_type: string | null;
  balance: number | null;
  balance_is_manual: boolean | null;
  overdraft_limit: number | null;
  loan_rate: number | null;
  loan_monthly_payment: number | null;
  loan_end_date: string | null;
  source: string;
}

/**
 * The user's debts, as the simulator needs them.
 *
 * Mirrors the client's rule for what counts as borrowing: a negative balance
 * whatever the account is called. Balances come from the same place the
 * Accounts page reads them from, so the advisor and the screen can't disagree.
 */
async function loadDebts(userId: string): Promise<DebtInput[]> {
  const accounts = (await db
    .prepare("SELECT * FROM accounts WHERE user_id = ?")
    .all(userId)) as unknown as AccountRow[];

  const sums = (await db
    .prepare("SELECT account_id, SUM(amount) AS total FROM transactions WHERE user_id = ? GROUP BY account_id")
    .all(userId)) as unknown as { account_id: string; total: number }[];
  const byAccount = new Map(sums.map((s) => [s.account_id, Number(s.total)]));

  return accounts
    .map((a) => {
      const derived = byAccount.get(a.id) ?? 0;
      const balance =
        a.balance_is_manual && a.balance != null
          ? a.balance
          : a.source === "enablebanking" && a.balance != null
            ? a.balance
            : derived;
      return { account: a, owed: Math.max(0, -balance) };
    })
    .filter(({ owed }) => owed > 0)
    .map(({ account, owed }) => ({
      id: account.id,
      name: account.name,
      balance: owed,
      rate: account.loan_rate ?? 0,
      minimumPayment: account.loan_monthly_payment ?? 0,
      currency: account.currency,
    }));
}

function describeDebts(debts: DebtInput[]): string {
  if (debts.length === 0) return "This person currently owes nothing on any account.";

  const lines = debts.map((d) => {
    const rate = d.rate > 0 ? `${d.rate}% a year` : "interest rate not recorded";
    const payment = d.minimumPayment > 0 ? `${d.minimumPayment.toFixed(2)} a month` : "no monthly payment recorded";
    return `- ${d.name}: ${d.balance.toFixed(2)} ${d.currency} owed, ${rate}, ${payment}`;
  });

  const currencies = [...new Set(debts.map((d) => d.currency))];
  return [
    "Their debts right now:",
    ...lines,
    "",
    currencies.length > 1
      ? `These span ${currencies.join(", ")}. Simulate each currency separately — they are paid from different pockets, and a total across them would be meaningless.`
      : `All in ${currencies[0]}.`,
  ].join("\n");
}

function runTool(input: Record<string, unknown>, debts: DebtInput[]): unknown {
  const currency = typeof input.currency === "string" ? input.currency.toUpperCase() : "";
  const extra = typeof input.monthly_extra === "number" && Number.isFinite(input.monthly_extra) ? Math.max(0, input.monthly_extra) : 0;
  const strategy = input.strategy === "snowball" ? "snowball" : input.strategy === "both" ? "both" : "avalanche";

  const scoped = debts.filter((d) => d.currency.toUpperCase() === currency);
  if (scoped.length === 0) {
    return {
      error: `No debts in ${currency || "that currency"}. Available: ${[...new Set(debts.map((d) => d.currency))].join(", ") || "none"}.`,
    };
  }

  return strategy === "both" ? compareStrategies(scoped, extra) : simulate(scoped, extra, strategy);
}

/**
 * The payoff curve, for charting.
 *
 * Served from the same simulator the adviser uses rather than recomputed in
 * the browser, so the picture and the figures quoted beside it can never
 * disagree — and the arithmetic stays in the one place that has tests.
 */
debtAdvisorRouter.get("/projection", async (req, res) => {
  const extra = Number(req.query.extra);
  const extraPerMonth = Number.isFinite(extra) && extra > 0 ? extra : 0;

  const debts = await loadDebts(req.user!.id);
  const currencies = [...new Set(debts.map((d) => d.currency))];

  res.json(
    currencies.map((currency) => {
      const scoped = debts.filter((d) => d.currency === currency);
      const minimums = simulate(scoped, 0, "avalanche");
      // Only worth returning when it differs from the baseline, which it
      // doesn't at zero extra.
      const withExtra = extraPerMonth > 0 ? simulate(scoped, extraPerMonth, "avalanche") : null;
      return {
        currency,
        debts: scoped.map((d) => ({ name: d.name, balance: d.balance, rate: d.rate })),
        minimums,
        withExtra,
      };
    })
  );
});

debtAdvisorRouter.post("/", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "The adviser needs an AI key configured." });
    return;
  }

  const { messages } = req.body as { messages?: unknown };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages is required" });
    return;
  }

  const history = messages
    .filter((m): m is { role: string; content: string } => !!m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  if (history.length === 0) {
    res.status(400).json({ error: "no usable messages" });
    return;
  }

  try {
    const debts = await loadDebts(req.user!.id);
    const client = new Anthropic();
    const conversation: Anthropic.MessageParam[] = [...history];
    // Surfaced to the user so the working behind an answer is inspectable
    // rather than something they have to take on trust.
    const workings: { input: unknown; result: unknown }[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: `${SYSTEM_PROMPT}\n\n${describeDebts(debts)}`,
        tools: [SIMULATE_TOOL],
        messages: conversation,
      });

      if (response.stop_reason !== "tool_use") {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        res.json({ reply: text || "I couldn't work that one out — try asking it a different way.", workings });
        return;
      }

      conversation.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const result = runTool(block.input as Record<string, unknown>, debts);
        workings.push({ input: block.input, result });
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }

      conversation.push({ role: "user", content: results });
    }

    // Out of rounds rather than out of ideas: better to say so than to return
    // a half-finished answer as though it were complete.
    res.json({
      reply: "That took more working out than I can do in one go — try narrowing the question, say to one account or one monthly amount.",
      workings,
    });
  } catch (err) {
    console.error("Debt advisor failed:", err);
    res.status(502).json({ error: "The adviser couldn't answer just then. Worth trying again." });
  }
});
