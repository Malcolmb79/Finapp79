import { describe, expect, it } from "vitest";
import { categoryFlags } from "./categories.js";

const none = { counts_as_income: false, income_is_occasional: false, is_transfer: false };
const regular = { counts_as_income: true, income_is_occasional: false, is_transfer: false };
const occasional = { counts_as_income: true, income_is_occasional: true, is_transfer: false };
const transfer = { counts_as_income: false, income_is_occasional: false, is_transfer: true };

/**
 * The pair has one combination that cannot mean anything, so these rules are
 * what stop a category being occasional income without being income at all -
 * a state in which the projection ignores it and the totals count it.
 */
describe("categoryFlags", () => {
  it("marks a category as regular income", () => {
    expect(categoryFlags(none, { counts_as_income: true })).toEqual(regular);
  });

  it("marking something occasional makes it income too", () => {
    expect(categoryFlags(none, { income_is_occasional: true })).toEqual(occasional);
  });

  // Otherwise a category left over from an earlier marking stays occasional
  // while not being income, and the next person to read the row cannot tell.
  it("clearing income clears occasional with it", () => {
    expect(categoryFlags(occasional, { counts_as_income: false })).toEqual(none);
  });

  it("moves between regular and occasional without losing income", () => {
    expect(categoryFlags(regular, { income_is_occasional: true })).toEqual(occasional);
    expect(categoryFlags(occasional, { income_is_occasional: false })).toEqual(regular);
  });

  it("leaves the flag it was not asked about alone", () => {
    expect(categoryFlags(occasional, { counts_as_income: true })).toEqual(occasional);
  });

  // "not income" and "occasional income" in one breath. Picking a winner
  // would be guessing at which half was meant.
  it("refuses a patch that contradicts itself", () => {
    expect(categoryFlags(occasional, { counts_as_income: false, income_is_occasional: true })).toBeNull();
  });

  it("refuses a patch that says nothing, or says it with the wrong type", () => {
    expect(categoryFlags(none, {})).toBeNull();
    expect(categoryFlags(none, { counts_as_income: "yes" })).toBeNull();
    expect(categoryFlags(none, { income_is_occasional: 1 })).toBeNull();
  });
});

/**
 * A transfer is the household's own money arriving from the household's own
 * account. Counted naively it adds to income *and* to spending from one
 * event, so a household moving 2,000 to savings each month reports 2,000 more
 * earned and 2,000 more spent than happened — and a savings rate built on
 * those two figures is wrong top and bottom.
 */
describe("categoryFlags and transfers", () => {
  it("marks a category as a transfer", () => {
    expect(categoryFlags(none, { is_transfer: true })).toEqual(transfer);
  });

  // It is not income, so it cannot be occasional income either.
  it("clears both income flags when something becomes a transfer", () => {
    expect(categoryFlags(occasional, { is_transfer: true })).toEqual(transfer);
    expect(categoryFlags(regular, { is_transfer: true })).toEqual(transfer);
  });

  // Rather than leaving a row claiming to be both, which would have every
  // total disagree with itself depending which flag it read.
  it("stops being a transfer when it is declared income", () => {
    expect(categoryFlags(transfer, { counts_as_income: true })).toEqual(regular);
    expect(categoryFlags(transfer, { income_is_occasional: true })).toEqual(occasional);
  });

  it("can stop being a transfer without becoming anything else", () => {
    expect(categoryFlags(transfer, { is_transfer: false })).toEqual(none);
  });

  it("leaves the other flags alone when only the transfer flag moves", () => {
    expect(categoryFlags(none, { is_transfer: false })).toEqual(none);
  });

  it("refuses anything that is not a boolean", () => {
    expect(categoryFlags(none, { is_transfer: "yes" })).toBeNull();
  });
});
