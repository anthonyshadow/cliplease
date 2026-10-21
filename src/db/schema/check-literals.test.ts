import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APPROVAL_WINDOW_HOURS,
  REGION_KEYS,
  TERM_KEYS,
  TERRITORY_KEYS,
  USE_KEYS,
  VERIFIABLE_POSTING_PLATFORMS,
} from "../../lib/domain/values";
import { ORIGINAL_MIME } from "../../lib/upload/limits";

// The CHECKs that copy a values.ts tuple as literals (07 D04: values.ts is the only place tuples are declared), read from
// the migrations in journal order, so a tuple edit without a migration fails here first. enums.test.ts covers the
// pgEnums and src/lib/pricing/presets.test.ts the money ranges.
const journal = JSON.parse(
  readFileSync("drizzle/meta/_journal.json", "utf8"),
) as { entries: { tag: string }[] };
const migrations = journal.entries
  .map((entry) => readFileSync(`drizzle/${entry.tag}.sql`, "utf8"))
  .join("\n");

/** The body of CHECK `name` as the last migration that defines it wrote it, up to its matching close paren. */
function checkBody(name: string): string {
  const head = `"${name}" CHECK (`;
  const start = migrations.lastIndexOf(head);
  if (start === -1) throw new Error(`CHECK ${name} not found`);
  let depth = 0;
  let quoted = false;
  for (let i = start + head.length - 1; i < migrations.length; i++) {
    const char = migrations[i];
    if (char === "'") quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth++;
    if (char === ")" && --depth === 0) {
      return migrations.slice(start + head.length, i);
    }
  }
  throw new Error(`CHECK ${name} has no closing paren`);
}

/** The values of the first `"column" in (…)` list in `body` that comes after `guard`, as strings and numbers. */
function inList(body: string, column: string, guard = ""): (string | number)[] {
  const from = body.indexOf(guard);
  const match = new RegExp(`"${column}" in\\s*\\(([^)]*)\\)`).exec(
    from === -1 ? "" : body.slice(from),
  );
  if (!match?.[1]) throw new Error(`no "${column}" in (…) list ${guard}`);
  return match[1].split(",").map((raw) => {
    const item = raw.trim();
    if (/^'[^']*'$/.test(item)) return item.slice(1, -1);
    if (/^\d+$/.test(item)) return Number(item);
    throw new Error(`unexpected list item ${item}`);
  });
}

const sorted = (values: readonly (string | number)[]) => [...values].sort();

describe("CHECK literals that copy values.ts tuples (07 D04)", () => {
  it.each([
    ["license_request_use_key", "use_key", USE_KEYS],
    ["license_request_term_key", "term_key", TERM_KEYS],
    ["license_request_territory_key", "territory_key", TERRITORY_KEYS],
    ["license_request_territory_code", "territory_code", REGION_KEYS],
    [
      "creator_profile_approval_window",
      "approval_window_hours",
      APPROVAL_WINDOW_HOURS,
    ],
    [
      "license_request_approval_window",
      "approval_window_hours",
      APPROVAL_WINDOW_HOURS,
    ],
    ["video_posting_verified_fields", "platform", VERIFIABLE_POSTING_PLATFORMS],
    ["video_posting_unverifiable", "platform", VERIFIABLE_POSTING_PLATFORMS],
    ["video_original_ready", "original_mime", ORIGINAL_MIME],
  ] as const)("%s lists %s as the tuple", (name, column, tuple) => {
    expect(sorted(inList(checkBody(name), column))).toEqual(sorted(tuple));
  });

  it.each([
    ["use", USE_KEYS],
    ["term", TERM_KEYS],
    ["territory", TERRITORY_KEYS],
  ] as const)(
    "rate_option_key_matches_dimension lists the %s keys",
    (dimension, tuple) => {
      const body = checkBody("rate_option_key_matches_dimension");
      expect(
        sorted(inList(body, "option_key", `"dimension" = '${dimension}'`)),
      ).toEqual(sorted(tuple));
    },
  );
});
