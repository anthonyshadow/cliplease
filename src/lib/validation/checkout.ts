// The license page's request (02 §5.7; P15): the one declaration of StartCheckoutSchema. P16a's startCheckout parses
// with it on the server; the page's form reads the same rules (src/lib/licensing/details.ts). Lives here, not in the
// server's requests.ts, so the client can share the field rules. The names a buyer types are tidied like every other
// public name (owner answer Q-108 a; 02's plain trim otherwise). The territory rule mirrors the DB CHECK
// license_request_territory_code, more strictly: a listed country's code, a region key, or null for Worldwide.
import { z } from "zod";
import {
  isOneOf,
  REGION_KEYS,
  TERM_KEYS,
  TERRITORY_KEYS,
  USE_KEYS,
} from "../domain/values";
import { LICENSE_V1_VERSION } from "../legal/license-v1-summary";
import { countryOf } from "../licensing/countries";
import {
  DETAILS_COPY,
  INTENDED_USE_MAX,
  NAME_MAX,
  WEB_ADDRESS_RE,
} from "../licensing/details";
import { GENERIC_ERROR_MESSAGE } from "../result";
import { tidyText } from "../text/tidy";
import { EMAIL_MAX, EMAIL_RE } from "./email";

/** A name others read (the license, /verify, the creator's emails): tidied, then 1 to 120 characters. */
const name = (empty: string) =>
  z
    .string()
    .transform(tidyText)
    .pipe(
      z
        .string()
        .min(1, { error: empty })
        .max(NAME_MAX, { error: DETAILS_COPY.nameLong }),
    );

const fields = z.object({
  videoId: z.uuid(),
  useKey: z.enum(USE_KEYS),
  termKey: z.enum(TERM_KEYS),
  territoryKey: z.enum(TERRITORY_KEYS),
  territoryCode: z.string().max(40).nullable(),
  licenseeName: name(DETAILS_COPY.licenseeEmpty).refine(
    (licensee) => !WEB_ADDRESS_RE.test(licensee),
    { error: DETAILS_COPY.licenseeWebAddress },
  ),
  contactName: name(DETAILS_COPY.nameEmpty),
  // Trimmed first, as the page's blur check does: the stored form is normalizeEmail's.
  buyerEmail: z
    .string()
    .trim()
    .pipe(
      z
        .email({ pattern: EMAIL_RE, error: DETAILS_COPY.email })
        .max(EMAIL_MAX, { error: DETAILS_COPY.email }),
    ),
  intendedUse: z
    .string()
    .transform(tidyText)
    .pipe(
      z.string().max(INTENDED_USE_MAX, { error: DETAILS_COPY.intendedUseLong }),
    )
    .optional(),
  acceptTerms: z.literal(true, { error: DETAILS_COPY.terms }),
  termsVersion: z.literal(LICENSE_V1_VERSION),
  submissionId: z.uuid(),
  expectedTotalCents: z.number().int().nonnegative(),
  /** The buyer's IANA zone, normalized server-side (07 D84). */
  timeZone: z.string().max(64).optional(),
});

/** Whether `code` fits `territoryKey`: a listed country, a region key, or nothing for Worldwide. */
function territoryCodeFits(
  territoryKey: (typeof TERRITORY_KEYS)[number],
  code: string | null,
): boolean {
  if (territoryKey === "worldwide") return code === null;
  if (code === null) return false;
  return territoryKey === "country"
    ? countryOf(code) !== undefined
    : isOneOf(REGION_KEYS, code);
}

export const StartCheckoutSchema = fields.superRefine((input, ctx) => {
  if (territoryCodeFits(input.territoryKey, input.territoryCode)) return;
  ctx.addIssue({
    code: "custom",
    path: ["territoryCode"],
    message:
      input.territoryKey === "country"
        ? DETAILS_COPY.chooseCountry
        : input.territoryKey === "region"
          ? DETAILS_COPY.chooseRegion
          : GENERIC_ERROR_MESSAGE,
  });
});

export type StartCheckoutInput = z.infer<typeof StartCheckoutSchema>;
