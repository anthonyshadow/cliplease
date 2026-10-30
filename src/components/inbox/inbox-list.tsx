"use client";

import { type ReactNode, useState } from "react";
import { useAutoRefresh } from "@/components/layout/auto-refresh";
import type { RowOutcome } from "@/lib/licensing/inbox";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { InboxRow, type RowActionEvents } from "./inbox-row";
import { dropDecided, mergeSettledRows, type SettledRow } from "./settled-rows";

/** The Inbox title's id: the focus goes there when a held row leaves with the focus inside it (WCAG 2.4.3). */
export const INBOX_TITLE_ID = "inbox-title";

/** A row the list holds in place: while its action runs (outcome null), then with its result until the next refresh. */
type HeldRow = SettledRow<CreatorRequest> & { outcome: RowOutcome | null };

/**
 * The Inbox's list card, or `empty` when it has no rows (05 §6.3). The page keys it by view. It owns the Inbox's one
 * refresher (window focus and every 30 s, 07 D160). A row the creator acts on is held at its index from the tap: the
 * action's refresh() already updates the counts, while the row keeps its place and shows its outcome until the next
 * refresh, which lets decided rows go (they then live in History); a settled row restarts the 30 s (02 §4.4 rule 2).
 */
export function InboxList({
  rows,
  empty,
}: {
  rows: readonly CreatorRequest[];
  empty: ReactNode;
}) {
  const [held, setHeld] = useState<ReadonlyMap<string, HeldRow>>(new Map());
  const { restart } = useAutoRefresh({
    onRefresh: () => setHeld(dropDecided),
  });
  const shown = mergeSettledRows(rows, held);

  const events: RowActionEvents = {
    onStart: (request) =>
      setHeld((now) =>
        new Map(now).set(request.id, {
          row: request,
          index: shown.findIndex((r) => r.id === request.id),
          outcome: null,
        }),
      ),
    onDone: (request, outcome) => {
      setHeld((now) => {
        const next = new Map(now);
        const entry = next.get(request.id);
        if (entry && outcome?.settles)
          next.set(request.id, { ...entry, outcome });
        else next.delete(request.id);
        return next;
      });
      if (outcome?.settles) restart();
    },
  };

  if (shown.length === 0) return empty;
  return (
    <ul className="flex flex-col rounded-lg bg-surface">
      {shown.map((request) => (
        <InboxRow
          key={request.id}
          request={request}
          outcome={held.get(request.id)?.outcome ?? null}
          events={events}
          focusTargetId={INBOX_TITLE_ID}
        />
      ))}
    </ul>
  );
}
