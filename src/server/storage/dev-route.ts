import "server-only";
import { type Env, isDevAppEnv } from "../env";
import { NO_STORE, notFoundNoStore } from "../http";
import { errorName, logEvent } from "../log";
import { localDriver } from "./index";
import { isStorageKey, isUploadId } from "./local";
import { LOCAL_SIGNATURE, type SignedRequest } from "./local-url";

// The local driver's signed URL route, PUT and GET /api/dev/storage/[...key] (02 §6.2, 07 D80). It answers only with
// STORAGE_DRIVER=local and APP_ENV development or test (07 D51), never by NODE_ENV: e2e runs `next build && next start`.
// Order: disabled → 404; a malformed, expired or wrongly signed URL → 403; then the disk (unknown → 404). It never logs
// a key, an upload id or a signature.

/** The dev storage route serves only the local driver in development and test. */
export function isDevStorageEnabled(
  e: Pick<Env, "APP_ENV" | "STORAGE_DRIVER">,
): boolean {
  return e.STORAGE_DRIVER === "local" && isDevAppEnv(e.APP_ENV);
}

const EXP = /^\d{1,12}$/;
// 1…10000, R2's range.
const PART_NUMBER = /^(?:[1-9]\d{0,3}|10000)$/;
const LENGTH = /^\d{1,12}$/;
// A header value: printable ASCII only (a Content-Type or Content-Disposition we signed ourselves).
const HEADER_VALUE = /^[\x20-\x7E]{1,1024}$/;

/** Each kind's own query params; another kind's params on a URL make it malformed. */
const KIND_PARAMS = {
  get: ["cd"],
  part: ["uploadId", "partNumber"],
  single: ["ct", "len"],
} as const;

/** The signed request a URL describes, or null when any part is malformed (a segment, a query value, a mix of kinds). */
export function parseDevStorageRequest(
  method: "PUT" | "GET",
  segments: readonly string[],
  query: URLSearchParams,
): { request: SignedRequest; sig: string } | null {
  // A segment holding "/" came from a %2F; our URLs encode every segment on its own, so it is never one of ours.
  if (segments.some((s) => s.includes("/"))) return null;
  const key = segments.join("/");
  const exp = query.get("exp") ?? "";
  const sig = query.get("sig") ?? "";
  if (!isStorageKey(key) || !EXP.test(exp) || !LOCAL_SIGNATURE.test(sig))
    return null;
  const base = { key, exp: Number(exp) };
  const kind =
    method === "GET"
      ? "get"
      : query.has("uploadId") || query.has("partNumber")
        ? "part"
        : "single";
  const foreign = Object.entries(KIND_PARAMS).flatMap(([k, names]) =>
    k === kind ? [] : names,
  );
  if (foreign.some((name) => query.has(name))) return null;
  if (method === "GET") {
    const cd = query.get("cd") ?? "";
    return HEADER_VALUE.test(cd)
      ? { request: { method, ...base, cd }, sig }
      : null;
  }
  const uploadId = query.get("uploadId");
  const partNumber = query.get("partNumber");
  if (uploadId !== null || partNumber !== null) {
    if (
      !uploadId ||
      !isUploadId(uploadId) ||
      !PART_NUMBER.test(partNumber ?? "")
    ) {
      return null;
    }
    const part = { uploadId, partNumber: Number(partNumber) };
    return { request: { method, ...base, ...part }, sig };
  }
  const ct = query.get("ct") ?? "";
  const len = query.get("len") ?? "";
  return HEADER_VALUE.test(ct) && LENGTH.test(len)
    ? { request: { method, ...base, ct, len: Number(len) }, sig }
    : null;
}

const status = (code: number) =>
  new Response(null, { status: code, headers: NO_STORE });

/** Handles one request to the route; `nowS` is the clock in seconds. */
export async function handleDevStorage(
  e: Pick<Env, "APP_ENV" | "STORAGE_DRIVER">,
  request: Request,
  segments: readonly string[],
  nowS = Math.floor(Date.now() / 1000),
): Promise<Response> {
  if (!isDevStorageEnabled(e)) return notFoundNoStore();
  const method = request.method === "GET" ? "GET" : "PUT";
  const parsed = parseDevStorageRequest(
    method,
    segments,
    new URL(request.url).searchParams,
  );
  if (
    !parsed ||
    !localDriver().verifyRequest(parsed.request, parsed.sig, nowS)
  ) {
    return status(403);
  }
  const r = parsed.request;
  try {
    if ("cd" in r) {
      const object = await localDriver().getStream(r.key);
      if (!object) return notFoundNoStore();
      return new Response(object.body, {
        headers: {
          ...NO_STORE,
          "Content-Type": object.contentType ?? "application/octet-stream",
          "Content-Length": String(object.size),
          "Content-Disposition": r.cd,
        },
      });
    }
    if (!request.body) return status(400);
    if ("uploadId" in r) {
      const part = await localDriver().receivePart(r, request.body);
      if (part === "no_such_upload") return notFoundNoStore();
      if (part === "too_large") return status(413);
      return new Response(null, {
        headers: { ...NO_STORE, ETag: part.etag },
      });
    }
    // Like R2, the signed type must be the one sent.
    if (request.headers.get("content-type") !== r.ct) return status(403);
    const written = await localDriver().receiveObject(
      r.key,
      request.body,
      r.len,
    );
    return status(
      { ok: 200, too_large: 413, short: 400, exists: 412 }[written],
    );
  } catch (error) {
    logEvent("error", "storage.dev_route_failed", { error: errorName(error) });
    return status(500);
  }
}
