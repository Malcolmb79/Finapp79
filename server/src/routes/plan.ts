import { Router } from "express";
import { db } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { analyseSpending } from "../services/budgetPlanner.js";
import { loadDebts } from "../services/debtAccounts.js";
import { simulate } from "../services/debtStrategy.js";
import { loadRates } from "../services/exchangeRates.js";

/**
 * What a month has spare, and what it buys.
 *
 * Everything here already existed separately — what comes in and goes out
 * (budgetPlanner), what is owed and at what rate (debtAccounts), what is being
 * saved towards (savings goals). Held apart they answer "how am I doing"; put
 * together they answer "what should I do with the difference", which is the
 * question a plan is.
 *
 * No advice and no model: this is arithmetic, and the choice between clearing
 * debt faster and saving more is the user's.
 */

export const planRouter = Router();
planRouter.use(requireAuth);

const BASE_CURRENCY = "EUR";

interface SavingsGoalRow {
  id: number;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
}

/** Spending restated in one currency, so income and outgoings can be compared. */
async function monthlyFlows(userId: string) {
  const rows = (await db
    .prepare(
      `SELECT t.amount, t.booking_date, t.currency, c.name AS category_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         JOIN accounts a ON a.id = t.account_id
        WHERE t.user_id = ? AND t.reviewed_at IS NOT NULL AND NOT a.hidden`
    )
    .all(userId)) as unknown as { amount: number; booking_date: string; currency: string; category_name: string | null }[];

  const rates = await loadRates(BASE_CURRENCY);
  const dropped = new Set<string>();
  const converted = rows.flatMap((row) => {
    if (row.currency === BASE_CURRENCY) return [{ amount: row.amount, booking_date: row.booking_date, category: row.category_name }];
    const perBase = rates?.rates?.[row.currency];
    if (!perBase) {
      dropped.add(row.currency);
      return [];
    }
    return [{ amount: row.amount / perBase, booking_date: row.booking_date, category: row.category_name }];
  });

  return { analysis: analyseSpending(converted, BASE_CURRENCY), dropped: [...dropped], rates };
}

planRouter.get("/", async (req, res) => {
  try {
    const { analysis, dropped, rates } = await monthlyFlows(req.user!.id);
    const debts = await loadDebts(req.user!.id);

    // Debt payments in the base currency, since a rand loan and a euro card
    // are being paid out of the same monthly surplus.
    const inBase = (amount: number, currency: string) => {
      if (currency === BASE_CURRENCY) return amount;
      const perBase = rates?.rates?.[currency];
      return perBase ? amount / perBase : null;
    };

    const debtRows = debts.map((debt) => {
      const payment = debt.minimumPayment > 0 ? debt.minimumPayment : 0;
      return {
        id: debt.id,
        name: debt.name,
        currency: debt.currency,
        balance: debt.balance,
        rate: debt.rate,
        minimumPayment: payment,
        balanceInBase: inBase(debt.balance, debt.currency),
        paymentInBase: inBase(payment, debt.currency),
      };
    });

    const committedDebt = debtRows.reduce((sum, d) => sum + (d.paymentInBase ?? 0), 0);

    const goals = (await db
      .prepare("SELECT id, name, target_amount, current_amount, target_date FROM savings_goals WHERE user_id = ? ORDER BY target_date NULLS LAST")
      .all(req.user!.id)) as unknown as SavingsGoalRow[];

    res.json({
      currency: BASE_CURRENCY,
      monthsCovered: analysis.monthsCovered,
      typicalIncome: analysis.typicalIncome,
      typicalSpend: analysis.typicalSpend,
      // What is left before anything is decided. Debt minimums are already
      // inside typicalSpend where they were actually paid, so subtracting them
      // again here would double-count them — the surplus is simply what did
      // not go out.
      surplus: Math.round((analysis.typicalIncome - analysis.typicalSpend) * 100) / 100,
      committedDebt: Math.round(committedDebt * 100) / 100,
      categories: analysis.categories.slice(0, 8).map((c) => ({ category: c.category, typical: c.typical, volatility: c.volatility })),
      debts: debtRows,
      goals: goals.map((g) => ({
        id: g.id,
        name: g.name,
        target: g.target_amount,
        saved: g.current_amount,
        targetDate: g.target_date,
        remaining: Math.max(0, g.target_amount - g.current_amount),
      })),
      dropped,
    });
  } catch (err) {
    console.error("Plan failed:", err);
    res.status(502).json({ error: "Couldn't put the figures together just then." });
  }
});

/**
 * What a given split does.
 *
 * The debt side is simulated properly rather than divided out: paying an extra
 * amount at the dearest debt first changes the payoff date and the interest by
 * quite different amounts, and a plan that assumed otherwise would promise a
 * date it can't meet.
 */
planRouter.post("/simulate", async (req, res) => {
  const { toDebt, toSavings, months } = req.body as { toDebt?: unknown; toSavings?: unknown; months?: unknown };
  const extraToDebt = Number.isFinite(Number(toDebt)) ? Math.max(0, Number(toDebt)) : 0;
  const perMonthSaved = Number.isFinite(Number(toSavings)) ? Math.max(0, Number(toSavings)) : 0;
  const horizon = Number.isFinite(Number(months)) ? Math.min(600, Math.max(1, Math.round(Number(months)))) : 24;

  try {
    const debts = await loadDebts(req.user!.id);
    // One currency at a time: debts in different currencies are paid from
    // different pockets, and a single payoff date across them would be a
    // fiction.
    const currencies = [...new Set(debts.map((d) => d.currency))];

    const byCurrency = currencies.map((currency) => {
      const scoped = debts.filter((d) => d.currency === currency);
      const now = simulate(scoped, 0, "avalanche");
      const withExtra = simulate(scoped, extraToDebt, "avalanche");
      return {
        currency,
        now: { months: now.months, totalInterest: now.totalInterest, neverClears: now.neverClears },
        withExtra: { months: withExtra.months, totalInterest: withExtra.totalInterest, neverClears: withExtra.neverClears },
        monthsSaved: now.months != null && withExtra.months != null ? now.months - withExtra.months : null,
        interestSaved: Math.round((now.totalInterest - withExtra.totalInterest) * 100) / 100,
        focusOrder: withExtra.focusOrder,
      };
    });

    res.json({ debt: byCurrency, savings: { perMonth: perMonthSaved, months: horizon, total: Math.round(perMonthSaved * horizon * 100) / 100 } });
  } catch (err) {
    console.error("Plan simulation failed:", err);
    res.status(502).json({ error: "Couldn't work that split out just then." });
  }
});
