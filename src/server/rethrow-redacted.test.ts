import { notFound, redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureLogEvents } from "../../tests/helpers/logs";
import { pgError, wrapped } from "../../tests/helpers/pg-errors";
import { rethrowRedacted } from "./rethrow-redacted";

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
});
