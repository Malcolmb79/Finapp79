import { describe, expect, it } from "vitest";
import type { Category } from "../api/client.js";
import { subscriptionCategories, taggedSubscriptions } from "./taggedSubscriptions.js";

const category = (id: number, name: string, is_subscription = false): Category =>
  ({ id, name, parent_id: null, is_subscription }) as Category;

const SUBS = category(1, "Subscriptions", true);
const UTILITIES = category(2, "Utilities");
const LOANS = category(3, "Loan repayments");

const tx = (over: Partial<Parameters<typeof taggedSubscriptions>[0][number]> = {}) => ({
  amount: -25.99,
  booking_date: "2026-11-03",
  description: "NETFLIX.COM",
  counterparty: null,
  category_id: SUBS.id,
  ...over,
});

/** Monthly charges ending on `last`. */
const monthly = (over: Parameters<typeof tx>[0] = {}, count = 3, last = "2026-11-03") => {
  const end = Date.parse(last);
  return Array.from({ length: count }, (_, i) =>
    tx({ booking_date: new Date(end - (count - 1 - i) * 30 * 86_400_000).toISOString().slice(0, 10), ...over })
  );
};

describe("taggedSubscriptions", () => {
  /**
   * The whole correction. The detector this replaced found a personal loan, a
   * life premium and a phone bill, because all of those come back on a rhythm
   * for a consistent amount — which is what a standing commitment is, and is
   * not what a subscription is. Only the filing holds that difference.
   */
  it("lists only what is filed under a tagged category", () => {
    const rows = taggedSubscriptions(
      [
        ...monthly(),
        ...monthly({ description: "TALKTALK TELECOM", amount: -76.38, category_id: UTILITIES.id }),
        ...monthly({ description: "NOVUNA PERSONAL FINANCE", amount: -187.24, category_id: LOANS.id }),
      ],
      [SUBS, UTILITIES, LOANS]
    );
    expect(rows.map((r) => r.label)).toEqual(["Netflix.com"]);
  });

  it("lists nothing at all until a category is tagged", () => {
    expect(taggedSubscriptions(monthly(), [category(1, "Subscriptions")])).toEqual([]);
  });

  it("follows the tag onto more than one category", () => {
    const streaming = category(4, "Streaming", true);
    const rows = taggedSubscriptions(
      [...monthly(), ...monthly({ description: "SPOTIFY", amount: -9.99, category_id: streaming.id })],
      [SUBS, streaming]
    );
    expect(rows.map((r) => r.categoryName).sort()).toEqual(["Streaming", "Subscriptions"]);
  });

  /**
   * Membership is the tag; the rhythm is description. A subscription tagged
   * last week is still a subscription — it simply has no cadence to measure
   * yet, and an annual cost from one charge would be twelve times a guess.
   */
  it("keeps a subscription charged only once, and says nothing about its rhythm", () => {
    const [row] = taggedSubscriptions([tx()], [SUBS]);
    expect(row.label).toBe("Netflix.com");
    expect(row.occurrences).toBe(1);
    expect(row.cadence).toBeNull();
    expect(row.annual).toBeNull();
    expect(row.monthly).toBeNull();
  });

  it("reads the rhythm once there are enough charges to see one", () => {
    const [row] = taggedSubscriptions(monthly(), [SUBS]);
    expect(row.cadence).toBe("monthly");
    expect(row.annual).toBeCloseTo(311.88);
    expect(row.monthly).toBeCloseTo(25.99);
  });

  it("reads a yearly rhythm as yearly rather than forcing it monthly", () => {
    const rows = taggedSubscriptions(
      ["2024-11-03", "2025-11-03", "2026-11-03"].map((booking_date) => tx({ booking_date, amount: -99 })),
      [SUBS]
    );
    expect(rows[0].cadence).toBe("yearly");
    expect(rows[0].annual).toBeCloseTo(99);
  });

  /**
   * One provider's store numbers and payment references must not become
   * twelve subscriptions — the same grouping the detector uses, and the key a
   * review is recorded against.
   */
  it("groups one provider's charges however the bank wrote them", () => {
    const rows = taggedSubscriptions(
      [tx({ description: "NETFLIX.COM 8841" }), tx({ description: "NETFLIX.COM 9920", booking_date: "2026-10-03" })],
      [SUBS]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrences).toBe(2);
  });

  /**
   * A refund from a provider is filed under the same category and is not a
   * subscription being paid. Counting it would put a negative charge in the
   * history and drag the typical amount down.
   */
  it("ignores money coming back", () => {
    const [row] = taggedSubscriptions([...monthly(), tx({ amount: 25.99, booking_date: "2026-11-10" })], [SUBS]);
    expect(row.occurrences).toBe(3);
    expect(row.lastCharged).toBe("2026-11-03");
  });

  /**
   * The reference on the end of a description changes every month and is
   * stripped before grouping, so the charges still gather — but the name on
   * screen should be the most recent of them rather than whichever happened
   * to arrive first.
   */
  it("names it from the most recent charge", () => {
    const [row] = taggedSubscriptions(
      [
        tx({ description: "NETFLIX.COM 8841", booking_date: "2024-01-03" }),
        tx({ description: "NETFLIX.COM 9920", booking_date: "2026-11-03" }),
      ],
      [SUBS]
    );
    expect(row.label).toBe("Netflix.com 9920");
  });
});

describe("subscriptionCategories", () => {
  it("is the only thing that decides what counts", () => {
    expect(subscriptionCategories([SUBS, UTILITIES, LOANS]).map((c) => c.name)).toEqual(["Subscriptions"]);
  });
});
