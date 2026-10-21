import "server-only";

// Shared pieces of the API routes' responses.

/** Never cached: per-user answers and signed-URL results. */
export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Not found, or not yours: an empty 404 that says nothing more (image and poster routes). */
export const notFoundNoStore = () =>
  new Response(null, { status: 404, headers: NO_STORE });

/** No creator session (02 §5.1): the API's 401 body, never cached. */
export const unauthorizedJson = () =>
  Response.json(
    { error: { code: "unauthorized" } },
    { status: 401, headers: NO_STORE },
  );

/**
 * A request's JSON body, read up to `maxBytes`: refused unread when its Content-Length says more, and as soon as the
 * bytes read go over (a chunked body has no length). Not UTF-8 JSON, or no body, is refused too.
 */
export async function readJsonCapped(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    return { ok: false };
  }
  if (!request.body) return { ok: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
