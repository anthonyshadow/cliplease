import "server-only";

/**
 * Reads `body` to its end, at most `maxBytes` in all, handing each chunk to `onChunk` (a promise it returns is awaited
 * before the next read): the total read, or null as soon as it goes over, with the stream cancelled and the chunk that
 * went over never handed on. A read or `onChunk` error is thrown to the caller, the stream cancelled first.
 */
export async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  onChunk: (chunk: Uint8Array) => Promise<unknown> | undefined,
): Promise<number | null> {
  const reader = body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return bytes;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      const pending = onChunk(value);
      if (pending) await pending;
    }
  } catch (error) {
    // An errored stream can't be cancelled: the error it already has is the one that matters.
    await reader.cancel().catch(() => {});
    throw error;
  }
}
