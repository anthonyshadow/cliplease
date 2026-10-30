// The Inbox's settled rows (02 §4.4 rule 2; 05 §6.3 interaction notes): a row the creator just decided keeps its place,
// as it was before the tap, until the next refresh, even though the action's refresh() already dropped it from Waiting.
// A row whose action is still running is held the same way, so a refresh during "Approving…" changes nothing. Pure.

/** A held row: its props from before the tap and where it stood in the list. */
export type SettledRow<R> = { row: R; index: number };

/**
 * The rows to show: the server's, with each settled row at its stored index (in index order, clamped to the end) in
 * place of any server row with the same id. The other rows keep the server order.
 */
export function mergeSettledRows<R extends { id: string }>(
  serverRows: readonly R[],
  settled: ReadonlyMap<string, SettledRow<R>>,
): readonly R[] {
  if (settled.size === 0) return serverRows;
  const merged = serverRows.filter((row) => !settled.has(row.id));
  const byIndex = [...settled.values()].sort((a, b) => a.index - b.index);
  for (const { row, index } of byIndex) {
    merged.splice(Math.min(index, merged.length), 0, row);
  }
  return merged;
}

/**
 * The held rows a refresh lets go: the decided ones (`outcome` set); a row whose action runs (null) stays. The same map
 * when none is decided, so the refresh's own state update is skipped.
 */
export function dropDecided<E extends { outcome: unknown }>(
  settled: ReadonlyMap<string, E>,
): ReadonlyMap<string, E> {
  const kept = [...settled].filter(([, entry]) => entry.outcome === null);
  return kept.length === settled.size ? settled : new Map(kept);
}
