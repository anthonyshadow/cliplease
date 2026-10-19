import { describe, expect, it } from "vitest";
import { DAY_MS, MINUTE_MS } from "../../lib/time";
import { deriveConnectionState } from "./connection-state";

const NOW = new Date("2026-10-18T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const healthy: Parameters<typeof deriveConnectionState>[0] = {
  status: "connected",
  lastSyncError: null,
  lastSyncErrorAt: null,
  lastSyncedAt: at(-MINUTE_MS),
  syncStartedAt: null,
  syncBlockedUntil: null,
};
const state = (overrides: Partial<typeof healthy>) =>
  deriveConnectionState({ ...healthy, ...overrides }, NOW);

describe("deriveConnectionState (07 D02, 05 §1.5)", () => {
  it("is all clear for a healthy account", () => {
    expect(state({})).toEqual({
      syncProblem: false,
      syncing: false,
      blockedMinutes: null,
      stale: false,
    });
  });

  it("calls an upstream error newer than the last sync a sync problem, only while connected", () => {
    const upstream = { lastSyncError: "upstream", lastSyncErrorAt: at(-1000) };
    expect(state(upstream).syncProblem).toBe(true);
    expect(state({ ...upstream, lastSyncedAt: null }).syncProblem).toBe(true);
    // An error older than (or as old as) the last good sync is over.
    expect(
      state({ ...upstream, lastSyncErrorAt: at(-2 * MINUTE_MS) }).syncProblem,
    ).toBe(false);
    expect(
      state({ ...upstream, lastSyncErrorAt: at(-MINUTE_MS) }).syncProblem,
    ).toBe(false);
    expect(state({ ...upstream, status: "needs_reconnect" }).syncProblem).toBe(
      false,
    );
    expect(state({ lastSyncError: "upstream" }).syncProblem).toBe(false);
  });

  it("never calls a rate limit a sync problem", () => {
    expect(
      state({ lastSyncError: "rate_limited", lastSyncErrorAt: at(-1000) })
        .syncProblem,
    ).toBe(false);
  });

  it("is syncing while the 2-minute lease is held", () => {
    expect(state({ syncStartedAt: at(-1000) }).syncing).toBe(true);
    expect(state({ syncStartedAt: at(-2 * MINUTE_MS + 1) }).syncing).toBe(true);
    expect(state({ syncStartedAt: at(-2 * MINUTE_MS) }).syncing).toBe(false);
  });

  it("rounds the minutes left of a block up, and is null once it has passed", () => {
    expect(state({ syncBlockedUntil: at(15 * MINUTE_MS) }).blockedMinutes).toBe(
      15,
    );
    expect(
      state({ syncBlockedUntil: at(14 * MINUTE_MS + 1) }).blockedMinutes,
    ).toBe(15);
    expect(state({ syncBlockedUntil: at(1) }).blockedMinutes).toBe(1);
    expect(state({ syncBlockedUntil: at(0) }).blockedMinutes).toBeNull();
    expect(state({ syncBlockedUntil: at(-1) }).blockedMinutes).toBeNull();
  });

  it("is stale once the last sync is more than 24 h old, never before the first", () => {
    expect(state({ lastSyncedAt: at(-DAY_MS) }).stale).toBe(false);
    expect(state({ lastSyncedAt: at(-DAY_MS - 1) }).stale).toBe(true);
    expect(state({ lastSyncedAt: null }).stale).toBe(false);
  });
});
