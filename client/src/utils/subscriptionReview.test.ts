import { describe, expect, it } from "vitest";
import type { Category, SubscriptionReview } from "../api/client.js";
import { checkedPhrase, nextCharge, reviewItems, REVIEW_GOOD_FOR_DAYS } from "./subscriptionReview.js";
import { taggedSubscriptions } from "./taggedSubscriptions.js";

const TODAY = "2026-11-16";
const SUBS = { id: 1, name: "Subscriptions", parent_id: null, is_subscription: true } as Category;

/** Monthly charges ending on `last`, which is what makes one live or dormant. */
const monthly = (description: string, amount: number, last = "2026-11-03") => {
  const end = Date.parse(last);
  return [2, 1, 0].map((back) => ({
    amount: -amount,
    booking_date: new Date(end - back * 30 * 86_400_000).toISOString().slice(0, 10),
    description,
    counterparty: null,
    category_id: SUBS.id,
  }));
};

const subs = (...charges: ReturnType<typeof monthly>[]) => taggedSubscriptions(charges.flat(), [SUBS]);

const review = (over: Partial<SubscriptionReview> = {}): SubscriptionReview => ({
  merchant_key: "netflix com",
  label: "Netflix.com",
  reviewed_at: null,
  ...over,
});

describe("reviewItems", () => {
  /**
   * The ordering is the feature. A subscription does not fail by being
   * expensive — €9.99 is small enough that no month forces the issue — it
   * fails by never being questioned, so sorting by price means the €6 thing
   * nobody remembers never reaches the screen.
   */
  it("puts the longest unexamined first, not the dearest", () => {
    const rows = reviewItems(
      subs(monthly("NETFLIX.COM", 25.99), monthly("SPOTIFY", 9.99)),
      [review({ reviewed_at: "2026-11-01" })],
      [],
      TODAY
    );
    expect(rows.map((r) => r.subscription.label)).toEqual(["Spotify", "Netflix.com"]);
  });

  // Where nothing has been confirmed there is nothing else to go on, so the
  // dearest is the better guess at what to look at first.
  it("falls back to cost where neither has ever been looked at", () => {
    const rows = reviewItems(subs(monthly("NETFLIX.COM", 25.99), monthly("SPOTIFY", 900)), [], [], TODAY);
    expect(rows.map((r) => r.subscription.label)).toEqual(["Spotify", "Netflix.com"]);
  });

  it("treats a confirmation older than a year as no confirmation", () => {
    const stale = new Date(Date.parse(TODAY) - (REVIEW_GOOD_FOR_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
    const [row] = reviewItems(subs(monthly("NETFLIX.COM", 25.99)), [review({ reviewed_at: stale })], [], TODAY);
    expect(row.flags).toContain("stale");
    expect(row.flags).not.toContain("never-checked");
  });

  it("leaves a recent confirmation alone", () => {
    const [row] = reviewItems(subs(monthly("NETFLIX.COM", 25.99)), [review({ reviewed_at: "2026-10-01" })], [], TODAY);
    expect(row.flags).toEqual([]);
    expect(row.checkedDaysAgo).toBe(46);
  });

  it("flags one that has quietly stopped charging", () => {
    const [row] = reviewItems(subs(monthly("NETFLIX.COM", 25.99, "2026-01-02")), [], [], TODAY);
    expect(row.flags).toContain("dormant");
    expect(row.nextDue).toBeNull();
  });

  /**
   * Calling a newly tagged subscription dormant because it has only charged
   * once would be exactly backwards: without a rhythm there is nothing for it
   * to be overdue against.
   */
  it("never calls a subscription with no established rhythm dormant", () => {
    const one = [{ amount: -25.99, booking_date: "2025-01-02", description: "NETFLIX.COM", counterparty: null, category_id: SUBS.id }];
    const [row] = reviewItems(taggedSubscriptions(one, [SUBS]), [], [], TODAY);
    expect(row.flags).toContain("new");
    expect(row.flags).not.toContain("dormant");
    expect(row.annual).toBeNull();
  });
});

describe("nextCharge", () => {
  it("steps on from the last charge to the next one still ahead", () => {
    expect(nextCharge({ cadence: "monthly", lastCharged: "2026-11-02" }, TODAY)).toBe("2026-12-02");
  });

  /**
   * Deliberately null for a dormant one. Stepping forward from a year-old
   * charge to produce "due next Tuesday" is the same invention `stillLive`
   * exists to stop in the balance projection.
   */
  it("refuses to predict a charge for something that stopped", () => {
    expect(nextCharge({ cadence: "monthly", lastCharged: "2025-02-02" }, TODAY)).toBeNull();
  });

  // A date needs a rhythm to come from.
  it("says nothing where the rhythm is not known", () => {
    expect(nextCharge({ cadence: null, lastCharged: "2026-11-02" }, TODAY)).toBeNull();
  });
});

describe("checkedPhrase", () => {
  it("counts in the units somebody would use", () => {
    expect(checkedPhrase(null)).toBe("Never checked");
    expect(checkedPhrase(0)).toBe("Checked today");
    expect(checkedPhrase(14)).toBe("Checked 14 days ago");
    expect(checkedPhrase(420)).toBe("Checked 14 months ago");
    expect(checkedPhrase(800)).toBe("Checked 2 years ago");
  });
});
