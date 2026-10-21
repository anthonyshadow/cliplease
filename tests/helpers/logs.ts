// What the server logs, for [int] tests: stderr silenced and recorded, then parsed by event (uploads, payments, social).
import { vi } from "vitest";

/**
 * Silences stderr and records what is written to it from now on. The returned function restores it and gives back all
 * of it (`written`, for what a log line must not carry) and the lines that log `event`, parsed (`events`).
 */
export function captureLogEvents(event: string) {
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  return () => {
    const written = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
    stderr.mockRestore();
    const events = written
      .split("\n")
      .filter((line) => line.includes(`"${event}"`))
      .map((line) => JSON.parse(line) as unknown);
    return { written, events };
  };
}
