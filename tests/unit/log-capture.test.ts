import { afterEach, expect, it, vi } from "vitest";
import {
  AFTER_FAILED,
  captureLogEvents,
  dropStderr,
  endStderr,
  recordStderr,
  stopStderr,
} from "../helpers/logs";

// tests/helpers/logs.ts (P19): a suite's recording from beforeEach keeps watching for a failed after() task while a
// test captures its own events inside it, so the two must share one stderr spy without ending each other.

afterEach(() => {
  dropStderr();
  vi.restoreAllMocks();
});

it("a capture inside a recording reads its own part and leaves the recording running", () => {
  recordStderr(AFTER_FAILED);
  process.stderr.write('{"event":"a.before"}\n');
  const inner = captureLogEvents("x.y");
  process.stderr.write('{"event":"x.y","n":1}\n');
  const got = inner();
  expect(got.events).toEqual([{ event: "x.y", n: 1 }]);
  expect(got.written).not.toContain("a.before");
  process.stderr.write(`{"event":"${AFTER_FAILED}"}\n`);
  expect(() => stopStderr()).toThrow();
});

it("restores stderr when the recording ends, and a capture after it spies again", () => {
  const original = process.stderr.write;
  recordStderr(AFTER_FAILED);
  expect(process.stderr.write).not.toBe(original);
  endStderr();
  expect(process.stderr.write).toBe(original);
  const later = captureLogEvents("q.r");
  process.stderr.write('{"event":"q.r"}\n');
  expect(later().events).toEqual([{ event: "q.r" }]);
  expect(process.stderr.write).toBe(original);
});

it("doesn't share a spy restoreAllMocks already restored", () => {
  recordStderr("a.b");
  vi.restoreAllMocks();
  const fresh = captureLogEvents("q.r");
  process.stderr.write('{"event":"q.r"}\n');
  expect(fresh().events).toEqual([{ event: "q.r" }]);
});

it("dropStderr restores stderr without checking", () => {
  const original = process.stderr.write;
  recordStderr(AFTER_FAILED);
  process.stderr.write(`{"event":"${AFTER_FAILED}"}\n`);
  dropStderr();
  expect(process.stderr.write).toBe(original);
});
