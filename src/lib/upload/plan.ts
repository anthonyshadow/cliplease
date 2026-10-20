// The browser's part plan for a multipart original (07 D80). Pure.
import { partCount } from "./limits";

export type PlannedPart = {
  /** 1-based. */
  partNumber: number;
  /** Byte offsets for `file.slice(start, end)`: `end` is exclusive. */
  start: number;
  end: number;
};

/** `ceil(size / partSize)` parts, every one `partSize` bytes but the last, which holds the remainder. */
export function planParts(size: number, partSize: number): PlannedPart[] {
  return Array.from({ length: partCount(size, partSize) }, (_, i) => ({
    partNumber: i + 1,
    start: i * partSize,
    end: Math.min(size, (i + 1) * partSize),
  }));
}
