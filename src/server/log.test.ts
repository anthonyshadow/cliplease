import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "./log";

function capture() {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const lines = () =>
    [...out.mock.calls, ...err.mock.calls].map(
      ([chunk]) => JSON.parse(String(chunk)) as Record<string, unknown>,
    );
  return { out, err, lines };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logEvent (02 §9.9)", () => {
  it("writes one JSON line: info to stdout, warn and error to stderr", () => {
    const { out, err, lines } = capture();
    logEvent("info", "sync.started", { accountId: "a1" });
    logEvent("error", "stripe.webhook_failed");
    expect(out).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    const [info, error] = lines();
    expect(info).toMatchObject({
      level: "info",
      event: "sync.started",
      accountId: "a1",
    });
    expect(typeof info?.ts).toBe("string");
    expect(error).toMatchObject({
      level: "error",
      event: "stripe.webhook_failed",
    });
  });

  it.each([
    "accessToken",
    "refresh_token",
    "TOKEN",
    "clientSecret",
    "authorization",
    "Cookie",
    "code",
    "otp",
    "buyerEmail",
    "password",
    "apiKey",
  ])("redacts the key %s", (key) => {
    const { lines } = capture();
    logEvent("info", "test.redact", { [key]: "sensitive-value", keep: "ok" });
    expect(lines()[0]).toMatchObject({ [key]: "[redacted]", keep: "ok" });
  });

  it("redacts nested objects and arrays, keeping other keys", () => {
    const { lines } = capture();
    logEvent("warn", "test.nested", {
      account: { id: "a1", tokens: { access: "x" }, list: [{ otp: "123456" }] },
    });
    expect(lines()[0]).toMatchObject({
      account: {
        id: "a1",
        tokens: "[redacted]",
        list: [{ otp: "[redacted]" }],
      },
    });
  });

  it("drops the query string and credentials of URLs, alone or inside text", () => {
    const { lines } = capture();
    logEvent("info", "test.urls", {
      url: "https://bucket.r2.example/originals/v1.mp4?X-Amz-Signature=abc&X-Amz-Expires=600",
      note: "fetch https://cdn.example/p.jpg?token=xyz failed",
      db: "postgresql://owner:pw@ep-x.neon.tech/neondb?sslmode=require",
    });
    const [line] = lines();
    expect(line?.url).toBe("https://bucket.r2.example/originals/v1.mp4");
    expect(line?.note).toBe("fetch https://cdn.example/p.jpg failed");
    expect(String(line?.db)).not.toMatch(/pw|sslmode/);
  });

  it("turns an Error into { name, message } with URLs stripped", () => {
    const { lines } = capture();
    logEvent("error", "test.error", {
      error: new TypeError(
        "GET https://api.example/x?access_token=abc returned 500",
      ),
    });
    expect(lines()[0]?.error).toEqual({
      name: "TypeError",
      message: "GET https://api.example/x returned 500",
    });
  });

  it("keeps only the Postgres code and constraint of a query error, never its SQL or parameters", () => {
    const { lines } = capture();
    const cause = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "user_email_unique",
    });
    logEvent("error", "test.db", {
      error: new DrizzleQueryError(
        "insert into user values ($1)",
        ["maya@example.com"],
        cause,
      ),
    });
    const [line] = lines();
    expect(line?.error).toEqual({
      name: "QueryError",
      pgCode: "23505",
      constraint: "user_email_unique",
    });
    expect(JSON.stringify(line)).not.toContain("maya@example.com");
  });

  it("never throws on a bigint or an invalid Date", () => {
    const { lines } = capture();
    expect(() =>
      logEvent("warn", "test.odd", { n: BigInt(1), at: new Date(Number.NaN) }),
    ).not.toThrow();
    expect(lines()[0]).toMatchObject({ n: "1", at: "Invalid Date" });
  });

  it("writes the event with logError when a field can't be serialized, instead of throwing", () => {
    const { lines } = capture();
    const field = {
      toJSON() {
        throw new Error("boom");
      },
    };
    expect(() =>
      logEvent("error", "test.unserializable", { field, videoId: "v1" }),
    ).not.toThrow();
    const written = lines();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      level: "error",
      event: "test.unserializable",
      logError: "unserializable_fields",
    });
    expect(typeof written[0]?.ts).toBe("string");
  });

  it("refuses an event name that isn't scope.action, and fields can't override ts, level or event", () => {
    const { lines } = capture();
    for (const bad of ["Seed Applied", "sync", "sync.", "Sync.started"]) {
      expect(() => logEvent("info", bad)).toThrow(/scope\.action/);
    }
    logEvent("info", "test.reserved", { event: "spoof", level: "error" });
    expect(lines()[0]).toMatchObject({ event: "test.reserved", level: "info" });
  });
});
