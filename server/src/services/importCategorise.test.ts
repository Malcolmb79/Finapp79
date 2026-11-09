import { afterEach, describe, expect, it } from "vitest";
import { categoriseImport } from "./importCategorise.js";

/**
 * The reported bug was "I click Suggest categories and nothing happens".
 *
 * Nothing was broken in the sense of throwing — the service returned a list
 * of nulls and the dialog had nothing to say about it, which from the outside
 * is indistinguishable from a dead button. These pin the sentence each empty
 * result now carries.
 *
 * The no-key path is checked before any database access, so it can be
 * exercised here without one.
 */
const saved = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved;
});

const rows = [{ id: "1", description: "TESCO STORES 3288", counterparty: null }];

describe("categoriseImport, when it has nothing to offer", () => {
  it("says so when the server has no API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await categoriseImport("user-1", rows);

    expect(result.note).toMatch(/API key/i);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toEqual({ categoryId: null, proposedCategory: null });
    expect(result.proposed).toEqual([]);
  });

  // Nothing to categorise is not a failure and needs no explanation — the
  // caller knows it passed an empty list.
  it("stays quiet when there was nothing to categorise", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await categoriseImport("user-1", [])).note).toBeNull();
  });

  it("returns one suggestion slot per row, however it failed", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const many = [...rows, { id: "2", description: "SHELL", counterparty: null }];
    const result = await categoriseImport("user-1", many);
    // The caller zips these against rows by index, so a short list would
    // attach suggestions to the wrong transactions.
    expect(result.suggestions).toHaveLength(many.length);
  });
});
