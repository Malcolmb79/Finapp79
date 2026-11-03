import { afterEach, describe, expect, it } from "vitest";
import { parseTransports, relyingParty, wouldLockOut } from "./passkeys.js";

const ENV_KEYS = ["PASSKEY_RP_ID", "PASSKEY_ORIGIN", "CLIENT_URL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

/**
 * A credential is bound to its RP ID for good, so resolving it wrongly is not
 * a config annoyance — it is every registered passkey becoming unusable.
 */
describe("relyingParty", () => {
  it("uses an explicit RP ID, defaulting the origin to https", () => {
    setEnv({ PASSKEY_RP_ID: "finapp79-server.vercel.app" });
    expect(relyingParty()).toEqual({
      rpID: "finapp79-server.vercel.app",
      origin: "https://finapp79-server.vercel.app",
      rpName: "Personal Finance",
    });
  });

  it("lets an explicit origin override the derived one", () => {
    setEnv({ PASSKEY_RP_ID: "example.test", PASSKEY_ORIGIN: "http://example.test:8080" });
    expect(relyingParty()?.origin).toBe("http://example.test:8080");
  });

  // So local dev needs no new configuration at all.
  it("derives both from CLIENT_URL when no RP ID is set", () => {
    setEnv({ CLIENT_URL: "http://localhost:5173" });
    expect(relyingParty()).toMatchObject({ rpID: "localhost", origin: "http://localhost:5173" });
  });

  // The port belongs in the origin and must not leak into the RP ID — an RP
  // ID is a domain, and "localhost:5173" is not one.
  it("keeps the port out of the RP ID", () => {
    setEnv({ CLIENT_URL: "http://localhost:5173" });
    expect(relyingParty()?.rpID).not.toContain("5173");
  });

  it("reports nothing configured rather than guessing", () => {
    setEnv({});
    expect(relyingParty()).toBeNull();
  });

  it("treats an unparseable CLIENT_URL as unconfigured", () => {
    setEnv({ CLIENT_URL: "not a url" });
    expect(relyingParty()).toBeNull();
  });
});

describe("parseTransports", () => {
  it("round-trips what WebAuthn reports", () => {
    expect(parseTransports(JSON.stringify(["internal", "hybrid"]))).toEqual(["internal", "hybrid"]);
  });

  it("treats a missing or unusable value as unknown rather than empty", () => {
    // undefined means "no preference", which is right; [] would claim the
    // authenticator supports no transports at all.
    expect(parseTransports(null)).toBeUndefined();
    expect(parseTransports("not json")).toBeUndefined();
    expect(parseTransports(JSON.stringify({ nope: true }))).toBeUndefined();
    expect(parseTransports(JSON.stringify([1, 2]))).toBeUndefined();
  });
});

/**
 * The lockout guard. theultracyclist uses a PASSKEY_ONLY flag for this; here
 * it is derived from the account, which cannot fall out of step with reality.
 */
describe("wouldLockOut", () => {
  it("refuses the last passkey on an account with no password", () => {
    expect(wouldLockOut(0, null)).toBe(true);
  });

  it("allows it when a password is still a way in", () => {
    expect(wouldLockOut(0, "$2b$10$hash")).toBe(false);
  });

  it("allows it while another passkey remains", () => {
    expect(wouldLockOut(1, null)).toBe(false);
  });
});
