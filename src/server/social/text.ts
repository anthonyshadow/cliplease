import "server-only";

// Platform strings on their way to text columns (03 DB1): Postgres refuses U+0000, and one such byte would fail the
// whole write on every sync. Text loses it; an id, a key or a URL with one is broken, so the caller drops it instead.
// Relative imports only: the P09 seed loads link.ts and sync.ts under tsx.

const NUL = "\u0000";

/** `s` without any NUL. */
export const withoutNul = (s: string | null): string | null =>
  s === null ? null : s.replaceAll(NUL, "");

/** Whether `s` holds a NUL. */
export const hasNul = (s: string | null): boolean => s?.includes(NUL) ?? false;

/** A URL, or null when it holds a NUL. */
export const urlWithoutNul = (s: string | null): string | null =>
  hasNul(s) ? null : s;
