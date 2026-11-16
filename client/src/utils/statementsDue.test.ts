import { describe, expect, it } from "vitest";
import type { Account } from "../api/client.js";
import { behindPhrase, NEW_ACCOUNT_GRACE_DAYS, statementsDue, statementsMissing, STALE_AFTER_DAYS } from "./statementsDue.js";

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

describe("statementsMissing", () => {
  const empty = (over: Partial<Account> = {}): Account =>
    ({
      id: "new",
      name: "FNB Savings",
      currency: "ZAR",
      source: "manual",
      last_import_at: null,
      last_imported_date: null,
      transaction_count: 0,
      created_at: "2026-09-01 10:00:00",
      ...over,
    }) as Account;

  it("lists an account nothing has ever gone into", () => {
    expect(statementsMissing([empty()], TODAY).map((a) => a.name)).toEqual(["FNB Savings"]);
  });

  /**
   * The reason `statementDue` refuses to guess at a never-imported account,
   * and the reason this one asks a narrower question instead. An account kept
   * by hand has no imports either — telling somebody their hand-kept savings
   * account is missing a statement is how a list like this gets ignored.
   */
  it("says nothing about an account being kept by hand", () => {
    expect(statementsMissing([empty({ transaction_count: 12 })], TODAY)).toEqual([]);
  });

  // Even one entry is somebody maintaining it some other way, and that is
  // not ours to second-guess.
  it("treats a single entry as a way of keeping it", () => {
    expect(statementsMissing([empty({ transaction_count: 1 })], TODAY)).toEqual([]);
  });

  it("says nothing about an account that has been imported to", () => {
    expect(statementsMissing([empty({ last_import_at: "2026-09-02T10:00:00" })], TODAY)).toEqual([]);
  });

  /**
   * An account created this morning is not missing anything. The gap between
   * making one and feeding it is part of setting the thing up, and a prompt
   * during it is a prompt about your own unfinished sentence.
   */
  it("gives a new account a few days before asking", () => {
    expect(statementsMissing([empty({ created_at: TODAY })], TODAY)).toEqual([]);
    const threeDaysAgo = new Date(Date.parse(TODAY) - NEW_ACCOUNT_GRACE_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(statementsMissing([empty({ created_at: threeDaysAgo })], TODAY)).toHaveLength(1);
  });

  // A linked account fills itself from the bank. An empty one is waiting for
  // its first sync, which is a different prompt with its own words.
  it("never asks a linked account for a statement", () => {
    expect(statementsMissing([empty({ source: "enablebanking" })], TODAY)).toEqual([]);
  });

  it("says nothing about an account hidden from every total", () => {
    expect(statementsMissing([empty({ hidden: true })], TODAY)).toEqual([]);
  });

  // Being behind and never having been fed are different states, and an
  // account can only be in one of them.
  it("does not overlap with the accounts that are behind", () => {
    const accounts = [empty(), account()];
    expect(statementsMissing(accounts, TODAY)).toHaveLength(1);
    expect(statementsDue(accounts, TODAY)).toHaveLength(1);
    expect(statementsMissing(accounts, TODAY)[0].id).not.toBe(statementsDue(accounts, TODAY)[0].account.id);
  });
});

describe("a count that never arrived", () => {
  /**
   * Absence of information is not evidence of emptiness. A response without
   * the count — an older deployment, or any caller that builds an Account
   * without one — must not put every hand-kept account on the list.
   */
  it("says nothing when the server didn't say how many transactions there are", () => {
    const unknown = {
      id: "u",
      name: "Hand-kept",
      currency: "EUR",
      source: "manual",
      last_import_at: null,
      last_imported_date: null,
      created_at: "2026-01-01 10:00:00",
    } as Account;
    expect(statementsMissing([unknown], TODAY)).toEqual([]);
  });
});
