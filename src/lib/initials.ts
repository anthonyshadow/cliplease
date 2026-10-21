// The Avatar's fallback initials. Client-safe and pure.
import { graphemes } from "./text/graphemes";

/**
 * The first and last words' first characters, upper-cased: "Maya Ruiz" → "MR", "Maya" → "M". Where graphemes falls
 * back to code points, a name that starts with a flag or a joined emoji differs from the server's initial: a
 * recoverable hydration mismatch.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters
    .map((part) => (graphemes(part)[0] ?? "").toUpperCase())
    .join("");
}
