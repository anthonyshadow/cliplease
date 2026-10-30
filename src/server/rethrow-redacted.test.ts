import { notFound, redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureLogEvents } from "../../tests/helpers/logs";
import { pgError, wrapped } from "../../tests/helpers/pg-errors";
import { env } from "./env";
import { redactErrors, rethrowRedacted } from "./rethrow-redacted";

afterEach(() => {
  vi.restoreAllMocks();
});

/** What a thrown error is, or undefined when `run` returns. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("rethrowRedacted", () => {
  it("logs the event without the query's values and throws a plain error with no cause", () => {
    const logs = captureLogEvents("license_request.start_failed");
    const failed = wrapped(
      pgError("57P01"),
      "insert into license_request (buyer_email) values ($1)",
      ["buyer@example.com"],
    );
    const thrown = thrownBy(() =>
      rethrowRedacted(failed, "license_request.start_failed"),
    );
    const { written, events } = logs();
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBe(failed);
    expect((thrown as Error).message).toBe("license_request.start_failed");
    expect((thrown as Error).cause).toBeUndefined();
    expect(events).toEqual([
      expect.objectContaining({
        level: "error",
        error: expect.objectContaining({ name: "QueryError", pgCode: "57P01" }),
      }),
    ]);
    expect(written).not.toContain("buyer@example.com");
  });

  it("lets Next's redirect and notFound through untouched, logging nothing", () => {
    const logs = captureLogEvents("test.failed");
    for (const control of [() => redirect("/r/x"), () => notFound()]) {
      const original = thrownBy(control);
      expect(thrownBy(() => rethrowRedacted(original, "test.failed"))).toBe(
        original,
      );
    }
    expect(logs().written).toBe("");
  });

  it("lets an error it already redacted through as it is, logging it once", () => {
    const logs = captureLogEvents("auth.session_read_failed");
    const inner = thrownBy(() =>
      rethrowRedacted(pgError("57P01"), "auth.session_read_failed"),
    );
    expect(thrownBy(() => rethrowRedacted(inner, "video.publish_failed"))).toBe(
      inner,
    );
    expect(logs().events).toHaveLength(1);
  });

  it("throws the original error with APP_ENV=development, logging nothing", () => {
    const logs = captureLogEvents("test.failed");
    const original = pgError("57P01");
    const before = env.APP_ENV;
    env.APP_ENV = "development";
    try {
      expect(thrownBy(() => rethrowRedacted(original, "test.failed"))).toBe(
        original,
      );
    } finally {
      env.APP_ENV = before;
    }
    expect(logs().written).toBe("");
  });
});

describe("redactErrors", () => {
  it("returns what the run returns", async () => {
    await expect(redactErrors("test.failed", async () => 42)).resolves.toBe(42);
  });

  it("rejects with a plain error named after the event, the query's values left out of the log", async () => {
    const logs = captureLogEvents("video.publish_failed");
    const failed = wrapped(pgError("23505"), "update video set title = $1", [
      "My secret title",
    ]);
    const run = redactErrors("video.publish_failed", async () => {
      throw failed;
    });
    await expect(run).rejects.toThrow(/^video\.publish_failed$/);
    expect(logs().written).not.toContain("My secret title");
  });
});
