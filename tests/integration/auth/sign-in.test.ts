import { createHash } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../../src/db/client";
import {
  emailLog,
  rateLimit,
  session,
  verification,
} from "../../../src/db/schema";
import { MINUTE_MS } from "../../../src/lib/time";
import { auth } from "../../../src/server/auth/auth";
import {
  newCreatorEmail,
  requestCode,
  SESSION_COOKIE_NAME,
  sessionCookiesOf,
  signInWithOtp,
  tryCode,
  userByEmail,
} from "../../helpers/auth";
import { resetDb } from "../../helpers/db";
import { readLatestEmail, wrongCode } from "../../helpers/read-latest-email";

// Better Auth 1.7.7 email OTP (02 §9.1, 07 D47, D88). auth.api.* skips the limiter and the origin check; the limiter
// case goes through auth.handler. The listed admins must never stay behind as creators, so the file empties the database.
afterAll(resetDb);

const otpIdentifier = (email: string) => `sign-in-otp-${email}`;

async function failure(response: Response) {
  const body = (await response.json()) as { code?: string };
  return { status: response.status, code: body.code };
}

describe("sign-in with an email code", () => {
  it("creates a creator with a session, stores only the code's hash, and writes no email_log row", async () => {
    const email = newCreatorEmail();
    const since = Date.now();
    const code = await requestCode(email);

    const sent = await readLatestEmail({
      to: email,
      template: "sign-in-code",
      since,
    });
    expect(sent.to).toBe(email);
    expect(sent.subject).not.toMatch(/\d/);
    const [stored] = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, otpIdentifier(email)));
    const hash = createHash("sha256").update(code).digest("base64url");
    expect(stored.value).toBe(`${hash}:0`);
    expect(stored.value).not.toContain(code);

    const response = await tryCode(email, code);
    expect(response.status).toBe(200);
    const created = await userByEmail(email);
    expect(created).toMatchObject({
      role: "creator",
      emailVerified: true,
      name: "",
    });
    const sessions = await db
      .select()
      .from(session)
      .where(eq(session.userId, created.id));
    expect(sessions).toHaveLength(1);
    // No cookie cache (02 §5.1): only the session token is set, so a role change applies on the next request.
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.map((line) => line.split("=")[0])).toEqual([
      SESSION_COOKIE_NAME,
    ]);
    expect(setCookies[0]).toMatch(/Max-Age=604800/);
    const current = await auth.api.getSession({
      headers: new Headers({ cookie: sessionCookiesOf(response) }),
    });
    expect(current?.user.id).toBe(created.id);
    const left = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, otpIdentifier(email)));
    expect(left).toHaveLength(0);
    const [{ value: logged }] = await db
      .select({ value: count() })
      .from(emailLog);
    expect(logged).toBe(0);
  });

  it("kills the code after 3 wrong tries (J1.3)", async () => {
    const email = newCreatorEmail();
    const code = await requestCode(email);
    for (let i = 0; i < 3; i++) {
      expect(await failure(await tryCode(email, wrongCode(code)))).toEqual({
        status: 400,
        code: "INVALID_OTP",
      });
    }
    expect(await failure(await tryCode(email, code))).toEqual({
      status: 403,
      code: "TOO_MANY_ATTEMPTS",
    });
    expect(await userByEmail(email)).toBeUndefined();
  });

  it("refuses an expired code", async () => {
    const email = newCreatorEmail();
    const code = await requestCode(email);
    await db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - MINUTE_MS) })
      .where(eq(verification.identifier, otpIdentifier(email)));
    expect(await failure(await tryCode(email, code))).toEqual({
      status: 400,
      code: "OTP_EXPIRED",
    });
  });

  it("refuses a code that was already used", async () => {
    const email = newCreatorEmail();
    const code = await requestCode(email);
    expect((await tryCode(email, code)).status).toBe(200);
    expect(await failure(await tryCode(email, code))).toEqual({
      status: 400,
      code: "INVALID_OTP",
    });
  });

  it("ignores a role sent in the body", async () => {
    const email = newCreatorEmail();
    const code = await requestCode(email);
    const response = await auth.api.signInEmailOTP({
      body: { email, otp: code, role: "admin" },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    expect((await userByEmail(email)).role).toBe("creator");
  });
});

describe("admin bootstrap (07 D88)", () => {
  it("makes both ADMIN_EMAILS addresses admins on first sign-in, whatever the case typed", async () => {
    await signInWithOtp("E2E-Admin@Example.com");
    await signInWithOtp("e2e-admin-2@example.com");
    expect((await userByEmail("e2e-admin@example.com")).role).toBe("admin");
    expect((await userByEmail("e2e-admin-2@example.com")).role).toBe("admin");
  });

  it("keeps any other address a creator", async () => {
    const email = newCreatorEmail();
    await signInWithOtp(email);
    expect((await userByEmail(email)).role).toBe("creator");
  });
});

describe("rate limit (02 §9.1, 07 D54)", () => {
  it("counts code emails per IP in the rate_limit table, even with the relaxed test limits", async () => {
    const response = await auth.handler(
      new Request(
        new URL(
          "/api/auth/email-otp/send-verification-otp",
          auth.options.baseURL,
        ),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.7",
          },
          body: JSON.stringify({ email: newCreatorEmail(), type: "sign-in" }),
        },
      ),
    );
    expect(response.status).toBe(200);
    const [row] = await db
      .select()
      .from(rateLimit)
      .where(eq(rateLimit.key, "203.0.113.7|/email-otp/send-verification-otp"));
    expect(row.count).toBe(1);
  });
});
