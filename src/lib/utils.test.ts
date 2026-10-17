import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cn, TYPE_SCALE } from "./utils";

describe("cn", () => {
  it("keeps a type-scale size next to a text color", () => {
    expect(cn("text-callout font-semibold", "text-ink")).toBe(
      "text-callout font-semibold text-ink",
    );
    expect(cn("bg-action text-action-ink h-11 px-5 text-body")).toBe(
      "bg-action text-action-ink h-11 px-5 text-body",
    );
    expect(cn("text-caption bg-cleared text-cleared-ink")).toBe(
      "text-caption bg-cleared text-cleared-ink",
    );
  });

  it("still lets a later size or color win", () => {
    expect(cn("text-body text-ink", "text-callout")).toBe(
      "text-ink text-callout",
    );
    expect(cn("text-ink", "text-ink-2")).toBe("text-ink-2");
  });

  it("knows exactly the --text-* sizes globals.css defines", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const names = [
      ...css.matchAll(/^\s*--text-([a-z0-9]+(?:-[a-z0-9]+)*):/gm),
    ].map((m) => m[1]);
    expect([...new Set(names)].sort()).toEqual([...TYPE_SCALE].sort());
  });
});
