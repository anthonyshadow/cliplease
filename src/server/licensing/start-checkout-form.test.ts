import { describe, expect, it } from "vitest";
import { DETAILS_COPY } from "@/lib/licensing/details";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";
import { StartCheckoutSchema } from "@/lib/validation/checkout";
import {
  startCheckoutFieldErrors,
  startCheckoutFields,
  startCheckoutRefusal,
} from "./start-checkout-form";

/** The license page's form as the browser posts it (P15's hidden inputs plus the fields). */
function form(change: Record<string, string | null> = {}) {
  const posted: Record<string, string | null> = {
    videoId: "00000000-0000-4000-8000-000000000101",
    useKey: "paid_social",
    termKey: "y1",
    territoryKey: "worldwide",
    territoryCode: "",
    licenseeName: "Daily Laughs Media LLC",
    contactName: "Sam Lee",
    buyerEmail: "sam@dailylaughs.com",
    intendedUse: "",
    acceptTerms: "on",
    termsVersion: "v1",
    submissionId: "3f6b2c1e-8d4a-4f7b-9c2e-1a5d6e7f8a9b",
    expectedTotalCents: "173250",
    timeZone: "America/Toronto",
    ...change,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(posted)) {
    if (value !== null) data.set(key, value);
  }
  return data;
}

describe("startCheckoutFields (02 §5.7)", () => {
  it("reads the demo form as the schema takes it", () => {
    const fields = startCheckoutFields(form());
    expect(fields).toMatchObject({
      territoryCode: null,
      intendedUse: undefined,
      acceptTerms: true,
      expectedTotalCents: 173250,
      timeZone: "America/Toronto",
    });
    expect(StartCheckoutSchema.safeParse(fields).success).toBe(true);
  });

  it("reads an unticked box as false, a total that isn't digits as no number, and a missing zone as none", () => {
    expect(
      startCheckoutFields(
        form({ acceptTerms: null, expectedTotalCents: "", timeZone: null }),
      ),
    ).toMatchObject({
      acceptTerms: false,
      expectedTotalCents: Number.NaN,
      timeZone: undefined,
    });
    expect(
      startCheckoutFields(form({ expectedTotalCents: "1e5" }))
        .expectedTotalCents,
    ).toBeNaN();
    expect(
      startCheckoutFields(form({ timeZone: "x".repeat(65) })).timeZone,
    ).toBeUndefined();
  });
});

describe("startCheckoutFieldErrors", () => {
  it("names each field the buyer can fix, in the page's order, in the schema's words", () => {
    const parsed = StartCheckoutSchema.safeParse(
      startCheckoutFields(
        form({ licenseeName: " ", buyerEmail: "sam@", acceptTerms: null }),
      ),
    );
    if (parsed.success) throw new Error("parsed");
    expect(startCheckoutFieldErrors(parsed.error)).toEqual({
      ok: false,
      error: {
        code: "invalid",
        message: DETAILS_COPY.licenseeEmpty,
        fields: {
          licenseeName: [DETAILS_COPY.licenseeEmpty],
          buyerEmail: [DETAILS_COPY.email],
          acceptTerms: [DETAILS_COPY.terms],
        },
      },
    });
  });

  it("asks for the country when One country posts none", () => {
    const parsed = StartCheckoutSchema.safeParse(
      startCheckoutFields(form({ territoryKey: "country" })),
    );
    if (parsed.success) throw new Error("parsed");
    expect(startCheckoutFieldErrors(parsed.error).error.fields).toEqual({
      territoryCode: [DETAILS_COPY.chooseCountry],
    });
  });

  it("gives only the generic error for a hidden field the buyer can't fix", () => {
    const parsed = StartCheckoutSchema.safeParse(
      startCheckoutFields(form({ submissionId: "nope" })),
    );
    if (parsed.success) throw new Error("parsed");
    expect(startCheckoutFieldErrors(parsed.error)).toEqual({
      ok: false,
      error: { code: "invalid", message: GENERIC_ERROR_MESSAGE },
    });
  });
});

describe("startCheckoutRefusal", () => {
  it("passes on the server's total, a fresh submission after a failed Checkout, and the reason otherwise", () => {
    expect(
      startCheckoutRefusal({
        ok: false,
        reason: "price_changed",
        totalCents: 189000,
      }),
    ).toMatchObject({ error: { code: "price_changed" }, totalCents: 189000 });
    const failed = startCheckoutRefusal({
      ok: false,
      reason: "checkout_failed",
    });
    expect(failed.submissionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      startCheckoutRefusal({ ok: false, reason: "already_submitted" }),
    ).toEqual({
      ok: false,
      error: { code: "already_submitted", message: GENERIC_ERROR_MESSAGE },
    });
  });
});
