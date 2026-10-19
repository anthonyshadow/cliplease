import type { ReactNode } from "react";

/**
 * 04 §9.15: the sync line, read out politely when a sync changes it (`live`; off inside a region that is already live).
 * The text comes formatted from the server.
 */
export function SyncStatus({
  id,
  live = true,
  children,
}: {
  id?: string;
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <p
      id={id}
      aria-live={live ? "polite" : undefined}
      className="text-footnote text-ink-2 tabular-nums"
    >
      {children}
    </p>
  );
}
