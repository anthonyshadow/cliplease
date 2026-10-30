import "server-only";
import { randomInt } from "node:crypto";
import { LICENSE_CODE_PATTERN } from "@/lib/licensing/snapshot";

// License codes (07 D101; research/license.md §6.1 with the CL prefix): CL-XXXX-XXXX, 8 Crockford base32 symbols from a
// CSPRNG, never derived from ids or time. The unique index on license.code catches the rare collision (issueLicense
// retries).

/** Crockford base32: no I, L, O or U. */
export const LICENSE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const formatted = (symbols: string) =>
  `CL-${symbols.slice(0, 4)}-${symbols.slice(4)}`;

/** A fresh code: 'CL-' + 4 + '-' + 4 symbols, each crypto.randomInt(32). */
export function generateLicenseCode(): string {
  let symbols = "";
  for (let i = 0; i < 8; i += 1) {
    symbols += LICENSE_CODE_ALPHABET[randomInt(LICENSE_CODE_ALPHABET.length)];
  }
  return formatted(symbols);
}

/**
 * The canonical code for what someone typed, or null (07 D101): trimmed, uppercased, without spaces and hyphens; a
 * leading CL is the prefix only when 10 characters remain (so a bare code typed "CL…" for "C1…" keeps it); then O → 0 and
 * I, L → 1; exactly 8 alphabet symbols.
 */
export function normalizeLicenseCode(input: string): string | null {
  let s = input.trim().toUpperCase().replace(/[\s-]/g, "");
  if (s.length === 10 && s.startsWith("CL")) s = s.slice(2);
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  const code = formatted(s);
  return LICENSE_CODE_PATTERN.test(code) ? code : null;
}
