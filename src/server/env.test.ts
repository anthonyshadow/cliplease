import { readFileSync } from "node:fs";
import { parseEnv as parseEnvFile } from "node:util";
import { describe, expect, it } from "vitest";
import {
  APP_ENVS,
  ENV_KEYS,
  enabledCurrencies,
  env,
  isDevAppEnv,
  MOCK_SOCIAL_SCENARIOS,
  ownerEmail,
  parseEnv,
} from "./env";

// Fake values for these tests only: never real secrets.
const SECRET = "test-secret-value-0123456789-abcdefghij";
const CRON = "cron-secret-value-0123456789-abcdefghij";
const KEY = Buffer.alloc(32, 7).toString("base64");

const baseline: Record<string, string | undefined> = {
  APP_ENV: "development",
  APP_URL: "http://localhost:3000",
  BETTER_AUTH_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/cliplease_dev",
  DATABASE_URL_UNPOOLED:
    "postgresql://postgres:postgres@localhost:5432/cliplease_dev",
  BETTER_AUTH_SECRET: SECRET,
  TOKEN_ENCRYPTION_KEY: KEY,
  CRON_SECRET: CRON,
  ENABLED_SOCIAL_PROVIDERS: "mock",
  PAYMENTS_DRIVER: "fake",
  STORAGE_DRIVER: "local",
};

// A non-dev environment that passes every guard (later prompts add the matching credential rules).
const deployed = {
  ...baseline,
  APP_URL: "https://cliplease.com",
  BETTER_AUTH_URL: "https://cliplease.com",
  ENABLED_SOCIAL_PROVIDERS: "youtube",
  PAYMENTS_DRIVER: "stripe",
  STORAGE_DRIVER: "r2",
  RESEND_API_KEY: "re_test_resend_key_value",
};

