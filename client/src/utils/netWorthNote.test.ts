import { describe, expect, it } from "vitest";
import { netWorthNote } from "./netWorthNote.js";

/**
 * The figure this annotates is the one somebody glances at to know where they
 * stand. It reading +8,814 while the accounts page shows -2,975 is not a
 * rounding disagreement, it is two different claims, and the note is what
 * makes the larger one checkable.
 */

const money = (value: number) => `€${value.toFixed(2)}`;
const base = { policyTotal: 0, holdingTotal: 0, coverNames: [] as string[], money };

describe("netWorthNote", () => {
  // Nothing to disclose means nothing to say. A permanent line saying the
  // total is only the accounts is noise that trains somebody not to read it.
  it("says nothing when the figure really is just the accounts", () => {
    expect(netWorthNote(base)).toBeNull();
  });

  it("names what the policies add", () => {
    expect(netWorthNote({ ...base, policyTotal: 11790.73 })).toBe("incl. €11790.73 in policies");
  });

  it("names investments too, and both together", () => {
    expect(netWorthNote({ ...base, holdingTotal: 2500 })).toBe("incl. €2500.00 in investments");
    expect(netWorthNote({ ...base, policyTotal: 11790.73, holdingTotal: 2500 })).toBe(
      "incl. €11790.73 in policies and €2500.00 in investments"
    );
  });

  /**
   * Property belongs in the same sentence for the same reason the other two
   * do: it is the largest single thing that can sit inside this figure without
   * appearing anywhere on the accounts page.
   */
  it("names property, and joins three of them readably", () => {
    expect(netWorthNote({ ...base, propertyTotal: 222000 })).toBe("incl. €222000.00 in property");
    expect(netWorthNote({ ...base, policyTotal: 100, holdingTotal: 200, propertyTotal: 300 })).toBe(
      "incl. €100.00 in policies, €200.00 in investments and €300.00 in property"
    );
  });

  /**
   * A sum assured is what pays out on death, not money anybody holds.
   * Counting it is allowed; letting it disappear into a total is not.
   */
  it("names a policy counted at its cover amount", () => {
    const note = netWorthNote({ ...base, policyTotal: 11790.73, coverNames: ["Liberty Life"] });
    expect(note).toContain("Liberty Life at cover");
    expect(note).toContain("pays out rather than being held");
  });

  it("names two of them, and counts more than two", () => {
    expect(netWorthNote({ ...base, policyTotal: 100, coverNames: ["A", "B"] })).toContain("A and B at cover");
    expect(netWorthNote({ ...base, policyTotal: 100, coverNames: ["A", "B", "C"] })).toContain("3 policies at cover");
  });

  // A policy can drag the total down as easily as up; the note should still
  // appear, because the disagreement with the accounts page is the point.
  it("discloses a negative contribution too", () => {
    expect(netWorthNote({ ...base, policyTotal: -500 })).toBe("incl. €-500.00 in policies");
  });
});
