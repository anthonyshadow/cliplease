// One JSON log line (02 §3, §9.9). Pure, with no server guard import: src/server/log.ts and the CLI-loaded Better Auth
// config both build their lines here.
import { redact } from "./redact";

export type LogLevel = "info" | "warn" | "error";

/** The format of log event names and audit actions ("scope.action"); the audit_event CHECK enforces it too. */
export const SCOPED_NAME = /^[a-z_]+([.][a-z_]+)+$/;

const RESERVED = new Set(["ts", "level", "event"]);

/**
 * `{ ts, level, event, ...fields }` as one line, fields redacted; fields can't replace ts, level or event. Never throws:
 * a log call usually sits in a catch block, so fields that can't be serialized (a throwing getter or toJSON) give
 * `logError: "unserializable_fields"` in their place instead of hiding the error being logged.
 */
export function formatLogLine(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): string {
  const ts = new Date().toISOString();
  try {
    const safe = redact(fields) as Record<string, unknown>;
    const rest = Object.fromEntries(
      Object.entries(safe).filter(([key]) => !RESERVED.has(key)),
    );
    return `${JSON.stringify({ ts, level, event, ...rest })}\n`;
  } catch {
    return `${JSON.stringify({ ts, level, event, logError: "unserializable_fields" })}\n`;
  }
}
