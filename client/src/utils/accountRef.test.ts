import { describe, expect, it } from "vitest";
import { shortRef } from "./accountRef.js";

describe("shortRef", () => {
  it("shows the tail a bank itself quotes back", () => {
    expect(shortRef("IE29AIBK93115212345678")).toBe("••5678");
    expect(shortRef("4929 1366 1482 0001")).toBe("••0001");
  });

  // Hiding most of a long identifier is the point: these screens sit open in
  // rooms, get shared with a household member and end up in screenshots.
  it("never shows more than the tail of a long number", () => {
    const shown = shortRef("12345678901234567890")!;
    expect(shown).toBe("••7890");
    expect(shown).not.toContain("1234567");
  });

  // A benefit number like "4" masked to "••4" would say less than the bare
  // digit and look as though something were being withheld.
  it("leaves a number too short to be worth hiding alone", () => {
    expect(shortRef("4")).toBe("4");
    expect(shortRef("0001")).toBe("0001");
  });

  it("ignores the spacing a number is printed with", () => {
    expect(shortRef("  4929 1366 1482 0001  ")).toBe("••0001");
  });

  it("says nothing when there is no number", () => {
    expect(shortRef(null)).toBeNull();
    expect(shortRef(undefined)).toBeNull();
    expect(shortRef("   ")).toBeNull();
  });
});
