// The upload routes' error codes (02 §6.2, P10a), client-safe: the server answers them (src/server/storage/upload-http.ts
// maps each to its status) and the browser client reads them back, so the two lists can't drift.

export const UPLOAD_ROUTE_CODES = [
  "invalid",
  "too_large",
  "bad_type",
  "too_many",
  "bad_part",
  "not_found",
  "original_locked",
  "not_same_file",
  "upload_expired",
  "size_mismatch",
  "parts_incomplete",
  "bad_signature_bytes",
  "internal",
] as const;
export type UploadRouteCode = (typeof UPLOAD_ROUTE_CODES)[number];

/**
 * Every way an upload can end without success: the routes' codes plus the browser's own. `paused`: a part ran out of
 * retries (the upload and its resume hint stay; P10c). `stale_upload`: a resume found another upload open on the video
 * than the one this device started, so nothing was sent; or the upload stopped being open while its parts went (a 404),
 * so complete never ran.
 */
export type UploadErrorCode =
  | UploadRouteCode
  | "network"
  | "canceled"
  | "unauthorized"
  | "paused"
  | "stale_upload";

/** The codes that mean the server couldn't read the file as the video it was declared to be (01 J5.7). */
export const isBadFileCode = (code: string | null): boolean =>
  code === "size_mismatch" || code === "bad_signature_bytes";
