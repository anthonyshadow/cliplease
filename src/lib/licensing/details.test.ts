import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EMAIL_RE } from "../validation/email";
import { DETAILS_COPY, detailsErrors, detailsFieldError } from "./details";

describe("detailsFieldError (the form's blur checks; owner answer Q-109 a)", () => {
  it("asks for each name, then keeps it to 120 characters after tidying", () => {
    expect(detailsFieldError("licenseeName", " ​ ")).toBe(
      DETAILS_COPY.licenseeEmpty,
    );
    expect(detailsFieldError("contactName", "")).toBe(DETAILS_COPY.nameEmpty);
    expect(detailsFieldError("contactName", "x".repeat(121))).toBe(
      DETAILS_COPY.nameLong,
    );
    expect(
      detailsFieldError("licenseeName", "Daily Laughs Media LLC"),
    ).toBeNull();
  });

  it("asks for an email like name@example.com, and lets the use be empty", () => {
    expect(detailsFieldError("buyerEmail", "sam@")).toBe(DETAILS_COPY.email);
    expect(detailsFieldError("buyerEmail", " sam@dailylaughs.com ")).toBeNull();
    expect(detailsFieldError("intendedUse", "")).toBeNull();
    expect(detailsFieldError("intendedUse", "x".repeat(201))).toBe(
      DETAILS_COPY.intendedUseLong,
    );
  });

  it("checks an email with the server's own pattern (Zod 4's default z.email())", () => {
    const typos = [
      "maya@studio.c",
      "name@example.com.",
      "first..last@example.com",
      "a@b_c.com",
      "josé@example.com",
      ".a@b.com",
      "a.@b.com",
      "a@-b.com",
      "a@b..com",
    ];
    const good = ["sam@dailylaughs.com", "o'neil+ads@studio.co.uk"];
    for (const email of typos) {
      expect(detailsFieldError("buyerEmail", email)).toBe(DETAILS_COPY.email);
    }
    for (const email of good) {
      expect(detailsFieldError("buyerEmail", email)).toBeNull();
    }
    const server = z.email();
    for (const email of [...typos, ...good]) {
      expect(EMAIL_RE.test(email)).toBe(server.safeParse(email).success);
    }
  });
});

describe("detailsErrors (the press-time check)", () => {
  const filled = {
    licenseeName: "Daily Laughs Media LLC",
    contactName: "Sam Lee",
    buyerEmail: "sam@dailylaughs.com",
    intendedUse: "",
    acceptTerms: true,
  };

  it("passes a filled form, the use left empty", () => {
    expect(detailsErrors(filled)).toEqual({});
  });

  it("names every field that needs fixing, the terms box included", () => {
    expect(
      detailsErrors({
        ...filled,
        licenseeName: " ",
        buyerEmail: "sam@",
        acceptTerms: false,
      }),
    ).toEqual({
      licenseeName: DETAILS_COPY.licenseeEmpty,
      buyerEmail: DETAILS_COPY.email,
      acceptTerms: DETAILS_COPY.terms,
    });
  });
});
