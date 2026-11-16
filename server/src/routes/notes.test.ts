import { describe, expect, it } from "vitest";
import { MAX_BODY, noteBody, positionBetween } from "./notes.js";

describe("noteBody", () => {
  it("takes text, trimmed", () => {
    expect(noteBody("  Cancel the gym  ")).toBe("Cancel the gym");
  });

  /**
   * A note of three spaces is an empty row that cannot be told from a real
   * one on screen, and cannot be deleted by anybody who did not mean to make
   * it.
   */
  it("refuses a note that is only whitespace", () => {
    expect(noteBody("   ")).toBeNull();
    expect(noteBody("")).toBeNull();
  });

  it("refuses what is not text at all", () => {
    expect(noteBody(42)).toBeNull();
    expect(noteBody(null)).toBeNull();
    expect(noteBody(undefined)).toBeNull();
  });

  // Long enough for a real reminder, short enough that this is not a
  // document store.
  it("holds a note to a sentence or two", () => {
    expect(noteBody("x".repeat(MAX_BODY))).toHaveLength(MAX_BODY);
    expect(noteBody("x".repeat(MAX_BODY + 1))).toBeNull();
  });
});

describe("positionBetween", () => {
  /**
   * Halfway between its new neighbours, so moving one row writes one row.
   * Renumbering the list on every drag turns a reorder into a write per note,
   * which on a shared household list is a lot of rows changing for one
   * person's drag.
   */
  it("lands halfway between two neighbours", () => {
    expect(positionBetween(2, 4)).toBe(3);
    expect(positionBetween(0, 1)).toBe(0.5);
  });

  it("goes above the top and below the bottom", () => {
    expect(positionBetween(null, 0)).toBe(-1);
    expect(positionBetween(5, null)).toBe(6);
  });

  it("starts at zero on an empty list", () => {
    expect(positionBetween(null, null)).toBe(0);
  });

  // Halving survives a lot of drags before it runs out of room, and the
  // alternative costs a write per row every time.
  it("keeps finding room between two adjacent positions", () => {
    let low = 0;
    const high = 1;
    for (let i = 0; i < 20; i++) {
      const next = positionBetween(low, high);
      expect(next).toBeGreaterThan(low);
      expect(next).toBeLessThan(high);
      low = next;
    }
  });
});
