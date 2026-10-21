import { describe, expect, it } from "vitest";
import {
  FORM_LEVEL_ERRORS,
  maskEmail,
  normalizeOtpInput,
  OTP_RESEND_DELAY_MS,
  SIGN_IN_COPY,
  safeNextPath,
  shouldAutoSubmit,
  signInErrorKey,
  signInPath,
  signInRateLimits,
} from "./sign-in";

describe("safeNextPath", () => {
  it.each([
    "/dashboard",
    "/dashboard/library?platform=mock",
    "/onboarding",
    "/admin",
    "/dashboard?x=a%2Fb",
    "/dashboard/v1.2",
    "/dashboard?q=../x",
    "/apis",
    "/dashboard?next=/api/x",
  ])("keeps the same-site path %s", (next) => {
    expect(safeNextPath(next)).toBe(next);
  });

  it.each([
    ["an empty value", ""],
    ["null", null],
    ["undefined", undefined],
    ["a protocol-relative URL", "//evil.com"],
    ["a backslash host", "/\\evil.com"],
    ["a backslash later on", "/x\\evil.com"],
    ["an absolute URL", "https://evil.com"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a dot-segment escape", "/..//evil.com"],
    ["a single-dot segment", "/.//evil.com"],
    ["an encoded dot segment", "/%2e%2e//evil.com"],
    ["a mixed encoded dot segment", "/.%2E//evil.com"],
    ["a tab", "/\t/evil.com"],
    ["a newline", "/x\n/evil.com"],
    ["a non-ASCII space", "/　/x"],
    ["a relative path", "dashboard"],
    ["the sign-in page", "/sign-in?next=/x"],
    ["the sign-in page, uppercase", "/SIGN-IN"],
    ["an API route", "/api/stripe/onboarding"],
    ["an API route with a query", "/api/connect/mock/start?x=1"],
    ["the API root", "/api"],
    ["an API route, uppercase", "/API/stripe/onboarding"],
    ["a percent-encoded API route", "/%61pi/stripe/onboarding"],
    ["an API route with an encoded slash", "/api%2Fstripe/onboarding"],
  ])("refuses %s", (_case, next) => {
    expect(safeNextPath(next)).toBe("/dashboard");
  });

  it("keeps an encoded double slash raw (the browser treats it as a path)", () => {
    expect(safeNextPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });
});

describe("signInPath", () => {
  it("builds the same URL as the proxy's searchParams.set", () => {
    const url = new URL("/sign-in", "http://x");
    for (const next of ["/dashboard", "/dashboard?x=1&y=a b", "/admin"]) {
      url.searchParams.set("next", next);
      expect(signInPath(next)).toBe(`${url.pathname}${url.search}`);
    }
    expect(signInPath("/dashboard")).toBe("/sign-in?next=%2Fdashboard");
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain (01 J1.1)", () => {
    expect(maskEmail("maya@example.com")).toBe("m…@example.com");
    expect(maskEmail("x@y.co")).toBe("x…@y.co");
  });
});

describe("normalizeOtpInput", () => {
  it.each([
    ["123456", "123456"],
    ["123 456", "123456"],
    [" 123456 ", "123456"],
    ["123 456", "123456"],
    ["123 456", "123456"],
    ["012345", "012345"],
  ])("reads %j as %s", (raw, want) => {
    expect(normalizeOtpInput(raw)).toBe(want);
  });

  it.each(["12345", "1234567", "12a456", "", "123-456"])(
    "refuses %j",
    (raw) => {
      expect(normalizeOtpInput(raw)).toBeNull();
    },
  );
});

describe("sign-in constants and limits", () => {
  it("shows Send a new code after 30 s", () => {
    expect(OTP_RESEND_DELAY_MS).toBe(30_000);
  });

  it("allows 3 sends and 10 checks per minute, relaxed to 1000 in test (07 D54)", () => {
    expect(signInRateLimits("development")).toEqual({
      "/email-otp/send-verification-otp": { window: 60, max: 3 },
      "/sign-in/email-otp": { window: 60, max: 10 },
    });
    expect(signInRateLimits("production")).toEqual(
      signInRateLimits("development"),
    );
    expect(signInRateLimits("test")).toEqual({
      "/email-otp/send-verification-otp": { window: 60, max: 1000 },
      "/sign-in/email-otp": { window: 60, max: 1000 },
    });
  });
});

describe("signInErrorKey (better-auth 1.7.7 codes)", () => {
  it.each([
    [{ status: 400, code: "INVALID_OTP" }, "code", "badCode"],
    [{ status: 400, code: "OTP_EXPIRED" }, "code", "badCode"],
    [{ status: 403, code: "TOO_MANY_ATTEMPTS" }, "code", "badCode"],
    [{ status: 400, code: "INVALID_EMAIL" }, "email", "invalidEmail"],
    [{ status: 400, code: "VALIDATION_ERROR" }, "email", "invalidEmail"],
    [{ status: 400, code: "VALIDATION_ERROR" }, "code", "generic"],
    [{ status: 429 }, "email", "tooManyTries"],
    [{ status: 429 }, "code", "tooManyTries"],
    [{ status: 403, code: "INVALID_ORIGIN" }, "code", "generic"],
    [{ status: 500 }, "email", "generic"],
  ] as const)("%j on the %s step → %s", (error, step, want) => {
    expect(signInErrorKey(error, step)).toBe(want);
  });

  it("shows only offline and generic failures as a form Banner; the rest belong to the field", () => {
    expect([...FORM_LEVEL_ERRORS].sort()).toEqual(["generic", "offline"]);
    expect(Object.keys(SIGN_IN_COPY).sort()).toEqual([
      "badCode",
      "generic",
      "invalidEmail",
      "offline",
      "tooManyTries",
    ]);
  });
});

describe("shouldAutoSubmit (05 §5.1)", () => {
  const change = (
    value: string,
    inputType?: string,
    data?: string | null,
    lastTried: string | null = null,
  ) => shouldAutoSubmit({ value, inputType, data, lastTried });

  it.each([
    ["a paste", change("482913", "insertFromPaste", null)],
    ["a grouped paste", change("482 913", "insertFromPaste", null)],
    ["a drop", change("482913", "insertFromDrop", null)],
    ["a keyboard code suggestion", change("482913", "insertReplacementText")],
    ["autofill (a plain Event)", change("482913")],
    ["six digits inserted at once", change("482913", "insertText", "482913")],
  ])("submits %s", (_case, result) => {
    expect(result).toBe(true);
  });

  it.each([
    ["the 6th typed digit", change("482913", "insertText", "3")],
    [
      "a deletion down to six digits",
      change("482913", "deleteContentBackward"),
    ],
    ["an undo", change("482913", "historyUndo")],
    ["five digits", change("48291", "insertFromPaste", null)],
    ["seven digits", change("4829137", "insertFromPaste", null)],
    ["letters", change("48291a", "insertFromPaste", null)],
    [
      "the code that was just tried",
      change("482913", "insertFromPaste", null, "482913"),
    ],
  ])("leaves %s to the Sign in button", (_case, result) => {
    expect(result).toBe(false);
  });
});
