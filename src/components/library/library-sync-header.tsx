"use client";

import { useLibrarySync } from "./library-sync";
import { SyncButton } from "./sync-button";
import { SyncStatus } from "./sync-status";

/**
 * The Library's sync line and Sync all (05 §6.1 annotation 4, 04 §9.15). SyncStatus is the page's sync line: while any
 * sync from this page runs it reads "Syncing…", after Sync all the summary ("Demo 3 new · YouTube up to date"),
 * otherwise what the server sent (a sync already running, the rate-limit sentence, or the sync line). Sync all is
 * disabled with "Try again in {n} min." when every connected account is rate-limited.
 */
export function LibrarySyncHeader({
  status,
  showSyncAll,
  blockedHelper,
}: {
  /** The server's line: "Syncing…", a rate-limit sentence, the sync line, or null. */
  status: string | null;
  /** False with no connected account, or in the expired state (its own Sync now is the action). */
  showSyncAll: boolean;
  blockedHelper: string | null;
}) {
  const library = useLibrarySync();
  const line = library?.pending ? "Syncing…" : (library?.summary ?? status);
  return (
    <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:justify-end md:gap-4">
      <SyncStatus>{line}</SyncStatus>
      {showSyncAll ? (
        <div className="flex flex-col items-start gap-1 md:items-end">
          <SyncButton all label="Sync all" blockedHelper={blockedHelper} />
        </div>
      ) : null}
    </div>
  );
}
