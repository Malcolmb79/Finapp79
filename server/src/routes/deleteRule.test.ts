import { describe, expect, it } from "vitest";
import { mayDelete } from "./transactions.js";

/**
 * A synced or imported transaction is meant to stay in step with where it came
 * from, so hand-deleting one leaves the app disagreeing with the bank and
 * nothing on screen to say why. The exception is a duplicate, which is the one
 * case where holding that line does harm: the same payment can be stored twice
 * — a bank reporting it once as pending and again as booked issues two
 * references and passes its own dedupe, and a payment arriving once by sync
 * and once by import passes both, since neither check sees the other.
 *
 * The rule is tested apart from the route because what matters is the decision,
 * not the SQL that feeds it.
 */
describe("what may be deleted", () => {
  it("lets go of anything entered by hand", () => {
    expect(mayDelete("manual", false)).toBe(true);
    expect(mayDelete("manual", true)).toBe(true);
  });

  // The whole point of the exception.
  it("lets go of a synced or imported row that duplicates another", () => {
    expect(mayDelete("enablebanking", true)).toBe(true);
    expect(mayDelete("csv", true)).toBe(true);
  });

  /**
   * The boundary worth guarding. Without this, a client could delete any
   * synced transaction simply by asking, and the rule that keeps the app in
   * step with the bank would exist in name only.
   */
  it("refuses a synced or imported row that stands alone", () => {
    expect(mayDelete("enablebanking", false)).toBe(false);
    expect(mayDelete("csv", false)).toBe(false);
  });
});
