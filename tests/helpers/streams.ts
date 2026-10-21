// A web stream for the tests of readers that stop early (readCapped and the code built on it): shared by the
// read-capped, http and local storage tests.

/** A stream of `chunks`, one pulled per read; `pulled` counts the chunks handed over, `cancelled` reports a cancel. */
export function countingStream(chunks: readonly Uint8Array[]) {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[pulled];
        if (chunk === undefined) {
          controller.close();
          return;
        }
        pulled += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    },
    // Nothing is pulled before a read asks for it.
    { highWaterMark: 0 },
  );
  return { stream, pulled: () => pulled, cancelled: () => cancelled };
}
