import { describe, expect, it } from "vitest";
import { goalPatch } from "./savings.js";

/**
 * A goal's target drives the forecast, the progress bar and what the plan
 * says is still needed, so a bad one is not a cosmetic problem. The field
 * that is deliberately missing matters as much as the ones that are here:
 * the amount saved moves only by contributing, so that two devices adding at
 * once cannot overwrite each other.
 */

describe("goalPatch", () => {
  it("takes a new target", () => {
    expect(goalPatch({ target_amount: 90000 })).toEqual({ target_amount: 90000 });
  });

  it("takes a name, trimmed", () => {
    expect(goalPatch({ name: "  House deposit  " })).toEqual({ name: "House deposit" });
  });

  it("takes a date, and takes it away", () => {
    expect(goalPatch({ target_date: "2028-06-30" })).toEqual({ target_date: "2028-06-30" });
    expect(goalPatch({ target_date: null })).toEqual({ target_date: null });
  });

  it("changes only what it was asked to", () => {
    expect(goalPatch({ target_amount: 90000, target_date: "2028-06-30" })).toEqual({
      target_amount: 90000,
      target_date: "2028-06-30",
    });
  });

  // Asking for nothing is a no-op rather than a mistake, so the caller can
  // tell the two apart.
  it("returns an empty patch when the body asks for nothing", () => {
    expect(goalPatch({})).toEqual({});
  });

  /**
   * The amount saved is reached through contributing, which adds a delta. A
   * patch that set it outright would put the client back to reading a figure,
   * adding to it and writing it back - and two devices doing that at once
   * lose one of the contributions, invisibly.
   */
  it("ignores an attempt to set the amount saved", () => {
    expect(goalPatch({ current_amount: 5000 })).toEqual({});
    expect(goalPatch({ current_amount: 5000, target_amount: 90000 })).toEqual({ target_amount: 90000 });
  });

  // A target of zero or less is not a goal, and the progress bar divides by it.
  it("refuses a target that is not a positive number", () => {
    expect(goalPatch({ target_amount: 0 })).toBeNull();
    expect(goalPatch({ target_amount: -1000 })).toBeNull();
    expect(goalPatch({ target_amount: "90000" })).toBeNull();
    expect(goalPatch({ target_amount: Number.NaN })).toBeNull();
  });

  it("refuses an empty name", () => {
    expect(goalPatch({ name: "" })).toBeNull();
    expect(goalPatch({ name: "   " })).toBeNull();
    expect(goalPatch({ name: 42 })).toBeNull();
  });

  it("refuses a date it cannot read", () => {
    expect(goalPatch({ target_date: "30/06/2028" })).toBeNull();
    expect(goalPatch({ target_date: "soon" })).toBeNull();
  });
});
