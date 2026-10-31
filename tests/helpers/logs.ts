// What the server logs, for [int] tests: stderr silenced and recorded, then parsed by event (uploads, payments, social).
// P19 adds the recording a file keeps through each test (recordStderr, from beforeEach): a failed after() task shows.
import { expect, vi } from "vitest";

/** stderr silenced, each write recorded. */
const spyStderr = () =>
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

/** The spy of the capture running now, if any. */
let running: ReturnType<typeof spyStderr> | null = null;

/**
 * Silences stderr and records what is written to it from now on. The returned function gives back all of it
 * (`written`, for what a log line must not carry) and the lines that log `event`, parsed (`events`), and restores
 * stderr. Inside another capture (a file's recording from beforeEach) it reads its own part of that capture's spy and
 * leaves the spy running: spying again would hand back the same spy, and restoring it would end the outer capture.
 */
export function captureLogEvents(event: string) {
  const outer = Object.is(process.stderr.write, running) ? running : null;
  const stderr = outer ?? spyStderr();
  if (!outer) running = stderr;
  const from = stderr.mock.calls.length;
  return () => {
    const written = stderr.mock.calls
      .slice(from)
      .map(([chunk]) => String(chunk))
      .join("");
    if (!outer) {
      stderr.mockRestore();
      if (running === stderr) running = null;
    }
    const events = written
      .split("\n")
      .filter((line) => line.includes(`"${event}"`))
      .map((line) => JSON.parse(line) as unknown);
    return { written, events };
  };
}

/** A task after() ran failed: afterResponse logs it and nothing else would show it. */
export const AFTER_FAILED = "effects.after_failed";

/** The recording recordStderr started, until it is stopped. */
let recording: ReturnType<typeof captureLogEvents> | null = null;

/** Records this test's stderr, `event`'s lines parsed, in place of the recording beforeEach started. */
export function recordStderr(event: string): void {
  recording?.();
  recording = captureLogEvents(event);
}

/** Stops the recording: what was written and the recorded event's lines. No after() task may have failed. */
export function stopStderr() {
  const stop = recording;
  recording = null;
  if (!stop) throw new Error("stderr isn't being recorded");
  const logged = stop();
  expect(logged.written).not.toContain(`"${AFTER_FAILED}"`);
  return logged;
}

/** For afterEach: stops a recording the test left running, checked as stopStderr checks it. */
export function endStderr(): void {
  if (recording) stopStderr();
}

/** For afterEach's finally: ends a recording still running, unchecked, and restores stderr. */
export function dropStderr(): void {
  const stop = recording;
  recording = null;
  stop?.();
}
