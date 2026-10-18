// Sign-in helpers for [int] tests: they call Better Auth's server API directly (no limiter, no origin check) and read the
// code back from the console driver's files.
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { user } from "../../src/db/schema";
import { auth } from "../../src/server/auth/auth";
import { randomHex } from "./factories";
import { readSignInCode } from "./read-latest-email";

export { mockNextHeaders } from "./next-headers";

export const SESSION_COOKIE_NAME = "better-auth.session_token";

/** A fresh creator address for one test. */
export const newCreatorEmail = () => `creator-${randomHex(6)}@example.com`;

/** The `user` row for `email`, or undefined. */
export async function userByEmail(email: string) {
  const [row] = await db.select().from(user).where(eq(user.email, email));
  return row;
}

/** Sends a sign-in code to `email` and returns it. */
export async function requestCode(email: string): Promise<string> {
  const since = Date.now();
  await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  return readSignInCode(email, since);
}

/** One code check, as the browser makes it: the Response, never a throw. */
export function tryCode(email: string, otp: string): Promise<Response> {
  return auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true });
}

/**
 * Every cookie a sign-in response sets, as the Cookie header a browser would send next ("better-auth.session_token=…",
 * plus any other cookie Better Auth adds, such as a cookie cache), so tests see what a browser sees.
 */
export function sessionCookiesOf(response: Response): string {
  const pairs = response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0]);
  if (!pairs.some((pair) => pair.startsWith(`${SESSION_COOKIE_NAME}=`))) {
    throw new Error("sign-in set no session cookie");
  }
  return pairs.join("; ");
}

/** Signs `email` in (creating the user on first use) and returns the Cookie header value a browser would send. */
export async function signInWithOtp(email: string): Promise<string> {
  const response = await tryCode(email, await requestCode(email));
  if (!response.ok) {
    throw new Error(`sign-in failed with ${response.status}`);
  }
  return sessionCookiesOf(response);
}
