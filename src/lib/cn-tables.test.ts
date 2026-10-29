import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CN_TABLES, cnTablesSource } from "../../scripts/cn-tables";
// Imported so a change to the file reruns this test under `--changed`; it is read as text below.
import "./cn-tables";

describe("cn-tables.ts", () => {
  it("is what `bun run cn:tables` compiles now (run it after a cn upgrade or a type-scale change)", () => {
    expect(readFileSync(CN_TABLES, "utf8")).toBe(cnTablesSource());
  });
});
