import "server-only";
import { z } from "zod";
import { SOCIAL_PROVIDERS } from "../../lib/domain/values";
import { bytesEqual } from "../crypto/hmac";
import {
  createTokenCipher,
  deriveSubkey,
  type TokenCipher,
} from "../crypto/token-cipher";
import { env } from "../env";

// The OAuth round trip's sealed cookie and returnTo rule (02 §5.3, §7.2, §9.3; 07 D37).

export const OAUTH_COOKIE = "cliplease_oauth";
/** Where the cookie lives; setting and deleting it both need this path. */
export const OAUTH_COOKIE_PATH = "/api/connect";
export const OAUTH_STATE_MAX_AGE_S = 600;
const AAD = "oauth-state";

const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;

const payloadSchema = z.strictObject({
  provider: z.enum(SOCIAL_PROVIDERS),
  state: z.string().regex(B64URL_32),
  codeVerifier: z.string().regex(B64URL_32).nullable(),
  userId: z.string().min(1),
  /** A path and query on our origin, already through parseReturnTo. */
  returnTo: z
    .string()
    .refine((path) => path.startsWith("/") && !path.startsWith("//")),
  /** required + any optional scopes asked for (07 D83). */
  requestedScopes: z.array(z.string().min(1)),
  createdAt: z.number().int().nonnegative(),
});

export type OAuthStatePayload = z.infer<typeof payloadSchema>;

// Sealed with its own HKDF subkey of TOKEN_ENCRYPTION_KEY, never the key itself (07 D37).
let stateCipher: TokenCipher | undefined;
const cipher = () => {
  stateCipher ??= createTokenCipher(
    deriveSubkey("oauth-state").toString("base64"),
  );
  return stateCipher;
};

export function sealOAuthState(p: OAuthStatePayload): string {
  return cipher().encrypt(JSON.stringify(p), AAD);
}

/** The payload, or null when the cookie is missing, tampered, malformed, from the future or older than 600 s. */
export function openOAuthState(
  sealed: string | undefined,
): OAuthStatePayload | null {
  if (!sealed) return null;
  let json: unknown;
  try {
    json = JSON.parse(cipher().decrypt(sealed, AAD));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return null;
  const age = Date.now() - parsed.data.createdAt;
  if (age < 0 || age > OAUTH_STATE_MAX_AGE_S * 1000) return null;
  return parsed.data;
}

/** Constant-time state check; a different length is a mismatch, not an error. */
export function stateMatches(
  received: string | null | undefined,
  expected: string,
): boolean {
  if (!received) return false;
  return bytesEqual(Buffer.from(received), Buffer.from(expected));
}

/** The cookie's attributes; Secure only when the app is served over https. */
export function oauthCookieOptions(appUrl: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_STATE_MAX_AGE_S,
    secure: appUrl.startsWith("https:"),
  };
}

const RETURN_PATH = /^\/(dashboard|onboarding)(\/[a-z0-9/-]*)?$/;
const RETURN_PARAMS = new Set(["step", "post", "platform", "account"]);

/**
 * A return target that passes 07 D37: a same-origin /dashboard or /onboarding path with only the step, post, platform and
 * account params; anything else is null. Dot segments are refused before parsing, because the URL parser would quietly
 * resolve them.
 */
export function returnToUrl(raw: string | null): URL | null {
  if (!raw || raw.length > 512 || /\.\.|%2e|\\/i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, env.APP_URL);
  } catch {
    return null;
  }
  if (url.origin !== new URL(env.APP_URL).origin) return null;
  if (url.username || url.password || url.hash) return null;
  if (!RETURN_PATH.test(url.pathname)) return null;
  for (const key of url.searchParams.keys()) {
    if (!RETURN_PARAMS.has(key)) return null;
  }
  return url;
}

/** Where a connect lands (07 D37): returnToUrl's target, else /dashboard/library. */
export function parseReturnTo(raw: string | null): URL {
  return returnToUrl(raw) ?? new URL("/dashboard/library", env.APP_URL);
}
