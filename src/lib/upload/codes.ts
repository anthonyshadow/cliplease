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

/** Every way an upload can end without success: the routes' codes plus the browser's own. */
export type UploadErrorCode =
  | UploadRouteCode
  | "network"
  | "canceled"
  | "unauthorized";

/** The codes that mean the server couldn't read the file as the video it was declared to be (01 J5.7). */
export const isBadFileCode = (code: string | null): boolean =>
  code === "size_mismatch" || code === "bad_signature_bytes";
