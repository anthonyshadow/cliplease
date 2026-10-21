// Environment contract (02 §10, 07 D51, D52, D88, D94, D95, D102).
// Loaded by plain-Node CLIs (drizzle-kit, the Better Auth CLI), so it uses relative imports only and
// no server guard import (02 §3, ADR-34). Never import this file from a client component.
import { z } from "zod";
import { APP_NAME } from "../lib/app-name";
import {
  CURRENCIES,
  type Currency,
  SOCIAL_PROVIDERS,
} from "../lib/domain/values";

export const APP_ENVS = [
  "development",
  "test",
  "preview",
  "production",
] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const PAYMENTS_DRIVERS = ["fake", "stripe"] as const;
export type PaymentsDriverName = (typeof PAYMENTS_DRIVERS)[number];

export const STORAGE_DRIVERS = ["local", "r2"] as const;
export type StorageDriverName = (typeof STORAGE_DRIVERS)[number];

// 02 §7.9 (07 D36).
export const MOCK_SOCIAL_SCENARIOS = [
  "default",
  "empty",
  "expired",
  "rate_limited",
  "post_removed",
  "shared_account",
  "rotating_refresh",
  "pinned_old_post",
] as const;
export type MockSocialScenario = (typeof MOCK_SOCIAL_SCENARIOS)[number];

/** True only for `development` and `test` (07 D51). Never read NODE_ENV for this. */
export function isDevAppEnv(appEnv: AppEnv): boolean {
  return appEnv === "development" || appEnv === "test";
}

// An origin such as https://cliplease.com: no path, query, fragment or trailing slash (07 D102). http only when APP_ENV
// is development or test (the superRefine below).
// The refine also runs after a failed format check, so it must never throw on unparseable input:
// a TypeError from `new URL` would escape parseEnv with the raw value in it.
const origin = z
  .url({ protocol: /^https?$/, error: "must be an http(s) URL" })
  .refine((value) => URL.canParse(value) && new URL(value).origin === value, {
    error: "must be an origin with no path or trailing slash",
  });

const secret = z.string().min(32, { error: "must be at least 32 characters" });

const postgresUrl = z
  .url({
    protocol: /^postgres(ql)?$/,
    error: "must be a postgres:// or postgresql:// URL",
  })
  .regex(/^postgres(ql)?:\/\/[^/\s]/, {
    error: "must be a postgres:// or postgresql:// URL with a host",
  });

/** A comma list of allowed values: items trimmed; empty items and duplicates refused. */
function commaList<const T extends readonly [string, ...string[]]>(allowed: T) {
  return z.string().transform((raw, ctx) => {
    const items = raw.split(",").map((item) => item.trim());
    if (items.some((item) => item === "")) {
      ctx.addIssue({ code: "custom", message: "has an empty item" });
      return z.NEVER;
    }
    if (new Set(items).size !== items.length) {
      ctx.addIssue({ code: "custom", message: "has a duplicate item" });
      return z.NEVER;
    }
    if (items.some((item) => !(allowed as readonly string[]).includes(item))) {
      ctx.addIssue({
        code: "custom",
        message: `allows only ${allowed.join(", ")}`,
      });
      return z.NEVER;
    }
    return items as T[number][];
  });
}

// Trimmed, lowercased, de-duplicated, order kept: the owner comes first (07 D88).
const adminEmails = z.string().transform((raw, ctx) => {
  const items = raw.split(",").map((item) => item.trim().toLowerCase());
  if (items.some((item) => !z.email().safeParse(item).success)) {
    ctx.addIssue({
      code: "custom",
      message: "must be a comma list of email addresses",
    });
    return z.NEVER;
  }
  return [...new Set(items)];
});

const FEE_BPS_ERROR = "must be an integer from 0 to 5000";

