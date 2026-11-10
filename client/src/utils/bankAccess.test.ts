import { describe, expect, it } from "vitest";
import { bankAccess } from "./bankAccess.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

/**
 * A warning that is always on screen is not a warning, so most of what this
 * guards is the long stretch where there is nothing to say.
 */
describe("bankAccess", () => {
  it("says nothing for most of the ninety days", () => {
    expect(bankAccess(inDays(60), NOW)).toBeNull();
    expect(bankAccess(inDays(15), NOW)).toBeNull();
  });

  it("warns inside the last fortnight, while reconnecting is still a small job", () => {
    expect(bankAccess(inDays(14), NOW)).toEqual({ state: "expiring", days: 14 });
    expect(bankAccess(inDays(1), NOW)?.state).toBe("expiring");
  });

  it("is plain once it has lapsed", () => {
    expect(bankAccess(inDays(-1), NOW)?.state).toBe("expired");
    expect(bankAccess(inDays(-40), NOW)?.state).toBe("expired");
  });

  // A manual account has no bank behind it, and a malformed date is not a
  // reason to put a red mark on screen.
  it("says nothing when there is no usable date", () => {
    expect(bankAccess(null, NOW)).toBeNull();
    expect(bankAccess(undefined, NOW)).toBeNull();
    expect(bankAccess("not a date", NOW)).toBeNull();
  });
});