function failure(source: Record<string, string | undefined>): string {
  try {
    parseEnv(source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("accepts the baseline and applies the defaults", () => {
    const e = parseEnv(baseline);
    expect(e.APP_ENV).toBe("development");
    expect(e.MOCK_SOCIAL_SCENARIO).toBe("default");
    expect(e.PLATFORM_FEE_BPS).toBe(1000);
    expect(e.EMAIL_FROM).toBe("ClipLease <onboarding@resend.dev>");
    expect(e.ENABLED_CURRENCIES).toEqual(["cad"]);
    expect(e.ADMIN_EMAILS).toEqual([]);
    expect(e.RESEND_API_KEY).toBeUndefined();
    expect(e.STRIPE_SECRET_KEY_CAD).toBeUndefined();
  });

  it("accepts every APP_ENV with a deployable config", () => {
    for (const appEnv of APP_ENVS) {
      expect(parseEnv({ ...deployed, APP_ENV: appEnv }).APP_ENV).toBe(appEnv);
    }
  });

  it("treats an empty string as unset", () => {
    expect(failure({ ...baseline, APP_ENV: "" })).toContain("APP_ENV");
    expect(failure({ ...baseline, CRON_SECRET: "" })).toContain("CRON_SECRET");
    const e = parseEnv({
      ...baseline,
      PLATFORM_FEE_BPS: "",
      ENABLED_CURRENCIES: "",
      EMAIL_FROM: "",
      RESEND_API_KEY: "",
      ADMIN_EMAILS: "",
      STRIPE_SECRET_KEY_CAD: "",
    });
    expect(e.PLATFORM_FEE_BPS).toBe(1000);
    expect(e.ENABLED_CURRENCIES).toEqual(["cad"]);
    expect(e.EMAIL_FROM).toBe("ClipLease <onboarding@resend.dev>");
    expect(e.RESEND_API_KEY).toBeUndefined();
    expect(e.ADMIN_EMAILS).toEqual([]);
    expect(e.STRIPE_SECRET_KEY_CAD).toBeUndefined();
  });

  it.each([
    ["APP_ENV", undefined],
    ["APP_ENV", "staging"],
    ["APP_URL", undefined],
    ["APP_URL", "localhost:3000"],
    ["APP_URL", "http://localhost:3000/"],
    ["APP_URL", "http://localhost:3000/app"],
    ["APP_URL", "ftp://localhost:3000"],
    ["APP_URL", "not a url"],
    ["APP_URL", "https://clip lease.com"],
    ["BETTER_AUTH_URL", "http://localhost:3000/"],
    ["BETTER_AUTH_URL", "http://"],
    ["DATABASE_URL", undefined],
    ["DATABASE_URL", "mysql://u:p@localhost/db"],
    ["DATABASE_URL", "postgresql:foo"],
    ["DATABASE_URL_UNPOOLED", "http://localhost:5432/db"],
    ["DATABASE_URL_UNPOOLED", "postgres:///x"],
    ["BETTER_AUTH_SECRET", undefined],
    ["BETTER_AUTH_SECRET", "x".repeat(31)],
    ["CRON_SECRET", "y".repeat(31)],
    ["TOKEN_ENCRYPTION_KEY", undefined],
    ["TOKEN_ENCRYPTION_KEY", Buffer.alloc(31, 1).toString("base64")],
    ["TOKEN_ENCRYPTION_KEY", Buffer.alloc(33, 1).toString("base64")],
    ["TOKEN_ENCRYPTION_KEY", "not base64 at all, but long enough to pass"],
    ["ENABLED_SOCIAL_PROVIDERS", undefined],
    ["ENABLED_SOCIAL_PROVIDERS", "mock,facebook"],
    ["ENABLED_SOCIAL_PROVIDERS", "mock,mock"],
    ["ENABLED_SOCIAL_PROVIDERS", "mock,"],
    ["MOCK_SOCIAL_SCENARIO", "chaos"],
    ["PAYMENTS_DRIVER", undefined],
    ["PAYMENTS_DRIVER", "paypal"],
    ["STORAGE_DRIVER", undefined],
    ["STORAGE_DRIVER", "s3"],
    ["ENABLED_CURRENCIES", "cad,eur"],
    ["ENABLED_CURRENCIES", "cad,cad"],
    ["ENABLED_CURRENCIES", "CAD"],
    ["PLATFORM_FEE_BPS", "-1"],
    ["PLATFORM_FEE_BPS", "5001"],
    ["PLATFORM_FEE_BPS", "10.5"],
    ["PLATFORM_FEE_BPS", "1e3"],
    ["ADMIN_EMAILS", "owner@example.com,not-an-email"],
    ["ADMIN_EMAILS", "owner@example.com,"],
    ["EMAIL_FROM", "ClipLease onboarding@resend.dev"],
  ])("refuses %s=%s and names the key", (key, value) => {
    expect(failure({ ...baseline, [key]: value })).toContain(key);
  });

  it("accepts the PLATFORM_FEE_BPS bounds", () => {
    expect(
      parseEnv({ ...baseline, PLATFORM_FEE_BPS: "0" }).PLATFORM_FEE_BPS,
    ).toBe(0);
    expect(
      parseEnv({ ...baseline, PLATFORM_FEE_BPS: "5000" }).PLATFORM_FEE_BPS,
    ).toBe(5000);
  });

  it("lists the eight MOCK_SOCIAL_SCENARIOS of 02 §7.9", () => {
    expect(MOCK_SOCIAL_SCENARIOS).toEqual([
      "default",
      "empty",
      "expired",
      "rate_limited",
      "post_removed",
      "shared_account",
      "rotating_refresh",
      "pinned_old_post",
    ]);
  });
});

describe("STRIPE_SECRET_KEY_CAD (07 D51, D95)", () => {
  it.each(APP_ENVS)("accepts sk_test_ and rk_test_ in %s", (appEnv) => {
    for (const key of ["sk_test_abc123", "rk_test_abc123"]) {
      const e = parseEnv({
        ...deployed,
        APP_ENV: appEnv,
        STRIPE_SECRET_KEY_CAD: key,
      });
      expect(e.STRIPE_SECRET_KEY_CAD).toBe(key);
    }
  });

  it.each(APP_ENVS)("refuses a live key in %s without echoing it", (appEnv) => {
    for (const key of [
      "sk_live_SuperSecretLiveKey123",
      "rk_live_SuperSecretLiveKey123",
    ]) {
      const message = failure({
        ...deployed,
        APP_ENV: appEnv,
        STRIPE_SECRET_KEY_CAD: key,
      });
      expect(message).toContain("STRIPE_SECRET_KEY_CAD");
      expect(message).not.toContain("SuperSecretLiveKey123");
    }
  });
});

describe("dev-only driver guards (07 D51)", () => {
  it.each(["preview", "production"] as const)(
    "refuses each dev driver in %s",
    (appEnv) => {
      const base = { ...deployed, APP_ENV: appEnv };
      expect(
        failure({ ...base, ENABLED_SOCIAL_PROVIDERS: "youtube,mock" }),
      ).toContain("ENABLED_SOCIAL_PROVIDERS");
      expect(failure({ ...base, PAYMENTS_DRIVER: "fake" })).toContain(
        "PAYMENTS_DRIVER",
      );
      expect(failure({ ...base, STORAGE_DRIVER: "local" })).toContain(
        "STORAGE_DRIVER",
      );
      expect(failure({ ...base, RESEND_API_KEY: undefined })).toContain(
        "RESEND_API_KEY",
      );
      expect(failure({ ...base, RESEND_API_KEY: "" })).toContain(
        "RESEND_API_KEY",
      );
    },
  );

  it.each(["preview", "production"] as const)(
    "refuses an http APP_URL or BETTER_AUTH_URL in %s, naming the key without the value",
    (appEnv) => {
      for (const key of ["APP_URL", "BETTER_AUTH_URL"] as const) {
        const message = failure({
          ...deployed,
          APP_ENV: appEnv,
          [key]: "http://cliplease-typo.com",
        });
        expect(message).toContain(key);
        expect(message).not.toContain("cliplease-typo");
      }
    },
  );

  it.each(["development", "test"] as const)(
    "allows the dev drivers and http origins in %s",
    (appEnv) => {
      expect(() => parseEnv({ ...baseline, APP_ENV: appEnv })).not.toThrow();
    },
  );

  it("isDevAppEnv is true only for development and test", () => {
    expect(APP_ENVS.filter(isDevAppEnv)).toEqual(["development", "test"]);
  });
});

describe("enabledCurrencies (07 D94, D95)", () => {
  it("defaults to cad and keeps the CURRENCIES order", () => {
    expect(enabledCurrencies(parseEnv(baseline))).toEqual(["cad"]);
    expect(
      enabledCurrencies(parseEnv({ ...baseline, ENABLED_CURRENCIES: "cad" })),
    ).toEqual(["cad"]);
    expect(
      enabledCurrencies(
        parseEnv({ ...baseline, ENABLED_CURRENCIES: "usd,cad" }),
      ),
    ).toEqual(["cad", "usd"]);
    expect(
      enabledCurrencies(
        parseEnv({ ...baseline, ENABLED_CURRENCIES: " usd , cad " }),
      ),
    ).toEqual(["cad", "usd"]);
  });

  it("reads the loaded env by default (.env.test: cad)", () => {
    expect(enabledCurrencies()).toEqual(["cad"]);
  });
});

describe("ADMIN_EMAILS and ownerEmail (07 D88)", () => {
  it("is null when unset", () => {
    expect(ownerEmail(parseEnv(baseline))).toBeNull();
  });

  it("trims, lowercases, de-duplicates and keeps the owner first", () => {
    const e = parseEnv({
      ...baseline,
      ADMIN_EMAILS:
        " Owner@Example.com , helper@example.com,OWNER@example.com ",
    });
    expect(e.ADMIN_EMAILS).toEqual(["owner@example.com", "helper@example.com"]);
    expect(ownerEmail(e)).toBe("owner@example.com");
    expect(
      ownerEmail(
        parseEnv({ ...baseline, ADMIN_EMAILS: "b@example.com,a@example.com" }),
      ),
    ).toBe("b@example.com");
  });

  it("reads the loaded env by default (.env.test: the two e2e admins)", () => {
    expect(env.ADMIN_EMAILS).toEqual([
      "e2e-admin@example.com",
      "e2e-admin-2@example.com",
    ]);
    expect(ownerEmail()).toBe("e2e-admin@example.com");
  });
});

describe("error messages", () => {
  it("name the keys but never the values", () => {
    const shortSecret = "short-secret-XYZ";
    const badKey = "bm90LTMyLWJ5dGVz-secret";
    const message = failure({
      ...baseline,
      BETTER_AUTH_SECRET: shortSecret,
      CRON_SECRET: shortSecret,
      TOKEN_ENCRYPTION_KEY: badKey,
      DATABASE_URL: "mysql://admin:hunter2-db-password@db.example.com/x",
    });
    for (const key of [
      "BETTER_AUTH_SECRET",
      "CRON_SECRET",
      "TOKEN_ENCRYPTION_KEY",
      "DATABASE_URL",
    ]) {
      expect(message).toContain(key);
    }
    for (const value of [shortSecret, badKey, "hunter2-db-password"]) {
      expect(message).not.toContain(value);
    }
  });

  it("stay a plain Error that names the key when a URL can't be parsed", () => {
    const value = "https://secret-value pasted.example";
    let error: unknown;
    try {
      parseEnv({ ...baseline, APP_URL: value });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error).not.toHaveProperty("input");
    expect((error as Error).message).toContain("APP_URL");
    expect((error as Error).message).not.toContain(value);
  });
});

describe("ENV_KEYS", () => {
  // A key missing from .env.test would let `next start` fill it from .env.local during e2e (P01 Decisions);
  // .env.example is the template developers copy (02 §10).
  it.each([".env.test", ".env.example"])(
    "%s lists every key the schema reads",
    (file) => {
      const listed = Object.keys(parseEnvFile(readFileSync(file, "utf8")));
      expect(ENV_KEYS.filter((key) => !listed.includes(key))).toEqual([]);
    },
  );

  it(".env.example parses as a development environment once its secrets are filled", () => {
    const template = parseEnvFile(readFileSync(".env.example", "utf8"));
    expect(
      parseEnv({
        ...template,
        BETTER_AUTH_SECRET: SECRET,
        TOKEN_ENCRYPTION_KEY: KEY,
        CRON_SECRET: CRON,
      }).APP_ENV,
    ).toBe("development");
  });
});
