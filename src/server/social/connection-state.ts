import "server-only";
import type { SocialAccount } from "../../db/schema/types";
import { DAY_MS, MINUTE_MS } from "../../lib/time";

// An account's derived states for the cards (07 D02, 05 §1.5, 04 §9.15). Pure: `now` is passed in (the database's
// clock, so "Try again in 15 min." matches the block the database set). Relative imports: the P09 seed may load it.

/** The 2-minute single-flight lease (03 §7.2): a sync that started within it is still running. sync.ts takes it. */
export const SYNC_LEASE_MS = 2 * MINUTE_MS;

export type ConnectionState = {
  /** 07 D02 / 05 §1.5 exactly: connected, an error that isn't a rate limit, newer than the last good sync. */
  syncProblem: boolean;
  syncing: boolean;
  /** Minutes until the platform lets us sync again, rounded up; null when not blocked. */
  blockedMinutes: number | null;
  /** The last good sync is more than 24 h old (07 D13). */
  stale: boolean;
};

export function deriveConnectionState(
  row: Pick<
    SocialAccount,
    | "status"
    | "lastSyncError"
    | "lastSyncErrorAt"
    | "lastSyncedAt"
    | "syncStartedAt"
    | "syncBlockedUntil"
  >,
  now: Date,
): ConnectionState {
  const at = now.getTime();
  const errorAt = row.lastSyncErrorAt?.getTime();
  const blockedMs = (row.syncBlockedUntil?.getTime() ?? 0) - at;
  return {
    syncProblem:
      row.status === "connected" &&
      row.lastSyncError !== null &&
      row.lastSyncError !== "rate_limited" &&
      errorAt !== undefined &&
      errorAt > (row.lastSyncedAt?.getTime() ?? Number.NEGATIVE_INFINITY),
    syncing:
      row.syncStartedAt !== null &&
      row.syncStartedAt.getTime() > at - SYNC_LEASE_MS,
    blockedMinutes: blockedMs > 0 ? Math.ceil(blockedMs / MINUTE_MS) : null,
    stale:
      row.lastSyncedAt !== null && row.lastSyncedAt.getTime() < at - DAY_MS,
  };
}
