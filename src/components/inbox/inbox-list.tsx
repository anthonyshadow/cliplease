"use client";

import type { ReactNode } from "react";
import { useAutoRefresh } from "@/components/layout/auto-refresh";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { InboxRow } from "./inbox-row";

/**
 * The Inbox's list card, or `empty` when it has no rows (05 §6.3). The page keys it by view. It owns the Inbox's one
 * refresher (window focus and every 30 s, 07 D160), so P18 can keep a row the creator just acted on in place until that
 * refresh (02 §4.4 rule 2).
 */
export function InboxList({
  rows,
  empty,
}: {
  rows: readonly CreatorRequest[];
  empty: ReactNode;
}) {
  useAutoRefresh();
  if (rows.length === 0) return empty;
  return (
    <ul className="flex flex-col rounded-lg bg-surface">
      {rows.map((request) => (
        <InboxRow key={request.id} request={request} />
      ))}
    </ul>
  );
}
