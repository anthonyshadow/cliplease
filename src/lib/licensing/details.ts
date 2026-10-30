// The license page's details form (01 J7.5; 04 §11.2): its limits and messages (proposed copy, owner answer Q-109 a), and
// the field checks it runs on blur, with no Zod: the buyer's page never loads the validation library for them. The
// schema the server enforces (StartCheckoutSchema, src/lib/validation/checkout.ts) reads the same limits and words.
import { tidyText } from "../text/tidy";
import { EMAIL_MAX, EMAIL_MESSAGE, EMAIL_RE } from "../validation/email";

export const NAME_MAX = 120;
export const INTENDED_USE_MAX = 200;

/**
 * A web address in a licensee name: a scheme, "www." or a domain followed by a path ("evil.example/claim"). The name
 * reaches the creator's email subject and headline, /verify and the license PDF, so it can't carry one (owner answer
 * Q-136 a); a bare domain such as "Booking.com" is a company's name and stays.
 */
export const WEB_ADDRESS_RE = /:\/\/|www\.|[a-z0-9-]\.[a-z]{2,}\//i;

export const DETAILS_COPY = {
  licenseeEmpty: "Enter who the license is for.",
  /** Owner answer Q-136 a. */
  licenseeWebAddress: "Enter a name without a web address.",
  nameEmpty: "Enter your name.",
  nameLong: `Use ${NAME_MAX} characters or fewer.`,
  email: EMAIL_MESSAGE,
  intendedUseLong: `Use ${INTENDED_USE_MAX} characters or fewer.`,
  terms: "Agree to the license and Terms to continue.",
  chooseCountry: "Choose a country.",
  chooseRegion: "Choose a region.",
} as const;

/** "Your details": the four fields the buyer types, in the page's order. */
export const DETAILS_FIELDS = [
  "licenseeName",
  "contactName",
  "buyerEmail",
  "intendedUse",
] as const;
export type DetailsField = (typeof DETAILS_FIELDS)[number];

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
  if (text.length > NAME_MAX) return DETAILS_COPY.nameLong;
  return field === "licenseeName" && WEB_ADDRESS_RE.test(text)
    ? DETAILS_COPY.licenseeWebAddress
    : null;
}

/** Everything on the page that can carry an error, in the page's order: the territory's select, the four fields, the terms box. */
export const FORM_FIELDS = [
  "territoryCode",
  ...DETAILS_FIELDS,
  "acceptTerms",
] as const;
export type FormField = (typeof FORM_FIELDS)[number];

export type FormErrors = Partial<Record<FormField, string>>;

/**
 * The press-time check (05 §4.1 "Submit"): every field, typed in or not, and the terms box, with the blur check's rules.
 * Empty when the form can go to the server.
 */
export function detailsErrors(
  values: Record<DetailsField, string> & { acceptTerms: boolean },
): FormErrors {
  const errors: FormErrors = {};
  for (const field of DETAILS_FIELDS) {
    const error = detailsFieldError(field, values[field]);
    if (error) errors[field] = error;
  }
  if (!values.acceptTerms) errors.acceptTerms = DETAILS_COPY.terms;
  return errors;
}
