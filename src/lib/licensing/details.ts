// The license page's details form (01 J7.5; 04 §11.2): its limits and messages (proposed copy, owner answer Q-109 a), and
// the field checks it runs on blur, with no Zod: the buyer's page never loads the validation library for them. The
// schema the server enforces (StartCheckoutSchema, src/lib/validation/checkout.ts) reads the same limits and words.
import { tidyText } from "../text/tidy";

export const NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const INTENDED_USE_MAX = 200;

export const DETAILS_COPY = {
  licenseeEmpty: "Enter who the license is for.",
  nameEmpty: "Enter your name.",
  nameLong: `Use ${NAME_MAX} characters or fewer.`,
  email: "Enter an email address like name@example.com.",
  intendedUseLong: `Use ${INTENDED_USE_MAX} characters or fewer.`,
  terms: "Agree to the license and Terms to continue.",
  chooseCountry: "Choose a country.",
  chooseRegion: "Choose a region.",
} as const;

export type DetailsField =
  | "licenseeName"
  | "contactName"
  | "buyerEmail"
  | "intendedUse";

/**
 * Zod 4's default `z.email()` pattern (zod/v4/core regexes `email`), copied so the page checks exactly what the server
 * does without loading Zod; StartCheckoutSchema passes it to `z.email({ pattern })`, so the two can't drift.
 */
export const EMAIL_RE =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/** The field's message for `raw` as the buyer typed it, or null when it is fine (names and the use are tidied first). */
export function detailsFieldError(
  field: DetailsField,
  raw: string,
): string | null {
  if (field === "buyerEmail") {
    const email = raw.trim();
    return EMAIL_RE.test(email) && email.length <= EMAIL_MAX
      ? null
      : DETAILS_COPY.email;
  }
  const text = tidyText(raw);
  if (field === "intendedUse") {
    return text.length > INTENDED_USE_MAX ? DETAILS_COPY.intendedUseLong : null;
  }
  if (text === "") {
    return field === "licenseeName"
      ? DETAILS_COPY.licenseeEmpty
      : DETAILS_COPY.nameEmpty;
  }
  return text.length > NAME_MAX ? DETAILS_COPY.nameLong : null;
}
