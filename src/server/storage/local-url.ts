import "server-only";
import { bytesEqual, hmacSha256 } from "../crypto/hmac";

// The local driver's "presigned" URLs (07 D80, 02 §6.2): /api/dev/storage/<key>?…&exp=<unix s>&sig=<hex>, where sig is
// HMAC-SHA256 under deriveSubkey("local-storage-url") over the method, the key and every query value that matters, one per
// line. A part URL never signs a checksum or type (R2's UploadPart, 07 D80); a single PUT signs its exact type and size
// (owner answer Q-36), the way P23's R2 URL signs Content-Type and Content-Length; a GET signs its Content-Disposition.

export type SignedRequest =
  | { method: "PUT"; key: string; exp: number; ct: string; len: number }
  | {
      method: "PUT";
      key: string;
      exp: number;
      uploadId: string;
      partNumber: number;
    }
  | { method: "GET"; key: string; exp: number; cd: string };

function lines(r: SignedRequest): string {
  if ("uploadId" in r) {
    return [r.method, r.key, r.uploadId, r.partNumber, r.exp].join("\n");
  }
  if ("cd" in r) return [r.method, r.key, r.exp, r.cd].join("\n");
  return [r.method, r.key, r.exp, r.ct, r.len].join("\n");
}

/** The request's signature (hex). */
export function signLocalRequest(subkey: Buffer, r: SignedRequest): string {
  return hmacSha256(subkey, lines(r)).toString("hex");
}

/** A signature's form: 64 hex characters. */
export const LOCAL_SIGNATURE = /^[0-9a-f]{64}$/;

/** True when `sig` signs `r` and `r` hasn't expired at `nowS`; constant time, a different length is a mismatch. */
export function verifyLocalRequest(
  subkey: Buffer,
  r: SignedRequest,
  sig: string,
  nowS: number,
): boolean {
  if (r.exp < nowS || !LOCAL_SIGNATURE.test(sig)) return false;
  return bytesEqual(Buffer.from(sig, "hex"), hmacSha256(subkey, lines(r)));
}

/** The URL for `r` under `origin`: the key's segments encoded one by one, the signed values as query params. */
export function localRequestUrl(
  origin: string,
  subkey: Buffer,
  r: SignedRequest,
): string {
  const query = new URLSearchParams();
  if ("uploadId" in r) {
    query.set("uploadId", r.uploadId);
    query.set("partNumber", String(r.partNumber));
  } else if ("cd" in r) {
    query.set("cd", r.cd);
  } else {
    query.set("ct", r.ct);
    query.set("len", String(r.len));
  }
  query.set("exp", String(r.exp));
  query.set("sig", signLocalRequest(subkey, r));
  const path = r.key.split("/").map(encodeURIComponent).join("/");
  return `${origin}/api/dev/storage/${path}?${query}`;
}
