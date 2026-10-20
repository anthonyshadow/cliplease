import "server-only";

// Shared pieces of the API routes' responses.

/** Never cached: per-user answers and signed-URL results. */
export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** No creator session (02 §5.1): the API's 401 body, never cached. */
export const unauthorizedJson = () =>
  Response.json(
    { error: { code: "unauthorized" } },
    { status: 401, headers: NO_STORE },
  );
