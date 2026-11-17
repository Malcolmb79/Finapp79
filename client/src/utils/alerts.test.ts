import { describe, expect, it } from "vitest";
import type { Account, Budget } from "../api/client.js";
import { deriveAlerts, undismissed, type Alert } from "./alerts.js";
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
  incomes: 1,
  monthlyIncome: 2400,
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

  /**
   * The rule this replaced was "quiet until ninety per cent", which is
   * accurate and too late: by then the month cannot be spent differently.
   */
  it("speaks before the limit is reached when the pace points well past it", () => {
    const hot = deriveAlerts({ ...base, budgets: [budget({ spent: 359 })] }, FROM);
    expect(hot[0].severity).toBe("warning");
    expect(hot[0].title).toContain("running hot");
    expect(hot[0].detail).toContain("by month end");
  });

  // A category tracking inside its limit is the ordinary state of a budget,
  // and a warning for it would fire on most categories most months.
  it("stays quiet when the pace lands inside the limit", () => {
    expect(deriveAlerts({ ...base, budgets: [budget({ spent: 120 })] }, FROM)).toEqual([]);
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

describe("a statement that stopped arriving", () => {
  const stale = {
    id: "fnb",
    name: "FNB Cheque",
    currency: "ZAR",
    source: "manual",
    last_import_at: "2026-08-20T09:00:00",
    last_imported_date: "2026-08-19",
  } as Account;

  /**
   * The quietest failure the app has after a broken sync, and quieter still:
   * a sync that breaks leaves an error, where a statement nobody uploaded
   * leaves nothing at all. The account simply stops changing.
   */
  it("asks for one once the next statement should already exist", () => {
    const [alert] = deriveAlerts({ ...base, accounts: [stale] }, FROM);
    expect(alert.kind).toBe("statement");
    expect(alert.title).toBe("FNB Cheque needs a statement");
    expect(alert.detail).toContain("2026-08-19");
    expect(alert.href).toBe("/accounts");
  });

  // The test every alert in this file has to pass: it must be silent while
  // the account is merely waiting for its next statement to be issued.
  it("stays quiet on an account that is up to date", () => {
    expect(deriveAlerts({ ...base, accounts: [{ ...stale, last_imported_date: "2026-11-07" }] }, FROM)).toEqual([]);
  });

  it("ranks below a failing sync and above a budget", () => {
    const kinds = deriveAlerts(
      {
        ...base,
        accounts: [stale, { ...stale, id: "b", name: "Broken", last_sync_error: "token expired" } as Account],
        budgets: [budget({ spent: 500 })],
      },
      FROM
    ).map((a) => a.kind);
    // Severity first: a failing sync and an overspent budget are both
    // critical, so they lead regardless of kind. A statement that is merely
    // late is a warning and sits under both.
    expect(kinds).toEqual(["sync", "budget", "statement", "statement"]);
  });
});

describe("what has already been read", () => {
  const alert = (over: Partial<Alert>): Alert => ({
    id: "budget:7",
    kind: "budget",
    severity: "warning",
    title: "Groceries nearly spent",
    detail: "91% of €400",
    href: "/budgets",
    ...over,
  });

  it("hides an alert that has been read", () => {
    expect(undismissed([alert({})], [{ alert_id: "budget:7", severity: "warning" }])).toEqual([]);
  });

  it("leaves the ones that have not", () => {
    const other = alert({ id: "sync:a1", kind: "sync" });
    expect(undismissed([alert({}), other], [{ alert_id: "budget:7", severity: "warning" }])).toEqual([other]);
  });

  /**
   * The rule that keeps this from being a way to bury a problem. These ids
   * name a *thing* rather than a state, so a budget read at 91% spent would
   * otherwise never say anything again when it went over — and the one alert
   * worth having is the one buried.
   */
  it("brings an alert back when it gets worse", () => {
    const worse = alert({ severity: "critical", title: "Groceries over budget" });
    expect(undismissed([worse], [{ alert_id: "budget:7", severity: "warning" }])).toEqual([worse]);
  });

  // Read at its worst, and it stays read. Saying the same thing twice is what
  // teaches somebody to ignore the bell.
  it("keeps it hidden once read at critical", () => {
    const worse = alert({ severity: "critical" });
    expect(undismissed([worse], [{ alert_id: "budget:7", severity: "critical" }])).toEqual([]);
  });

  // An alert that merely goes on being true has been read.
  it("does not bring one back for being unchanged", () => {
    expect(undismissed([alert({})], [{ alert_id: "budget:7", severity: "warning" }])).toEqual([]);
  });

  it("copes with a dismissal for an alert that no longer exists", () => {
    expect(undismissed([], [{ alert_id: "budget:7", severity: "warning" }])).toEqual([]);
  });
});
