import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { FORM_FIELDS } from "@/lib/licensing/details";
import {
  type ActionError,
  fieldErrors,
  formError,
  formText,
  GENERIC_ERROR_MESSAGE,
} from "@/lib/result";
import type { CreateLicenseRequestResult } from "./requests";

// The license page's form ↔ startCheckout (02 §5.7, §6.1): what the posted fields mean, and what the page hears back.

/** The posted license form as StartCheckoutSchema reads it: a number for the total, a boolean for the box. */
export function startCheckoutFields(formData: FormData) {
  const text = (key: string) => formText(formData, key);
  const total = text("expectedTotalCents");
  const intendedUse = text("intendedUse");
  const timeZone = text("timeZone");
  return {
    videoId: text("videoId"),
    useKey: text("useKey"),
    termKey: text("termKey"),
    territoryKey: text("territoryKey"),
    // The page posts "" until a country or region is chosen, and for Worldwide.
    territoryCode: text("territoryCode") || null,
    licenseeName: text("licenseeName"),
    contactName: text("contactName"),
    buyerEmail: text("buyerEmail"),
    intendedUse: intendedUse === "" ? undefined : intendedUse,
    acceptTerms: formData.get("acceptTerms") === "on",
    termsVersion: text("termsVersion"),
    submissionId: text("submissionId"),
    expectedTotalCents: /^\d{1,9}$/.test(total) ? Number(total) : Number.NaN,
    // No zone (no JS), or one too long to be a zone: UTC (07 D84).
    timeZone: timeZone === "" || timeZone.length > 64 ? undefined : timeZone,
  };
}

/** A refusal startCheckout returns: its code is the reason, with the server's total or a fresh submission when needed. */
export type StartCheckoutRefusal = ActionError & {
  /** price_changed: the server's total, in the page's currency. */
  totalCents?: number;
  /** checkout_failed: a new submissionId, so a retry makes a new request. */
  submissionId?: string;
};

/**
 * A form that doesn't parse: each page field's first message, in the page's order (the schema's own words, owner answer
 * Q-109 a); any other problem is the generic error.
 */
export function startCheckoutFieldErrors(error: z.ZodError): ActionError {
  const fields = FORM_FIELDS.flatMap((field) => {
    const issue = error.issues.find((i) => i.path[0] === field);
    return issue ? [[field, issue.message] as const] : [];
  });
  return fields.length > 0
    ? fieldErrors("invalid", fields)
    : formError("invalid");
}

/** createLicenseRequest's refusal as the page reads it. */
export function startCheckoutRefusal(
  result: Extract<CreateLicenseRequestResult, { ok: false }>,
): StartCheckoutRefusal {
  const error = { code: result.reason, message: GENERIC_ERROR_MESSAGE };
  if (result.reason === "price_changed") {
    return { ok: false, error, totalCents: result.totalCents };
  }
  if (result.reason === "checkout_failed") {
    return { ok: false, error, submissionId: randomUUID() };
  }
  return { ok: false, error };
}
