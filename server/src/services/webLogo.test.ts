import { describe, expect, it } from "vitest";
import { isValidDomain } from "./webLogo.js";

// The domain here comes from a model rather than from a user or a directory,
// so this is the boundary that decides what is allowed to reach the network at
// all. It runs before the value is used, even though it only ever becomes a
// query parameter.
describe("isValidDomain", () => {
  it("accepts the shapes real banks use", () => {
    for (const domain of ["fnb.co.za", "aib.ie", "revolut.com", "bankofireland.com", "n26.com", "capitecbank.co.za"]) {
      expect(isValidDomain(domain), domain).toBe(true);
    }
  });

  it("rejects anything carrying a scheme, path, port or credentials", () => {
    for (const domain of [
      "https://fnb.co.za",
      "fnb.co.za/logo.png",
      "fnb.co.za:8080",
      "user:pass@fnb.co.za",
      "fnb.co.za?x=1",
      "//fnb.co.za",
    ]) {
      expect(isValidDomain(domain), domain).toBe(false);
    }
  });

  it("rejects bare hosts and addresses that name no public site", () => {
    // A single label can name something on a private network; an IP literal
    // names a host directly. Neither is ever a bank's website.
    for (const domain of ["localhost", "intranet", "127.0.0.1", "192.168.1.1", ""]) {
      expect(isValidDomain(domain), domain).toBe(false);
    }
  });

  it("rejects malformed labels", () => {
    for (const domain of ["-fnb.co.za", "fnb-.co.za", "fnb..co.za", "fnb.co.za.", ".fnb.co.za"]) {
      expect(isValidDomain(domain), domain).toBe(false);
    }
  });

  it("rejects a hostname longer than DNS allows", () => {
    expect(isValidDomain(`${"a".repeat(250)}.com`)).toBe(false);
  });
});
