import "server-only";
import { formatLogLine, type LogLevel, SCOPED_NAME } from "../lib/log-line";

// JSON-line logs with redaction (02 §3, §9.9). Every later "log `x.y`" calls logEvent. Sign-in codes never reach it.

/** Writes one JSON line ({ ts, level, event, ...fields }, redacted) to stdout (info) or stderr (warn, error). */
export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (!SCOPED_NAME.test(event)) {
    throw new Error(`log event "${event}" must look like scope.action`);
  }
  (level === "info" ? process.stdout : process.stderr).write(
    formatLogLine(level, event, fields),
  );
}
