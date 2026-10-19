// Pure sign-in helpers (P04): client-safe, no process.env. Copy from 04 §11.10 and 05 §5.1.
import { GENERIC_ERROR_MESSAGE } from "./result";
import { DAY_MS } from "./time";

const DEFAULT_NEXT = "/dashboard";

/**
 * `next` when it is a same-site relative path, else /dashboard. The raw string is returned, never a normalized one
 * (normalizing turns `/..//evil.com` into `//evil.com`): printable ASCII only, a single leading slash, no backslash
 * anywhere, no dot segments, and never back to /sign-in.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== "string" || next === "") return DEFAULT_NEXT;
  if (!/^[\x21-\x7E]+$/.test(next)) return DEFAULT_NEXT;
  if (!next.startsWith("/") || next.startsWith("//")) return DEFAULT_NEXT;
  if (next.includes("\\")) return DEFAULT_NEXT;
  // No "." or ".." path segments (also percent-encoded): anything that normalizes them could produce "//host".
  const path = next.split(/[?#]/, 1)[0];
  if (/(^|\/)(\.|%2e){1,2}(\/|$)/i.test(path)) return DEFAULT_NEXT;
  if (/^\/sign-in(?:[/?#]|$)/i.test(next)) return DEFAULT_NEXT;
  return next;
}

/** `/sign-in?next=<encoded>`, the same bytes the proxy builds with URLSearchParams. */
export function signInPath(next: string): string {
  return `/sign-in?${new URLSearchParams({ next })}`;
}

/** First letter + "…" + "@domain": maya@example.com → m…@example.com (01 J1.1). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  return `${Array.from(email)[0]}…${email.slice(at)}`;
}

/** The 6 digits of a typed, pasted or autofilled code ("482 913" included), or null. */
export function normalizeOtpInput(raw: string): string | null {
  const digits = raw.replace(/\s/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** "Send a new code" appears this long after a code is sent (01 J1.1). */
export const OTP_RESEND_DELAY_MS = 30_000;

/** A sign-in code lives 10 minutes (07 D47), in seconds as Better Auth takes it; the email states it in minutes. */
export const OTP_EXPIRES_IN_S = 600;

/**
 * A sign-in lasts 7 days and is extended at most once a day while it's used (owner answer, P04: Better Auth's
 * defaults), in seconds as Better Auth takes them.
 */
export const SESSION_EXPIRES_IN_S = (7 * DAY_MS) / 1000;
export const SESSION_UPDATE_AGE_S = DAY_MS / 1000;

/**
 * Better Auth customRules (02 §9.1, 07 D54): 3 code emails and 10 code checks per 60 s per IP, relaxed (not disabled,
 * so the limiter still runs) to 1000 when APP_ENV=test.
 */
export function signInRateLimits(appEnv: string) {
  const relaxed = appEnv === "test";
  return {
    "/email-otp/send-verification-otp": { window: 60, max: relaxed ? 1000 : 3 },
    "/sign-in/email-otp": { window: 60, max: relaxed ? 1000 : 10 },
  };
}

export const SIGN_IN_COPY = {
  badCode: "That code didn't work. Check it or send a new one.",
  tooManyTries: "Too many tries. Wait a minute and try again.",
  invalidEmail: "Enter an email address like name@example.com.",
  offline: "You're offline. Check your connection and try again.",
  generic: GENERIC_ERROR_MESSAGE,
} as const;

export type SignInErrorKey = keyof typeof SIGN_IN_COPY;

/**
 * Failures that say nothing about what was typed: an error Banner above the form (05 §1.4), never the field's error
 * (which would mark a valid email or code invalid).
 */
export const FORM_LEVEL_ERRORS: ReadonlySet<SignInErrorKey> = new Set([
  "offline",
  "generic",
]);

/**
 * The copy for a failed Better Auth call (codes and statuses checked in better-auth 1.7.7): wrong, expired or used
 * code → 400 INVALID_OTP / OTP_EXPIRED; the 4th try after 3 wrong ones → 403 TOO_MANY_ATTEMPTS; a bad email → 400
 * INVALID_EMAIL; the limiter → 429 with no code. Codes are matched before statuses, because 403 is also an origin error.
 * A network failure never gets here: the client call rejects instead.
 */
export function signInErrorKey(
  error: { status?: number; code?: string },
  step: "email" | "code",
): SignInErrorKey {
  if (
    error.code === "INVALID_OTP" ||
    error.code === "OTP_EXPIRED" ||
    error.code === "TOO_MANY_ATTEMPTS"
  ) {
    return "badCode";
  }
  if (error.code === "INVALID_EMAIL") return "invalidEmail";
  if (error.status === 429) return "tooManyTries";
  if (step === "email" && error.code === "VALIDATION_ERROR") {
    return "invalidEmail";
  }
  return "generic";
}

/**
 * Whether a change to the code field submits by itself (05 §5.1): six digits that arrive in one change (a paste, a
 * drop, autofill or a keyboard's code suggestion) submit once; typing or deleting keeps the Sign in button in control.
 * `inputType` and `data` come from the InputEvent; autofill can fire a plain Event, which has no inputType.
 */
export function shouldAutoSubmit({
  value,
  inputType,
  data,
  lastTried,
}: {
  value: string;
  inputType?: string;
  data?: string | null;
  lastTried: string | null;
}): boolean {
  const otp = normalizeOtpInput(value);
  if (otp === null || otp === lastTried) return false;
  return (
    !inputType ||
    inputType === "insertReplacementText" ||
    inputType.startsWith("insertFrom") ||
    (inputType === "insertText" && (data?.length ?? 0) > 1)
  );
}
