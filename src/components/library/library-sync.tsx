"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { type AccountSyncOutcome, syncAllSummary } from "./library-messages";

type LibrarySync = {
  /** A sync started from this page is running: SyncStatus reads "Syncing…" (05 §6.1 States). */
  pending: boolean;
  /** The last Sync all's summary ("Demo 3 new · YouTube up to date"), until another sync or filter replaces it. */
  summary: string | null;
  start: () => void;
  settle: (outcomes: AccountSyncOutcome[] | null, all: boolean) => void;
};

const LibrarySyncContext = createContext<LibrarySync | null>(null);

/** The Library's syncs as one state: every SyncButton under it reports here, and the header's SyncStatus reads it. */
export function LibrarySyncProvider({
  labels,
  filterKey,
  children,
}: {
  /** How the summary names each account (accountLabels). */
  labels: Readonly<Record<string, string>>;
  /** The filter's URL: a new filter drops the summary. */
  filterKey: string;
  children: ReactNode;
}) {
  const [running, setRunning] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryFor, setSummaryFor] = useState(filterKey);
  if (summaryFor !== filterKey) {
    setSummaryFor(filterKey);
    setSummary(null);
  }
  const value: LibrarySync = {
    pending: running > 0,
    summary,
    start: () => {
      setRunning((n) => n + 1);
      setSummary(null);
    },
    settle: (outcomes, all) => {
      setRunning((n) => n - 1);
      setSummary(all && outcomes ? syncAllSummary(outcomes, labels) : null);
    },
  };
  return (
    <LibrarySyncContext.Provider value={value}>
      {children}
    </LibrarySyncContext.Provider>
  );
}

/** The Library's sync state, or null outside the Library (the Connections cards). */
export const useLibrarySync = () => useContext(LibrarySyncContext);
