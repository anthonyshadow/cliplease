import { describe, expect, it } from "vitest";
import { countingStream } from "../../tests/helpers/streams";
import { readCapped } from "./read-capped";

/** Chunks of `sizes` bytes, the nth filled with n, pulled one read at a time. */
const chunkedStream = (sizes: number[]) =>
  countingStream(sizes.map((size, i) => new Uint8Array(size).fill(i + 1)));

describe("readCapped", () => {
  it("hands on every chunk in order and answers the total, exactly the cap included", async () => {
    const { stream, cancelled } = chunkedStream([3, 4, 5]);
    const seen: number[][] = [];
    const total = await readCapped(stream, 12, (chunk) => {
      seen.push([...chunk]);
    });
    expect(total).toBe(12);
    expect(seen).toEqual([
      [1, 1, 1],
      [2, 2, 2, 2],
      [3, 3, 3, 3, 3],
    ]);
    expect(cancelled()).toBe(false);
  });

  it("answers 0 for an empty stream and hands on nothing", async () => {
    const { stream } = chunkedStream([]);
    const seen: Uint8Array[] = [];
    const total = await readCapped(stream, 12, (chunk) => {
      seen.push(chunk);
    });
    expect(total).toBe(0);
    expect(seen).toEqual([]);
  });

  it("answers null one byte over, cancels the stream and never hands on the chunk that went over", async () => {
    const { stream, pulled, cancelled } = chunkedStream([3, 4, 6, 5, 5]);
    const seen: number[] = [];
    const total = await readCapped(stream, 12, (chunk) => {
      seen.push(chunk.length);
    });
    expect(total).toBeNull();
    expect(seen).toEqual([3, 4]);
    expect(pulled()).toBe(3);
    expect(cancelled()).toBe(true);
  });

  it("waits for each onChunk before reading the next chunk", async () => {
    const { stream, pulled } = chunkedStream([1, 1, 1]);
    const pulledOnceWritten: number[] = [];
    await readCapped(stream, 12, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      pulledOnceWritten.push(pulled());
    });
    // Chunk n + 1 is pulled only after onChunk n has finished: nothing is read ahead while a chunk is written.
    expect(pulledOnceWritten).toEqual([1, 2, 3]);
  });

  it("leaves a read error and an onChunk error to the caller, the stream cancelled after an onChunk error", async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("cut off"));
      },
    });
    await expect(readCapped(failing, 12, () => {})).rejects.toThrow("cut off");

    const { stream, cancelled } = chunkedStream([1, 1]);
    await expect(
      readCapped(stream, 12, () => {
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    expect(cancelled()).toBe(true);
  });
});
