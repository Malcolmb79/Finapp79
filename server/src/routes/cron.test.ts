import { afterEach, describe, expect, it } from "vitest";
import { authorised } from "./cron.js";

const savedSecret = process.env.CRON_SECRET;
const savedEnv = process.env.NODE_ENV;

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
  if (savedEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedEnv;
});

/**
 * This route has no session behind it and will call a bank API once per linked
 * account. The failure that matters is it being open in production, where
 * anyone who found the URL could make the deployment hammer the provider.
 */
describe("the scheduled sync's guard", () => {
  it("accepts the secret Vercel sends", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(authorised("Bearer s3cret")).toBe(true);
  });

  it("refuses everything else once a secret is set", () => {
    process.env.CRON_SECRET = "s3cret";
    for (const header of ["Bearer wrong", "s3cret", "Basic s3cret", "", undefined]) {
      expect(authorised(header), String(header)).toBe(false);
    }
  });

  // Open in dev on purpose: there is only a sandbox database behind it, and
  // requiring a secret to try it would mean it never got tried.
  it("is open in development when no secret is configured", () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "development";
    expect(authorised(undefined)).toBe(true);
  });

  // The case that would be a real hole: deployed, and nobody set the secret.
  it("is shut in production when no secret is configured", () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "production";
    expect(authorised(undefined)).toBe(false);
    expect(authorised("Bearer anything")).toBe(false);
  });
});
