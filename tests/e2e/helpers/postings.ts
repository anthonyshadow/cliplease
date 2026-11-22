import { withTestDb } from "./test-db";

// Where posted's states a spec can't wait its way to without a sleep (P21): only the test database, never the app's.

/**
 * Moves video `videoId`'s source posting's last check a minute back on the database's clock, past Check again's 30 s
 * cooldown (the server's POSTING_CHECK_COOLDOWN_MS, owner answer Q-84 a), so the next Check again asks the platform
 * instead of keeping the last result. Throws unless exactly that one posting moved.
 */
export async function ageCheckedAt(videoId: string): Promise<void> {
  const { rowCount } = await withTestDb((client) =>
    client.query(
      `update video_posting set checked_at = now() - interval '1 minute'
        where video_id = $1 and is_source`,
      [videoId],
    ),
  );
  if (rowCount !== 1) {
    throw new Error(`ageCheckedAt: no source posting for ${videoId}`);
  }
}