const shape = {
  APP_ENV: z.enum(APP_ENVS),
  APP_URL: origin,
  BETTER_AUTH_URL: origin,
  DATABASE_URL: postgresUrl,
  DATABASE_URL_UNPOOLED: postgresUrl,
  BETTER_AUTH_SECRET: secret,
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, {
    error: "must be base64 of exactly 32 bytes",
  }),
  CRON_SECRET: secret,
  ADMIN_EMAILS: adminEmails.default([]),
  ENABLED_SOCIAL_PROVIDERS: commaList(SOCIAL_PROVIDERS),
  MOCK_SOCIAL_SCENARIO: z.enum(MOCK_SOCIAL_SCENARIOS).default("default"),
  PAYMENTS_DRIVER: z.enum(PAYMENTS_DRIVERS),
  ENABLED_CURRENCIES: commaList(CURRENCIES)
    .default(["cad"])
    .transform((list) => CURRENCIES.filter((c) => list.includes(c))),
  STRIPE_SECRET_KEY_CAD: z
    .string()
    .regex(/^(sk|rk)_test_/, {
      error: "must be a test key (sk_test_ or rk_test_)",
    })
    .optional(),
  STORAGE_DRIVER: z.enum(STORAGE_DRIVERS),
  // The regex admits digits only, so the number is always an integer.
  PLATFORM_FEE_BPS: z
    .string()
    .regex(/^\d+$/, { error: FEE_BPS_ERROR })
    .transform(Number)
    .pipe(z.number().max(5000, { error: FEE_BPS_ERROR }))
    .default(1000),
  EMAIL_FROM: z
    .string()
    .regex(/^[^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+>$|^[^<>\s@]+@[^<>\s@]+$/, {
      error: 'must be "Name <address>" or an address',
    })
    .default(`${APP_NAME} <onboarding@resend.dev>`),
  RESEND_API_KEY: z.string().optional(),
};

type EnvKey = keyof typeof shape;

/** Every key the schema reads. `.env.test` and `.env.example` list each one (blank when unused). */
export const ENV_KEYS = Object.keys(shape) as EnvKey[];

const schema = z.object(shape).superRefine((e, ctx) => {
  if (isDevAppEnv(e.APP_ENV)) return;
  const refuse = (key: EnvKey, what: string) =>
    ctx.addIssue({
      code: "custom",
      path: [key],
      message: `${what} is allowed only when APP_ENV is development or test`,
    });
  if (e.ENABLED_SOCIAL_PROVIDERS.includes("mock")) {
    refuse("ENABLED_SOCIAL_PROVIDERS", "mock");
  }
  if (e.PAYMENTS_DRIVER === "fake") refuse("PAYMENTS_DRIVER", "fake");
  if (e.STORAGE_DRIVER === "local") refuse("STORAGE_DRIVER", "local");
  if (e.RESEND_API_KEY === undefined) {
    refuse("RESEND_API_KEY", "the console email driver (unset)");
  }
  // An http origin would drop Secure from the session and OAuth state cookies (07 D102).
  for (const key of ["APP_URL", "BETTER_AUTH_URL"] as const) {
    if (e[key].startsWith("http:")) refuse(key, "http");
  }
});

export type Env = z.output<typeof schema>;

/** Pure. An empty string counts as unset. Throws an Error that names the failing keys, never their values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const picked: Partial<Record<EnvKey, string>> = {};
  for (const key of ENV_KEYS) {
    const value = source[key];
    if (value !== undefined && value.trim() !== "") picked[key] = value;
  }
  const result = schema.safeParse(picked);
  if (result.success) return result.data;
  // The schema is flat, so an issue's key is its whole path.
  const issues = result.error.issues.map((i) => ({
    key: String(i.path[0] ?? "env"),
    message: i.message,
  }));
  const keys = [...new Set(issues.map((i) => i.key))];
  const lines = issues.map((i) => `- ${i.key}: ${i.message}`);
  throw new Error(
    `Invalid environment (${keys.join(", ")}):\n${lines.join("\n")}`,
  );
}

export const env: Env = parseEnv(process.env);

/** The enabled currencies, in CURRENCIES order (07 D94, D95). */
export function enabledCurrencies(
  e: Pick<Env, "ENABLED_CURRENCIES"> = env,
): Currency[] {
  return [...e.ENABLED_CURRENCIES];
}

/** The first ADMIN_EMAILS entry (the owner, 07 D88), or null when unset. */
export function ownerEmail(e: Pick<Env, "ADMIN_EMAILS"> = env): string | null {
  return e.ADMIN_EMAILS[0] ?? null;
}
