// The migrations as one text, for the unit tests that read a CHECK's literals (07 D04, D97). Tests only.
import { readFileSync } from "node:fs";

/** Every migration's SQL, in journal order. */
export function allMigrationsSql(): string {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as { entries: { tag: string }[] };
  return journal.entries
    .map((entry) => readFileSync(`drizzle/${entry.tag}.sql`, "utf8"))
    .join("\n");
}
