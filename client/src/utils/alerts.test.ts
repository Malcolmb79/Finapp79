import { describe, expect, it } from "vitest";
import type { Account, Budget } from "../api/client.js";
import { deriveAlerts } from "./alerts.js";
import type { Forecast, UpcomingBill } from "./forecast.js";

const FROM = "2026-11-10";
const money = (value: number) => `€${value.toFixed(2)}`;

const budget = (over: Partial<Budget> = {}): Budget =>
  ({ id: 1, category_id: 7, category_name: "Groceries", monthly_limit: 400, spent: 100, ...over }) as Budget;

const bill = (over: Partial<UpcomingBill> = {}): UpcomingBill => ({
  key: "rent:2026-11-14",
  label: "RENT",
  dueDate: "2026-11-14",
  amount: 1150,
  cadence: "monthly",
  occurrences: 4,
  ...over,
});

const forecast = (low: { date: string; balance: number } | null): Forecast => ({
  points: [],
  low,
  commitments: 2,
  incomeFound: true,
});

const base = { budgets: [], accounts: [] as Account[], forecast: null, bills: [], money };

/**
 * An alert that fires when nothing is wrong trains you to ignore the one that
 * fires when something is, so most of these are about what must *not* appear.
 */
describe("deriveAlerts", () => {
  it("says nothing when nothing is wrong", () => {
    expect(deriveAlerts({ ...base, budgets: [budget()] }, FROM)).toEqual([]);
  });

  it("flags a budget that is over, and one that is nearly spent", () => {
    const over = deriveAlerts({ ...base, budgets: [budget({ spent: 450 })] }, FROM);
    expect(over[0].severity).toBe("critical");
    expect(over[0].title).toContain("over budget");

    const near = deriveAlerts({ ...base, budgets: [budget({ spent: 370 })] }, FROM);
    expect(near[0].severity).toBe("warning");
    expect(near[0].detail).toContain("€30.00 left");
  });

  it("leaves a budget alone until it is nearly spent", () => {
    expect(deriveAlerts({ ...base, budgets: [budget({ spent: 359 })] }, FROM)).toEqual([]);
  });

  // Division by a zero limit would otherwise produce Infinity and fire
  // permanently.
  it("ignores a budget with no limit set", () => {
    expect(deriveAlerts({ ...base, budgets: [budget({ monthly_limit: 0, spent: 50 })] }, FROM)).toEqual([]);
  });

  // The reason the forecast was worth building: being told on the 2nd that
  // the 14th is short is actionable in a way the 14th is not.
  it("warns when the balance is projected below zero", () => {
    const alerts = deriveAlerts({ ...base, forecast: forecast({ date: "2026-11-20", balance: -240 }) }, FROM);
    expect(alerts[0].kind).toBe("forecast");
    expect(alerts[0].detail).toContain("in 10 days");
  });

  it("says nothing about a forecast that stays positive", () => {
    expect(deriveAlerts({ ...base, forecast: forecast({ date: "2026-11-20", balance: 40 }) }, FROM)).toEqual([]);
  });

  it("mentions only bills that are close", () => {
    const alerts = deriveAlerts({ ...base, bills: [bill(), bill({ key: "far", dueDate: "2026-12-20" })] }, FROM);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("in 4 days");
  });

  // The quietest failure in the app: the account simply stops changing.
  it("flags an account that stopped syncing", () => {
    const account = { id: "a", name: "AIB", last_sync_error: "authorisation expired" } as Account;
    const alerts = deriveAlerts({ ...base, accounts: [account] }, FROM);
    expect(alerts[0].kind).toBe("sync");
    expect(alerts[0].href).toBe("/accounts");
  });

  it("puts what is critical first", () => {
    const alerts = deriveAlerts(
      {
        ...base,
        budgets: [budget({ spent: 370 })],
        forecast: forecast({ date: "2026-11-20", balance: -240 }),
        bills: [bill()],
      },
      FROM
    );
    expect(alerts.map((a) => a.kind)).toEqual(["forecast", "budget", "bill"]);
  });
});
