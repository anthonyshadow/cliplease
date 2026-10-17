// The Better Auth config (research/stack.md "Config specification", 07 D06). The `auth` CLI loads this file outside
// Next, so it uses relative imports only and no server guard import (ADR-34). P04 adds the sign-in email and the routes.
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { db } from "../../db/client";
import * as schema from "../../db/schema";
import { APP_NAME } from "../../lib/app-name";
import { USER_ROLES } from "../../lib/domain/values";
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
  // Database storage makes the generator emit the rate_limit table.
  rateLimit: { storage: "database" },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      allowedAttempts: 3,
      storeOTP: "hashed",
      sendVerificationOTP: async () => {
        throw new Error("Sign-in email arrives in P04");
      },
    }),
    nextCookies(), // must stay last
  ],
});
