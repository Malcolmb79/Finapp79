import { describe, expect, it } from "vitest";
import type { Account } from "../api/client.js";
import { behindPhrase, statementsDue, STALE_AFTER_DAYS } from "./statementsDue.js";

const TODAY = "2026-11-16";

const account = (over: Partial<Account> = {}): Account =>
  ({
    id: "a1",
    name: "FNB Cheque",
    currency: "ZAR",
    source: "manual",
    last_import_at: "2026-09-02T10:00:00",
    last_imported_date: "2026-09-01",
    ...over,
  }) as Account;

describe("statementsDue", () => {
  it("lists an account whose statements stopped arriving", () => {
    const [due] = statementsDue([account()], TODAY);
    expect(due.account.name).toBe("FNB Cheque");
    expect(due.coversTo).toBe("2026-09-01");
    expect(due.daysBehind).toBe(76);
  });

  /**
   * A monthly statement covering the 8th to the 7th is only issued on the
   * 7th, so coverage on a perfectly maintained account drifts to thirty-odd
   * days old every month purely by waiting for the next one to exist. Firing
   * there would nag every account every month for being up to date.
   */
  it("leaves alone an account merely waiting for its next statement", () => {
    expect(statementsDue([account({ last_imported_date: "2026-11-07" })], TODAY)).toEqual([]);
    expect(statementsDue([account({ last_imported_date: "2026-10-20" })], TODAY)).toEqual([]);
  });

  it("fires exactly at the threshold and not a day before", () => {
    const onTheDay = new Date(Date.parse(TODAY) - STALE_AFTER_DAYS * 86_400_000).toISOString().slice(0, 10);
    const dayBefore = new Date(Date.parse(TODAY) - (STALE_AFTER_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    expect(statementsDue([account({ last_imported_date: onTheDay })], TODAY)).toHaveLength(1);
    expect(statementsDue([account({ last_imported_date: dayBefore })], TODAY)).toHaveLength(0);
  });

  /**
   * Coverage, not the upload date. An import done yesterday carrying nothing
   * newer than March means the account has been fed and is still months
   * stale — measuring the upload would call that one up to date.
   */
  it("measures how far the statements reach, not when they were uploaded", () => {
    const [due] = statementsDue([account({ last_import_at: "2026-11-15T09:00:00", last_imported_date: "2026-03-31" })], TODAY);
    expect(due).toBeTruthy();
    expect(due.daysBehind).toBe(230);
    expect(due.lastImportAt).toBe("2026-11-15T09:00:00");
  });

  // A linked account takes no statements at all. When one goes quiet it is a
  // sync failure or a lapsed authorisation, and both already say so in their
  // own words — a third alert saying the same thing differently is noise.
  it("never asks for a statement on a linked account", () => {
    expect(statementsDue([account({ source: "enablebanking" })], TODAY)).toEqual([]);
  });

  /**
   * An account kept by hand, or one created an hour ago, has no statement
   * habit to be behind on. Inferring one from nothing would put every manual
   * account on this list permanently, which is how a prompt gets muted.
   */
  it("never asks for a statement on an account that has never had one", () => {
    expect(statementsDue([account({ last_import_at: null, last_imported_date: null })], TODAY)).toEqual([]);
  });

  it("says nothing about an account hidden from every total", () => {
    expect(statementsDue([account({ hidden: true })], TODAY)).toEqual([]);
  });

  // An import that brought in no dated rows leaves nothing to measure, and
  // the upload date answers a different question than the one being asked.
  it("says nothing when there is no coverage to measure", () => {
    expect(statementsDue([account({ last_imported_date: null })], TODAY)).toEqual([]);
  });

  it("puts the furthest behind first", () => {
    const due = statementsDue(
      [
        account({ id: "a", name: "Recent", last_imported_date: "2026-10-01" }),
        account({ id: "b", name: "Ancient", last_imported_date: "2026-02-01" }),
      ],
      TODAY
    );
    expect(due.map((d) => d.account.name)).toEqual(["Ancient", "Recent"]);
  });
});

describe("behindPhrase", () => {
  it("counts in days until months read better", () => {
    expect(behindPhrase(41)).toBe("41 days behind");
    expect(behindPhrase(76)).toBe("2 months behind");
    expect(behindPhrase(230)).toBe("7 months behind");
  });
});
