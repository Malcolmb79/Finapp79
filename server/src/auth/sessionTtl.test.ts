import { afterEach, describe, expect, it } from "vitest";
import { sessionTtlMs } from "./sessionTtl.js";

const saved = process.env.SESSION_TTL_MINUTES;

afterEach(() => {
  if (saved === undefined) delete process.env.SESSION_TTL_MINUTES;
  else process.env.SESSION_TTL_MINUTES = saved;
});

const MINUTE = 60 * 1000;

/**
 * This decides how long someone stays signed in to their own finances, so the
 * failure that matters is a bad value quietly becoming a very long session —
 * which is what the old seven-day cookie was, and why a second window never
 * asked for anything.
 */
describe("sessionTtlMs", () => {
  it("defaults to an hour when nothing is configured", () => {
    delete process.env.SESSION_TTL_MINUTES;
    expect(sessionTtlMs()).toBe(60 * MINUTE);
  });

  it("uses a configured value", () => {
    process.env.SESSION_TTL_MINUTES = "15";
    expect(sessionTtlMs()).toBe(15 * MINUTE);
  });

  // A typo is the realistic way a ten-week session gets configured, so the
  // cap matters more than the default does.
  it("caps at a day", () => {
    process.env.SESSION_TTL_MINUTES = "100000";
    expect(sessionTtlMs()).toBe(1440 * MINUTE);
  });

  it("falls back rather than trusting a value that makes no sense", () => {
    for (const value of ["0", "-30", "", "soon", "NaN"]) {
      process.env.SESSION_TTL_MINUTES = value;
      expect(sessionTtlMs(), value).toBe(60 * MINUTE);
    }
  });
});
