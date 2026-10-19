import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "../../lib/time";
import { refreshDecision } from "./tokens";

const NOW = new Date("2026-10-18T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const row = (
  expiresIn: number | null,
  refreshedAgo: number | null = HOUR_MS,
) => ({
  accessTokenExpiresAt: expiresIn === null ? null : at(expiresIn),
  tokenRefreshedAt: refreshedAgo === null ? null : at(-refreshedAgo),
});

describe("refreshDecision (02 §7.4, 07 D12)", () => {
  it("uses a token without an expiry on every platform", () => {
    for (const p of ["instagram", "tiktok", "youtube", "mock"] as const) {
      expect(refreshDecision(p, row(null), NOW)).toBe("use");
    }
  });

  it("refreshes TikTok, YouTube and mock tokens in their last 5 minutes, expired ones included", () => {
    for (const p of ["tiktok", "youtube", "mock"] as const) {
      expect(refreshDecision(p, row(5 * MINUTE_MS), NOW)).toBe("use");
      expect(refreshDecision(p, row(5 * MINUTE_MS - 1), NOW)).toBe("refresh");
      expect(refreshDecision(p, row(0), NOW)).toBe("refresh");
      expect(refreshDecision(p, row(-DAY_MS), NOW)).toBe("refresh");
    }
  });

  it("refreshes Instagram in its last 30 days once its token is a day old", () => {
    const ig = (expiresIn: number, refreshedAgo: number | null) =>
      refreshDecision("instagram", row(expiresIn, refreshedAgo), NOW);
    expect(ig(30 * DAY_MS, DAY_MS)).toBe("use");
    expect(ig(30 * DAY_MS - 1, DAY_MS)).toBe("refresh");
    expect(ig(30 * DAY_MS - 1, DAY_MS - 1)).toBe("use");
    expect(ig(HOUR_MS, 2 * DAY_MS)).toBe("refresh");
    expect(ig(HOUR_MS, null)).toBe("refresh");
  });

  it("sends an expired Instagram token to reconnect", () => {
    expect(refreshDecision("instagram", row(0), NOW)).toBe("reconnect");
    expect(refreshDecision("instagram", row(-DAY_MS, 2 * DAY_MS), NOW)).toBe(
      "reconnect",
    );
    expect(refreshDecision("instagram", row(1, 2 * DAY_MS), NOW)).toBe(
      "refresh",
    );
  });
});
