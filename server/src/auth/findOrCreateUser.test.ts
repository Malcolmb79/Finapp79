import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSignupAllowed } from "./findOrCreateUser.js";

const saved = process.env.ALLOWED_SIGNUP_EMAIL;

beforeEach(() => {
  delete process.env.ALLOWED_SIGNUP_EMAIL;
});

afterEach(() => {
  if (saved === undefined) delete process.env.ALLOWED_SIGNUP_EMAIL;
  else process.env.ALLOWED_SIGNUP_EMAIL = saved;
});

describe("isSignupAllowed", () => {
  it("allows any email when unset, matching every other optional config in this app", () => {
    expect(isSignupAllowed("anyone@example.com")).toBe(true);
  });

  it("allows only the configured address once set", () => {
    process.env.ALLOWED_SIGNUP_EMAIL = "malcolm@barsky.co.za";
    expect(isSignupAllowed("malcolm@barsky.co.za")).toBe(true);
    expect(isSignupAllowed("someoneelse@example.com")).toBe(false);
  });

  it("compares case-insensitively and ignores surrounding whitespace", () => {
    process.env.ALLOWED_SIGNUP_EMAIL = "  Malcolm@Barsky.co.za  ";
    expect(isSignupAllowed("malcolm@barsky.co.za")).toBe(true);
    expect(isSignupAllowed("MALCOLM@BARSKY.CO.ZA")).toBe(true);
  });
});
