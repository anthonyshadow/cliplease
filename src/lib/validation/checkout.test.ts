import { describe, expect, it } from "vitest";
import { DEMO_REQUEST as DEMO } from "../../../tests/helpers/checkout-fixtures";
import { DETAILS_COPY } from "../licensing/details";
import { StartCheckoutSchema } from "./checkout";

/** The first issue of `change` applied to the demo request: [path, message], or null when it parses. */
function issue(change: Record<string, unknown>) {
  const result = StartCheckoutSchema.safeParse({ ...DEMO, ...change });
  if (result.success) return null;
  const [first] = result.error.issues;
  return [first?.path.join("."), first?.message];
}

describe("StartCheckoutSchema (02 §5.7; P15)", () => {
  it("accepts the demo request", () => {
    expect(StartCheckoutSchema.parse(DEMO)).toEqual(DEMO);
  });

  it("tidies the names a buyer types (owner answer Q-108 a)", () => {
    const parsed = StartCheckoutSchema.parse({
      ...DEMO,
      licenseeName: "  Daily‮Laughs   Media​ LLC ",
      intendedUse: "line one\r\nline two",
    });
    expect(parsed.licenseeName).toBe("DailyLaughs Media LLC");
    expect(parsed.intendedUse).toBe("line one line two");
    expect(issue({ licenseeName: "​" })).toEqual([
      "licenseeName",
      DETAILS_COPY.licenseeEmpty,
    ]);
    expect(issue({ contactName: " " })).toEqual([
      "contactName",
      DETAILS_COPY.nameEmpty,
    ]);
    expect(issue({ contactName: "x".repeat(121) })).toEqual([
      "contactName",
      DETAILS_COPY.nameLong,
    ]);
  });

  it("refuses a licensee name that holds a web address, keeping a company named by its domain (owner answer Q-136 a)", () => {
    for (const licenseeName of [
      "Payout on hold, confirm at evil.example/verify",
      "See https://evil.example",
      "www.evil.example",
      "HTTP://EVIL.EXAMPLE",
    ]) {
      expect(issue({ licenseeName })).toEqual([
        "licenseeName",
        DETAILS_COPY.licenseeWebAddress,
      ]);
    }
    for (const licenseeName of ["Booking.com B.V.", "AC/DC Productions"]) {
      expect(issue({ licenseeName })).toBeNull();
    }
    // The contact name never reaches an email subject or /verify.
    expect(issue({ contactName: "www.evil.example" })).toBeNull();
  });

  it("trims the email before checking it; normalizeEmail stores it lowercased (07 D126)", () => {
    expect(
      StartCheckoutSchema.parse({
        ...DEMO,
        buyerEmail: "  Ana.Buyer@Studio.COM ",
      }).buyerEmail,
    ).toBe("Ana.Buyer@Studio.COM");
  });

  it("refuses a 201-character use, a bad email and unticked terms, in the docs' words", () => {
    expect(issue({ intendedUse: "x".repeat(201) })).toEqual([
      "intendedUse",
      DETAILS_COPY.intendedUseLong,
    ]);
    expect(issue({ intendedUse: "x".repeat(200) })).toBeNull();
    expect(issue({ buyerEmail: "sam@" })).toEqual([
      "buyerEmail",
      DETAILS_COPY.email,
    ]);
    expect(issue({ acceptTerms: false })).toEqual([
      "acceptTerms",
      DETAILS_COPY.terms,
    ]);
  });

  it("holds the territory to its code: a listed country, a region key, nothing for Worldwide", () => {
    const country = { territoryKey: "country" };
    const region = { territoryKey: "region" };
    expect(issue({ ...country, territoryCode: "FR" })).toBeNull();
    expect(issue({ ...region, territoryCode: "europe" })).toBeNull();
    for (const code of ["FRA", "fr", "AQ", "XK", null]) {
      expect(issue({ ...country, territoryCode: code })).toEqual([
        "territoryCode",
        DETAILS_COPY.chooseCountry,
      ]);
    }
    for (const code of ["FR", "north-america", null]) {
      expect(issue({ ...region, territoryCode: code })).toEqual([
        "territoryCode",
        DETAILS_COPY.chooseRegion,
      ]);
    }
    for (const code of ["CA", "europe", ""]) {
      expect(issue({ territoryCode: code })?.[0]).toBe("territoryCode");
    }
  });
});
