// Pure countdown logic for CountdownChip (04 §9.10, 01 J8.1). No clock reads here: `nowMs` is passed in.
import { formatCountdown } from "./format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type CountdownTone = "neutral" | "awaiting";

export type CountdownState = {
  /** "Expires in 2 d 23 h" · "Expires in 5 h 12 min" · "Expires in 0 min". */
  label: string;
  /** Neutral above 6 h, awaiting at 6 h or less. Never red. */
  tone: CountdownTone;
  /** When to re-render: every 60 s, every 10 s under 1 h, never once it reads 0. */
  nextTickMs: number | null;
};

export function countdownState(
  expiresAtMs: number,
  nowMs: number,
): CountdownState {
  const remaining = Math.max(0, expiresAtMs - nowMs);
  return {
    label: formatCountdown(remaining),
    tone: remaining > 6 * HOUR ? "neutral" : "awaiting",
    nextTickMs: remaining === 0 ? null : remaining < HOUR ? 10_000 : MINUTE,
  };
}
