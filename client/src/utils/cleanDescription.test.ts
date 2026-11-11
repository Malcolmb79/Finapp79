import { describe, expect, it } from "vitest";
import { cleanDescription } from "./cleanDescription.js";

/**
 * Every shape here was read off a real bank feed, but the names, IBANs and
 * card tails are invented: a test fixture is published to a repository and
 * somebody's actual merchants and account numbers have no business in one.
 * What is being tested is the format, and the format is what was real.
 */
describe("cleanDescription", () => {
  const cases: [string, string][] = [
    // Card-scheme prefixes, and the type the provider appends from its own
    // field rather than from the bank's text.
    ["VDP-EXAMPLE SHOP Purchase", "Example Shop"],
    ["VDC-SAMPLE CAFE Purchase", "Sample Cafe"],
    ["VDP-Example.ie Purchase", "Example.ie"],
    ["VDP-EXAMPLE.COM/BILL Purchase", "Example.com/bill"],
    ["PET INSURANCE Purchase", "Pet Insurance"],
    ["ACCOUNT FEE OCT 26 Fees and charges", "Account Fee Oct 26"],
    // Small words stay down inside a name the bank shouted.
    ["VDP-SAMPLE AND SONS Purchase", "Sample and Sons"],
    // Payment processors in front of the merchant.
    ["VDP-MGP*Examplely Purchase", "Examplely"],
    ["VDP-SP EXAMPLECYCLE Purchase", "Examplecycle"],
    ["VDC-TST-Sample Diner Purchase", "Sample Diner"],
    // The FX tail is the conversion, not the payee.
    ["VDP-EXAMPLEAI 12.30 USD@ 1.113122 INCL FX FEE E0.45 Purchase", "Exampleai"],
    ["VDP-Examplebank**0000* 150.00 GBP@ 0.832039 INCL FX FEE E3.15 Purchase", "Examplebank"],
    ["VDP-Examplebank**0000* Purchase", "Examplebank"],
    // IBAN, mandate reference, date and URL all stripped from a direct debit.
    ["D/D SAMPLE OPTICIANS IE00000000000000 1111111-2222-333333 Direct debit", "Sample Opticians"],
    ["D/D EXAMPLE SA-D IE00000000000000 2026-11-01 Direct debit", "Example Sa-D"],
    ["D/D Sample Homes IE00000000000000 WWW.EXAMPLE.COM, Direct debit", "Sample Homes"],
    // A name said twice with a reference between it, which the stripping
    // itself pushes together.
    ["EXAMPLE CO IE00000000000000 EXAMPLE CO Funds transfer", "Example Co"],
    // A date stamped into the middle of the name, with no separators for a
    // numeric pattern to catch - and which, sitting between two copies of
    // the payee, also stopped the repeat being collapsed.
    ["*EXAMPLE CO IE00000000000000 TxnDate: 03Sep2026 *EXAMPLE CO Funds transfer", "Example Co"],
    // The metadata blob some banks append after the payee.
    ["EXAMPLE CO { TransactionSubType : Purchase }", "Example Co"],
  ];

  for (const [raw, expected] of cases) {
    it(`reads ${JSON.stringify(raw.slice(0, 44))} as ${JSON.stringify(expected)}`, () => {
      expect(cleanDescription(raw)).toBe(expected);
    });
  }

  // A name the bank sent in mixed case was written by someone who meant it.
  it("leaves a name that was not shouted alone", () => {
    expect(cleanDescription("Sample Store")).toBe("Sample Store");
    expect(cleanDescription("VDC-O'Example Bar Purchase")).toBe("O'Example Bar");
  });

  // Better a description nobody can read than a blank row.
  it("keeps the original when everything in it was noise", () => {
    expect(cleanDescription("IE00000000000000 Direct debit")).toBe("IE00000000000000 Direct debit");
    expect(cleanDescription("000000000000000000 IE00000000000000 Funds transfer")).toBe(
      "000000000000000000 IE00000000000000 Funds transfer"
    );
  });

  it("copes with nothing at all", () => {
    expect(cleanDescription(null)).toBe("");
    expect(cleanDescription(undefined)).toBe("");
    expect(cleanDescription("   ")).toBe("");
  });
});
