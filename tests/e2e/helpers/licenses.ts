import { withTestDb } from "./test-db";

// Licenses a spec forces into a state no check let through (P19g; 07 D111): only the test database, never the app's.

/**
 * Makes request `requestId`'s issued license exclusive, as a running exclusive license the availability checks missed:
 * the state Approve's re-check under the video lock exists to catch.
 */
export async function forceLicenseExclusive(requestId: string): Promise<void> {
  const { rowCount } = await withTestDb((client) =>
    client.query(
      "update license set exclusive = true where license_request_id = $1",
      [requestId],
    ),
  );
  if (rowCount !== 1) {
    throw new Error(`forceLicenseExclusive: no license for ${requestId}`);
  }
}
