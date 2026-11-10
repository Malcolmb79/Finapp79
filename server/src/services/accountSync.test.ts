import { describe, expect, it } from "vitest";
import { overlapStart } from "./accountSync.js";

/**
 * A sync asks the bank for everything since a date, and that date is derived
 * from the newest transaction already stored. The derivation is the whole risk:
 * get it wrong in the future direction and the bank rejects the request
 * outright, so the account stops updating because of a transaction that was
 * perfectly valid.
 */
describe("overlapStart", () => {
  const now = new Date("2026-11-10T09:00:00Z");

  it("starts a week behind the newest transaction held", () => {
    expect(overlapStart("2026-11-03", now)).toBe("2026-10-27");
  });

  // The failure this was written for: Enable Banking answered
  // DATE_FROM_IN_FUTURE because a scheduled direct debit was booked eight days
  // ahead, so "newest held minus a week" was tomorrow.
  it("never asks for a date in the future", () => {
    expect(overlapStart("2026-11-18", now)).toBe("2026-11-03");
    expect(overlapStart("2027-06-01", now)).toBe("2026-11-03");
  });

  // Clamping the answer instead of the basis would return today and quietly
  // drop the overlap — precisely when late postings are most likely.
  it("keeps the whole week of overlap when it clamps", () => {
    const from = overlapStart("2026-11-18", now);
    const days = (Date.parse("2026-11-10T00:00:00Z") - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    expect(days).toBe(7);
  });

  it("treats a transaction dated today as today", () => {
    expect(overlapStart("2026-11-10", now)).toBe("2026-11-03");
  });

  it("crosses a month boundary correctly", () => {
    expect(overlapStart("2026-03-04", new Date("2026-03-04T00:00:00Z"))).toBe("2026-02-25");
  });
});
