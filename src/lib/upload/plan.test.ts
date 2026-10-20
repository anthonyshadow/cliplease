import { describe, expect, it } from "vitest";
import { expectedPartSize, ORIGINAL_MAX_BYTES, PART_BYTES } from "./limits";
import { type PlannedPart, planParts } from "./plan";

const MIB = 1024 ** 2;

/** Parts numbered 1..n, end-exclusive, each starting where the last ended, covering [0, size). */
function expectCovers(parts: PlannedPart[], size: number, partSize: number) {
  let next = 0;
  parts.forEach((part, i) => {
    expect(part.partNumber).toBe(i + 1);
    expect(part.start).toBe(next);
    expect(part.end - part.start).toBe(
      expectedPartSize(part.partNumber, { size, partSize }),
    );
    next = part.end;
  });
  expect(next).toBe(size);
}

describe("planParts (07 D80)", () => {
  it("gives an exact multiple full parts only", () => {
    expect(planParts(32 * MIB, 16 * MIB)).toEqual([
      { partNumber: 1, start: 0, end: 16 * MIB },
      { partNumber: 2, start: 16 * MIB, end: 32 * MIB },
    ]);
  });

  it("puts the remainder in a short last part", () => {
    expect(planParts(10, 4)).toEqual([
      { partNumber: 1, start: 0, end: 4 },
      { partNumber: 2, start: 4, end: 8 },
      { partNumber: 3, start: 8, end: 10 },
    ]);
  });

  it("gives 1 byte one part", () => {
    expect(planParts(1, PART_BYTES)).toEqual([
      { partNumber: 1, start: 0, end: 1 },
    ]);
  });

  it("splits exactly 2 GiB into 128 full parts", () => {
    const parts = planParts(ORIGINAL_MAX_BYTES, PART_BYTES);
    expect(parts).toHaveLength(128);
    expect(parts.every((p) => p.end - p.start === PART_BYTES)).toBe(true);
    expectCovers(parts, ORIGINAL_MAX_BYTES, PART_BYTES);
  });

  it("gives 2 GiB + 1 a 129th part of 1 byte", () => {
    const parts = planParts(ORIGINAL_MAX_BYTES + 1, PART_BYTES);
    expect(parts).toHaveLength(129);
    expect(parts.at(-1)).toEqual({
      partNumber: 129,
      start: ORIGINAL_MAX_BYTES,
      end: ORIGINAL_MAX_BYTES + 1,
    });
    expectCovers(parts, ORIGINAL_MAX_BYTES + 1, PART_BYTES);
  });

  it.each([
    [1, 4],
    [3, 4],
    [4, 4],
    [5, 4],
    [17, 4],
    [PART_BYTES - 1, PART_BYTES],
    [PART_BYTES + 1, PART_BYTES],
    [840 * MIB + 12_345, PART_BYTES],
  ])("covers %i bytes at %i with contiguous ranges", (size, partSize) => {
    expectCovers(planParts(size, partSize), size, partSize);
  });
});
