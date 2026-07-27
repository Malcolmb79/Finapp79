import { describe, expect, it } from "vitest";
import { ASSUMED_CARD_PAYMENT, assumedMinimum, compareStrategies, simulate, type DebtInput } from "./debtStrategy.js";

const debt = (name: string, balance: number, rate: number, minimumPayment: number): DebtInput => ({
  id: name,
  name,
  balance,
  rate,
  minimumPayment,
  currency: "EUR",
});

describe("simulate", () => {
  it("clears an interest-free debt in exactly the months the payments cover", () => {
    const result = simulate([debt("Card", 1000, 0, 100)], 0, "avalanche");
    expect(result.months).toBe(10);
    expect(result.totalInterest).toBe(0);
    expect(result.totalPaid).toBe(1000);
  });

  // Checked against the closed-form amortisation formula rather than against
  // this implementation: n = -ln(1 - Ai/P) / ln(1+i) gives 22.43 months for
  // 10,000 at 12% paid 500 a month, so it clears during month 23, having cost
  // roughly 500 × 22.43 - 10,000 ≈ 1,213 in interest.
  it("charges interest monthly on the reducing balance", () => {
    const result = simulate([debt("Loan", 10_000, 12, 500)], 0, "avalanche");
    expect(result.months).toBe(23);
    expect(result.totalInterest).toBeGreaterThan(1150);
    expect(result.totalInterest).toBeLessThan(1250);
  });

  it("says so when the payments never clear the debt", () => {
    // 20% on 10,000 is about 167 a month in interest alone.
    const result = simulate([debt("Card", 10_000, 20, 100)], 0, "avalanche");
    expect(result.neverClears).toBe(true);
    expect(result.months).toBeNull();
  });

  it("puts the extra payment at the dearest debt under avalanche", () => {
    const debts = [debt("Cheap", 2000, 5, 50), debt("Dear", 2000, 25, 50)];
    expect(simulate(debts, 400, "avalanche").focusOrder[0]).toBe("Dear");
  });

  it("puts it at the smallest balance under snowball", () => {
    const debts = [debt("Small", 500, 5, 25), debt("Large", 5000, 25, 100)];
    expect(simulate(debts, 400, "snowball").focusOrder[0]).toBe("Small");
  });

  it("moves to the next debt once the target clears", () => {
    const debts = [debt("First", 500, 20, 25), debt("Second", 500, 10, 25)];
    expect(simulate(debts, 300, "avalanche").focusOrder).toEqual(["First", "Second"]);
  });

  // The reason either strategy beats paying minimums: a cleared debt's
  // minimum joins the pot rather than disappearing.
  it("rolls a cleared debt's minimum into the next one", () => {
    const debts = [debt("First", 300, 0, 100), debt("Second", 1200, 0, 100)];
    const result = simulate(debts, 0, "snowball");
    // 1,500 total at 200 a month is 8 months once the first debt's minimum
    // rolls over; paying 100 each in isolation would take 12.
    expect(result.months).toBe(8);
  });

  it("never pays more than is owed", () => {
    const result = simulate([debt("Card", 100, 0, 500)], 1000, "avalanche");
    expect(result.totalPaid).toBe(100);
    expect(result.months).toBe(1);
  });

  it("invents a minimum only where the debt states none", () => {
    // Without a floor this sits accruing interest forever and every plan
    // built on it is wrong.
    const result = simulate([debt("No terms", 1000, 10, 0)], 0, "avalanche");
    expect(result.monthlyOutlay).toBeGreaterThan(0);
  });
});

describe("compareStrategies", () => {
  // Avalanche is never worse on interest — that is what makes it the default
  // recommendation, and snowball's case is behavioural rather than arithmetic.
  it("costs no more in interest under avalanche than snowball", () => {
    const debts = [debt("Small dear", 800, 28, 30), debt("Large cheap", 6000, 6, 120)];
    const { avalanche, snowball } = compareStrategies(debts, 300);
    expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest);
  });

  // What the two strategies actually disagree about is where the spare money
  // goes — not which debt happens to clear first. A tiny cheap debt clears
  // early on its own minimum either way, while avalanche is pointing every
  // spare penny at the expensive one. Reading the clearing order as the
  // recommendation would get the advice backwards.
  it("disagrees about what to aim at, not about what clears first", () => {
    const debts = [debt("Tiny cheap", 200, 2, 20), debt("Big dear", 9000, 24, 200)];
    const { avalanche, snowball } = compareStrategies(debts, 200);

    expect(avalanche.focusOrder[0]).toBe("Big dear");
    expect(snowball.focusOrder[0]).toBe("Tiny cheap");
    // Both clear the tiny debt first regardless, on its minimum alone.
    expect(avalanche.order[0].name).toBe("Tiny cheap");
    expect(snowball.order[0].name).toBe("Tiny cheap");
  });
});

