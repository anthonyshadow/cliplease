import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/time";
import { publicStatus } from "./public-status";

const now = new Date("2026-10-30T12:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY_MS);

describe("publicStatus (research/license.md §6.2)", () => {
  it.each([
    { name: "no license", l: null, want: "not_found" },
    { name: "valid", l: { revokedAt: null, endsAt: at(10) }, want: "valid" },
    {
      name: "perpetual",
      l: { revokedAt: null, endsAt: null },
      want: "valid",
    },
    {
      name: "now == endsAt",
      l: { revokedAt: null, endsAt: now },
      want: "expired",
    },
    {
      name: "revoked",
      l: { revokedAt: at(-1), endsAt: at(10) },
      want: "revoked",
    },
    {
      name: "revoked and expired",
      l: { revokedAt: at(-5), endsAt: at(-1) },
      want: "revoked",
    },
  ] as const)("$name → $want", ({ l, want }) => {
    expect(publicStatus(l, now)).toBe(want);
  });
});
