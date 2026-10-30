import { describe, expect, it } from "vitest";
import type { TermKey } from "@/lib/domain/values";
import { computeEndsAt } from "./ends-at";

// 07 D33's goldens. The Verify step runs this file under TZ=America/Los_Angeles and TZ=Pacific/Auckland too: the result
// never depends on the process's zone.
describe("computeEndsAt (07 D33)", () => {
  it.each<{ startsAt: string; term: TermKey; endsAt: string }>([
    {
      startsAt: "2026-08-31T14:32:00Z",
      term: "m6",
      endsAt: "2027-02-28T14:32:00.000Z",
    },
    {
      startsAt: "2028-02-29T10:00:00Z",
      term: "y1",
      endsAt: "2029-02-28T10:00:00.000Z",
    },
    {
      startsAt: "2027-01-31T23:30:00Z",
      term: "m6",
      endsAt: "2027-07-31T23:30:00.000Z",
    },
    {
      startsAt: "2026-10-15T14:32:00Z",
      term: "d30",
      endsAt: "2026-11-14T14:32:00.000Z",
    },
    {
      startsAt: "2026-10-20T12:00:00Z",
      term: "d30",
      endsAt: "2026-11-19T12:00:00.000Z",
    },
  ])("$startsAt + $term → $endsAt", ({ startsAt, term, endsAt }) => {
    expect(computeEndsAt(new Date(startsAt), term)?.toISOString()).toBe(endsAt);
  });

  it("keeps the milliseconds of a month-based term", () => {
    expect(
      computeEndsAt(new Date("2026-10-30T09:15:42.123Z"), "y1")?.toISOString(),
    ).toBe("2027-10-30T09:15:42.123Z");
  });

  it("a perpetual license has no end", () => {
    expect(computeEndsAt(new Date("2026-10-15T14:32:00Z"), "perpetual")).toBe(
      null,
    );
  });
});
