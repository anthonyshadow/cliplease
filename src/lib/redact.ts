// Redaction for logs and audit data (02 §9.9, 07 D47). Pure, with no server guard import, so the CLI-loaded Better Auth
// config can use it as well as src/server/log.ts.

const REDACTED = "[redacted]";
// Key names: these match anywhere in the key, case-insensitively.
const SECRET_KEY_PARTS = [
  "token",
  "secret",
  "password",
  "apikey",
  "api_key",
  "email",
];
// These match the whole key, case-insensitively.
const SECRET_KEYS = new Set(["authorization", "cookie", "code", "otp"]);
// Strings are cut to this length before any pattern runs: a logged value can come from a request (a callback URL, a
// header), and the line must stay small and cheap whatever its size.
const MAX_TEXT = 2048;
// An absolute URL inside a string: scheme://… up to whitespace or a quote. A match starts only where a run of scheme
// characters starts, so each run is scanned once (a `\b` start retries inside it: quadratic time); stripUrl peels off
// what can't begin a scheme ("-https://…", "1https://…").
const URL_IN_TEXT = /(?<![a-z0-9+.-])[a-z0-9+.-]+:\/\/[^\s"'<>]+/gi;
// An email address inside a string (people's addresses never reach logs, 07 D47); anchored the same way.
const EMAIL_IN_TEXT =
  /(?<![^\s@<>"'():;,])[^\s@<>"'():;,]+@[^\s@<>"'():;,]+\.[a-z]{2,}/gi;

export type RedactOptions = {
  /** Whole-key names to keep although the log rules redact them: the audit writer keeps `code` (license codes). */
  keepKeys?: readonly string[];
};

/** `text` cut back to its last whitespace before MAX_TEXT, so half an email address or URL never survives. */
function capText(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  const head = text.slice(0, MAX_TEXT);
  const cut = Math.max(
    head.lastIndexOf(" "),
    head.lastIndexOf("\n"),
    head.lastIndexOf("\t"),
  );
  return `${cut > 0 ? head.slice(0, cut) : ""} [truncated]`.trimStart();
}

/**
 * A URL without its query string, fragment or credentials (signed URLs and database URLs carry secrets there). One that
 * doesn't parse keeps only its scheme, since its host part may hold a password ("postgres://user:pa/ss@host").
 */
function stripUrl(match: string): string {
  const lead = /^[0-9+.-]*/.exec(match)?.[0] ?? "";
  const url = match.slice(lead.length);
  if (!/^[a-z]/i.test(url)) return match;
  if (!URL.canParse(url)) {
    return `${lead}${url.slice(0, url.indexOf("://") + 3)}[unparsed]`;
  }
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  u.username = "";
  u.password = "";
  return `${lead}${u.toString()}`;
}

/** `text`, capped, with every absolute URL stripped and every email address replaced by "[email]". */
export function redactText(text: string): string {
  return capText(text)
    .replace(URL_IN_TEXT, stripUrl)
    .replace(EMAIL_IN_TEXT, "[email]");
}

function redactError(error: Error): Record<string, unknown> {
  // A Drizzle query error carries the SQL and every bound parameter: keep only the Postgres code and constraint.
  if ("query" in error || "params" in error) {
    const cause = error.cause as
      | { code?: unknown; constraint?: unknown }
      | undefined;
    return {
      name: "QueryError",
      pgCode: typeof cause?.code === "string" ? cause.code : undefined,
      constraint:
        typeof cause?.constraint === "string" ? cause.constraint : undefined,
    };
  }
  return { name: error.name, message: redactText(error.message) };
}

/**
 * A copy of `value` safe to log: secret keys become "[redacted]", strings are capped and lose URL query strings,
 * credentials and email addresses, errors become { name, message } (query errors keep only pgCode and constraint).
 * Cycles become "[circular]".
 */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  const keep = new Set(options.keepKeys?.map((key) => key.toLowerCase()));
  const isRedactedKey = (key: string) => {
    const k = key.toLowerCase();
    if (keep.has(k)) return false;
    return (
      SECRET_KEYS.has(k) || SECRET_KEY_PARTS.some((part) => k.includes(part))
    );
  };
  // The objects on the path from the root: one seen twice side by side is copied twice, not called a cycle.
  const ancestors = new WeakSet<object>();
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return redactText(item);
    if (item instanceof Error) return redactError(item);
    if (item === null || typeof item !== "object") return item;
    if (item instanceof Date) return item.toISOString();
    if (ancestors.has(item)) return "[circular]";
    ancestors.add(item);
    const copy = Array.isArray(item)
      ? item.map(walk)
      : Object.fromEntries(
          Object.entries(item).map(([key, child]) => [
            key,
            isRedactedKey(key) ? REDACTED : walk(child),
          ]),
        );
    ancestors.delete(item);
    return copy;
  };
  return walk(value);
}
