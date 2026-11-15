import { describe, expect, it } from "vitest";
import { incomeFlags } from "./categories.js";

const none = { counts_as_income: false, income_is_occasional: false };
const regular = { counts_as_income: true, income_is_occasional: false };
const occasional = { counts_as_income: true, income_is_occasional: true };

/**
 * The pair has one combination that cannot mean anything, so these rules are
 * what stop a category being occasional income without being income at all -
 * a state in which the projection ignores it and the totals count it.
 */
describe("incomeFlags", () => {
  it("marks a category as regular income", () => {
    expect(incomeFlags(none, { counts_as_income: true })).toEqual(regular);
  });

  it("marking something occasional makes it income too", () => {
    expect(incomeFlags(none, { income_is_occasional: true })).toEqual(occasional);
  });

  // Otherwise a category left over from an earlier marking stays occasional
  // while not being income, and the next person to read the row cannot tell.
  it("clearing income clears occasional with it", () => {
    expect(incomeFlags(occasional, { counts_as_income: false })).toEqual(none);
  });

  it("moves between regular and occasional without losing income", () => {
    expect(incomeFlags(regular, { income_is_occasional: true })).toEqual(occasional);
    expect(incomeFlags(occasional, { income_is_occasional: false })).toEqual(regular);
  });

  it("leaves the flag it was not asked about alone", () => {
    expect(incomeFlags(occasional, { counts_as_income: true })).toEqual(occasional);
  });

  // "not income" and "occasional income" in one breath. Picking a winner
  // would be guessing at which half was meant.
  it("refuses a patch that contradicts itself", () => {
    expect(incomeFlags(occasional, { counts_as_income: false, income_is_occasional: true })).toBeNull();
  });

  it("refuses a patch that says nothing, or says it with the wrong type", () => {
    expect(incomeFlags(none, {})).toBeNull();
    expect(incomeFlags(none, { counts_as_income: "yes" })).toBeNull();
    expect(incomeFlags(none, { income_is_occasional: 1 })).toBeNull();
  });
});
