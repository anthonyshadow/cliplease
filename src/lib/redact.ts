// Redaction for logs and audit data (02 §9.9, 07 D47). Pure, with no server guard import, so the CLI-loaded Better Auth
// config can use it as well as src/server/log.ts.

const REDACTED = "[redacted]";
// Key names are compared folded (foldKey): lower-case, without "-" or "_", so one entry covers every spelling
// ("api_key", "API-Key", "apiKey"). These parts match anywhere in the key (header names included: set-cookie,
// x-api-key, stripe-signature).
const SECRET_KEY_PART =
  /token|secret|password|apikey|email|cookie|signature|credential|privatekey/;
// These match the whole key. Not "authorization" anywhere in a key: a payment authorization's id is no secret.
const SECRET_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "code",
  "otp",
]);
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
// Buyer license links carry their bearer token in the path, not the query (02 §9.5, ADR-24): /l/<token> and
// /api/licenses/<token>/…, in an absolute URL's path or as a bare path in text (anchored like the patterns above). The
// three patterns below share this prefix source, so a new license path is one edit.
const TOKEN_PATH_PREFIX = String.raw`\/(?:l|api\/licenses)`;
const TOKEN_PATH = new RegExp(String.raw`^(${TOKEN_PATH_PREFIX})\/[^/?#]+`);
const TOKEN_PATH_IN_TEXT = new RegExp(
  String.raw`(?<![^\s"'(=])(${TOKEN_PATH_PREFIX})\/[A-Za-z0-9_-]+`,
  "g",
);
// The text every TOKEN_PATH_IN_TEXT match contains. Most strings hold no license link: this literal search rules them
// out for a fraction of that pattern's cost (its lookbehind is tried at every position), and stays cheaper than
// includes() on text full of slashes.
const TOKEN_PATH_HINT = new RegExp(String.raw`${TOKEN_PATH_PREFIX}\/`);

export type RedactOptions = {
  /**
   * Whole-key names to keep although the log rules redact them, compared folded like SECRET_KEYS: the audit writer
   * keeps `code` (license codes).
   */
  keepKeys?: readonly string[];
};

const KEY_SEPARATORS = /[-_]/g;

/** `key` lower-cased without "-" or "_", the form every key-name rule is written in. */
function foldKey(key: string): string {
  return key.toLowerCase().replace(KEY_SEPARATORS, "");
}

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
 * A URL without its query string, fragment or credentials (signed URLs and database URLs carry secrets there), and
 * without a license link's path token. One that doesn't parse keeps only its scheme, since its host part may hold a
 * password ("postgres://user:pa/ss@host").
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
  u.pathname = u.pathname.replace(TOKEN_PATH, `$1/${REDACTED}`);
  return `${lead}${u.toString()}`;
}

/**
 * `text`, capped, with every absolute URL stripped, every license link token redacted and every email address replaced
 * by "[email]".
 */
export function redactText(text: string): string {
  const stripped = capText(text).replace(URL_IN_TEXT, stripUrl);
  const tokenless = TOKEN_PATH_HINT.test(stripped)
    ? stripped.replace(TOKEN_PATH_IN_TEXT, `$1/${REDACTED}`)
    : stripped;
  return tokenless.replace(EMAIL_IN_TEXT, "[email]");
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
 * credentials, license link tokens and email addresses, errors become { name, message } (query errors keep only pgCode
 * and constraint). Bigints become strings and an invalid Date "Invalid Date", so JSON.stringify can't throw on them.
 * Cycles become "[circular]".
 */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  const keep = new Set(options.keepKeys?.map(foldKey));
  const isRedactedKey = (key: string) => {
    const k = foldKey(key);
    if (keep.has(k)) return false;
    return SECRET_KEYS.has(k) || SECRET_KEY_PART.test(k);
  };
  // The objects on the path from the root: one seen twice side by side is copied twice, not called a cycle.
  const ancestors = new WeakSet<object>();
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return redactText(item);
    if (item instanceof Error) return redactError(item);
    if (typeof item === "bigint") return item.toString();
    if (item === null || typeof item !== "object") return item;
    if (item instanceof Date) {
      return Number.isNaN(item.getTime()) ? "Invalid Date" : item.toISOString();
    }
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