// The series behind the chart. It comes from the same run as the headline
// figures so the picture can't disagree with the number printed beside it.
describe("balanceByMonth", () => {
  it("starts at what is owed today and ends at nothing", () => {
    const result = simulate([debt("Card", 1000, 0, 100)], 0, "avalanche");
    expect(result.balanceByMonth[0]).toBe(1000);
    expect(result.balanceByMonth[result.balanceByMonth.length - 1]).toBe(0);
  });

  it("has one point per month plus today", () => {
    const result = simulate([debt("Card", 1000, 0, 100)], 0, "avalanche");
    expect(result.balanceByMonth).toHaveLength((result.months ?? 0) + 1);
  });

  it("only ever falls while the debt is being cleared", () => {
    const debts = [debt("A", 3000, 18, 100), debt("B", 1500, 6, 50)];
    const { balanceByMonth } = simulate(debts, 200, "avalanche");
    for (let i = 1; i < balanceByMonth.length; i++) {
      expect(balanceByMonth[i]).toBeLessThanOrEqual(balanceByMonth[i - 1]);
    }
  });

  // The case worth seeing on a chart: payments below the interest, so the
  // line climbs instead of falling.
  it("rises when the payments don't cover the interest", () => {
    const { balanceByMonth } = simulate([debt("Card", 10_000, 24, 100)], 0, "avalanche");
    expect(balanceByMonth[12]).toBeGreaterThan(balanceByMonth[0]);
  });
});

const card = (name: string, balance: number, rate: number, minimumPayment = 0): DebtInput => ({
  ...debt(name, balance, rate, minimumPayment),
  type: "credit_card",
});

/**
 * What a card is assumed to be paid until its real figure is imported. The
 * shape of this assumption decides the answer rather than refining it, which
 * is why it is pinned here.
 */
describe("assumed credit card minimums", () => {
  it("uses the standing figure, in the account's own currency", () => {
    expect(assumedMinimum(card("Visa", 5000, 24))).toBe(ASSUMED_CARD_PAYMENT);
    expect(assumedMinimum({ ...card("Rand card", 5000, 24), currency: "ZAR" })).toBe(ASSUMED_CARD_PAYMENT);
  });

  it("never pays more than is left owing", () => {
    // Nobody pays 300 against 40 outstanding.
    expect(assumedMinimum(card("Nearly clear", 40, 20))).toBe(40);
  });

  it("clears an ordinary card rather than growing forever", () => {
    // The failure this replaced: a flat 1% against a 20% card pays 1% while
    // being charged 1.67%, and reported "never clears" for a card being paid
    // perfectly normally.
    const result = simulate([card("Visa", 5000, 20)], 0, "avalanche");
    expect(result.neverClears).toBe(false);
    expect(result.months).not.toBeNull();
  });

  it("leaves a stated payment alone", () => {
    // Once the real figure is imported it wins outright.
    const result = simulate([card("Visa", 5000, 20, 250)], 0, "avalanche");
    expect(result.monthlyOutlay).toBe(250);
  });

  it("keeps the percentage for anything that isn't a card", () => {
    // A loan or an overdraft has no conventional card minimum to imitate.
    expect(assumedMinimum(debt("Overdraft", 5000, 24, 0))).toBeCloseTo(50, 2);
  });

  it("still lets extra payments do their work", () => {
    const alone = simulate([card("Visa", 5000, 20)], 0, "avalanche");
    const pushed = simulate([card("Visa", 5000, 20)], 200, "avalanche");
    expect(pushed.months!).toBeLessThan(alone.months!);
    expect(pushed.totalInterest).toBeLessThan(alone.totalInterest);
  });
});
