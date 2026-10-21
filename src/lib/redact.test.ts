import { describe, expect, it } from "vitest";
import { redact, redactText } from "./redact";

// redact() through logEvent is covered in src/server/log.test.ts; these cases cover the text rules' limits.
describe("redactText", () => {
  it("strips URLs and replaces emails anywhere in the text", () => {
    expect(
      redactText(
        "Invalid callbackURL: https://evil.example/cb?token=abc (from Maya.R@Example.com)",
      ),
    ).toBe("Invalid callbackURL: https://evil.example/cb (from [email])");
  });

  it.each([
    ["got -https://host/x?token=abc", "got -https://host/x"],
    ["got 1https://host/x?token=abc", "got 1https://host/x"],
    ["see .https://host/x?token=abc", "see .https://host/x"],
    ["got +https://host/x?token=abc", "got +https://host/x"],
    ["at https://user:pw@host/x#frag", "at https://host/x"],
    [
      "fetch failed: https://api.example.com:99999/cb?token=secret123",
      "fetch failed: https://[unparsed]",
    ],
    ["db postgres://user:pa/ss@host/db", "db postgres://[unparsed]"],
    ["db postgres://user:pa#ss@host", "db postgres://[unparsed]"],
    ["not a URL: 123://x and -://y", "not a URL: 123://x and -://y"],
  ])("strips the URL in %j", (text, want) => {
    expect(redactText(text)).toBe(want);
  });

  it.each([
    ["a.a.a.", 100_000],
    ["a", 200_000],
    ["/x", 100_000],
    ["a@a.", 50_000],
    ["a1", 100_000],
    ["-a", 100_000],
    ["1.", 100_000],
    ["=/l/", 50_000],
    [" /api/licenses/", 20_000],
  ])(
    "stays fast on a huge run of %j (a request-controlled value)",
    (unit, times) => {
      const text = `Invalid callbackURL: ${unit.repeat(times)}`;
      const start = performance.now();
      const out = redactText(text);
      expect(performance.now() - start).toBeLessThan(50);
      expect(out.length).toBeLessThanOrEqual(2048 + " [truncated]".length);
      expect(out.endsWith("[truncated]")).toBe(true);
    },
  );

  it("cuts a long text back to whitespace, so half an email address never survives", () => {
    const text = `${"word ".repeat(408)}someone@example.com and more`;
    const out = redactText(text);
    expect(out).not.toContain("someone");
    expect(out.endsWith(" [truncated]")).toBe(true);
  });

  it("keeps short text whole", () => {
    expect(redactText("sync failed for account a1")).toBe(
      "sync failed for account a1",
    );
  });

  it.each([
    [
      "fetch https://cliplease.com/l/AbC123_-xyz?x=1 failed",
      "fetch https://cliplease.com/l/[redacted] failed",
    ],
    [
      "GET https://cliplease.com/api/licenses/AbC123_-xyz/original",
      "GET https://cliplease.com/api/licenses/[redacted]/original",
    ],
    ["GET /l/AbC123_-xyz failed", "GET /l/[redacted] failed"],
    [
      'path="/api/licenses/AbC123_-xyz/original"',
      'path="/api/licenses/[redacted]/original"',
    ],
  ])("redacts the license link token in %j", (text, want) => {
    expect(redactText(text)).toBe(want);
  });

  it.each([
    [
      "https://cliplease.com/r/0b9f3c2e-4d5a-4c1b-9a7e-2f1d3c4b5a69?t=abc",
      "https://cliplease.com/r/0b9f3c2e-4d5a-4c1b-9a7e-2f1d3c4b5a69",
    ],
    ["https://cliplease.com/library/v1", "https://cliplease.com/library/v1"],
    [
      "https://cliplease.com/dashboard/l/x",
      "https://cliplease.com/dashboard/l/x",
    ],
    ["GET /library/v1", "GET /library/v1"],
    ["GET /dashboard/l/x", "GET /dashboard/l/x"],
  ])("keeps any other path in %j", (text, want) => {
    expect(redactText(text)).toBe(want);
  });
});

describe("redact", () => {
  it("keeps only the whole keys listed in keepKeys", () => {
    expect(
      redact(
        { code: "CL-7K3M-9QXA", Code: "x", otp: "1", accessToken: "t" },
        { keepKeys: ["code"] },
      ),
    ).toEqual({
      code: "CL-7K3M-9QXA",
      Code: "x",
      otp: "[redacted]",
      accessToken: "[redacted]",
    });
    expect(redact({ code: "CL-7K3M-9QXA" })).toEqual({ code: "[redacted]" });
  });

  it.each([
    "set-cookie",
    "Set-Cookie",
    "cookies",
    "proxy-authorization",
    "x-api-key",
    "stripe-signature",
    "privateKey",
    "private_key",
    "credentials",
    "clientSecret",
  ])("redacts the key %s", (key) => {
    expect(redact({ [key]: "sensitive-value" })).toEqual({
      [key]: "[redacted]",
    });
  });

  it("keeps ids and names that only look close to a secret key", () => {
    const fields = {
      videoId: "v1",
      accountId: "a1",
      kind: "original",
      authorizationId: "auth_1",
      reason: "bad_signature_bytes",
    };
    expect(redact(fields)).toEqual(fields);
  });

  it("turns a bigint into a string and an invalid Date into a marker, so JSON.stringify can't throw", () => {
    const at = new Date("2026-10-20T12:00:00.000Z");
    const safe = redact({ n: BigInt(1), bad: new Date(Number.NaN), at });
    expect(safe).toEqual({
      n: "1",
      bad: "Invalid Date",
      at: "2026-10-20T12:00:00.000Z",
    });
    expect(() => JSON.stringify(safe)).not.toThrow();
  });

  it("marks a cycle as circular but copies an object that is only shared", () => {
    const shared = { id: "a1" };
    const cyclic: Record<string, unknown> = { id: "c1" };
    cyclic.self = cyclic;
    expect(redact({ cyclic, first: shared, again: [shared] })).toEqual({
      cyclic: { id: "c1", self: "[circular]" },
      first: { id: "a1" },
      again: [{ id: "a1" }],
    });
  });
});
