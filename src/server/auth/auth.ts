// The Better Auth config (research/stack.md "Config specification", 02 §5.1, 07 D06). The `auth` CLI loads this file
// outside Next, so it uses relative imports only and no server guard import (ADR-34); the email sender, which has one,
// is imported lazily inside the hook, which the CLI never calls.
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import * as schema from "../../db/schema";
import { APP_NAME } from "../../lib/app-name";
import { USER_ROLES } from "../../lib/domain/values";
import { formatLogLine } from "../../lib/log-line";
import {
  OTP_EXPIRES_IN_S,
  SESSION_EXPIRES_IN_S,
  SESSION_UPDATE_AGE_S,
  signInRateLimits,
} from "../../lib/sign-in";
import { env } from "../env";

export const auth = betterAuth({
  appName: APP_NAME,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  user: {
    additionalFields: {
      role: {
        type: [...USER_ROLES],
        required: false,
        defaultValue: "creator",
        input: false,
      },
    },
  },
  // Better Auth's defaults, stated (owner answer, P04): 7 days, extended at most once a day while used (SessionRefresh).
  // No cookie cache, so a role change applies on the next request (02 §5.1).
  session: {
    expiresIn: SESSION_EXPIRES_IN_S,
    updateAge: SESSION_UPDATE_AGE_S,
  },
  // 3 code emails and 10 code checks per minute per IP; relaxed (still running) when APP_ENV=test (07 D54).
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: signInRateLimits(env.APP_ENV),
  },
  databaseHooks: {
    user: {
      create: {
        // Both ADMIN_EMAILS addresses become admins on their first sign-in (07 D88); env.ts lowercases the list. A
        // failure is not caught: the sign-in fails loudly, and `bun run db:seed` promotes users who already exist.
        after: async (created) => {
          if (!env.ADMIN_EMAILS.includes(created.email.toLowerCase())) return;
          await db
            .update(schema.user)
            .set({ role: "admin" })
            .where(eq(schema.user.id, created.id));
        },
      },
    },
  },
  // Better Auth's own warnings and errors, as redacted JSON lines like logEvent's (it can't import the guarded log.ts):
  // its query errors carry emails and session tokens in their parameters (02 §9.9, 07 D47). The message is sometimes
  // an Error; the redactor handles both.
  logger: {
    log(level, message, ...args) {
      const lineLevel = level === "error" || level === "warn" ? level : "info";
      (lineLevel === "info" ? process.stdout : process.stderr).write(
        formatLogLine(lineLevel, "auth.better_auth", {
          message,
          details: args.length > 0 ? args : undefined,
        }),
      );
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: OTP_EXPIRES_IN_S,
      allowedAttempts: 3,
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") return;
        const { sendSignInCode } = await import("../email/send");
        await sendSignInCode(email, otp);
      },
    }),
    nextCookies(), // must stay last
  ],
});
