// Email addresses (07 D126), pure and client-safe: the one check every form runs, with no Zod (the sign-in and license
// pages don't load the validation library for it), and the stored form. license_request.buyer_email holds that form,
// and from P20b My licenses matches a signed-in buyer's licenses by it.

/** The longest address a form takes. */
export const EMAIL_MAX = 254;

/** Every email field's message (01 J1, J7.5). */
export const EMAIL_MESSAGE = "Enter an email address like name@example.com.";

/**
 * Zod 4's default `z.email()` pattern (zod/v4/core regexes `email`), copied so a page checks exactly what the server
 * does without loading Zod; StartCheckoutSchema passes it to `z.email({ pattern })`, so the two can't drift.
 */
export const EMAIL_RE =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/** The stored form, trimmed and lowercased, dots and "+tags" kept: " Ana+ads@Studio.COM " → "ana+ads@studio.com". */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
