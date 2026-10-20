import "server-only";
import { storage } from "./index";
import { expectedPartSize, partCount } from "./limits";

// What `complete` checks before a file counts (02 §9.10, research/infra.md §1 "Verification on complete"): the stored size
// against the declared one and the first bytes against the type. R2's presigned PUT can't cap a size; this check does.

// An MP4/MOV starts with a box: bytes 4..7 name it.
const VIDEO_BOXES = new Set(["ftyp", "moov", "mdat", "wide", "free", "skip"]);

/** Bytes 4..7 name an MP4/MOV box (`ftyp`, `moov`, `mdat`, `wide`, `free`, `skip`); fewer than 12 bytes is no video. */
export function hasVideoSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return VIDEO_BOXES.has(String.fromCharCode(...bytes.subarray(4, 8)));
}

/** A JPEG starts FF D8 FF. */
export function hasJpegSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

/**
 * The stored parts make the declared file (07 D80, R2's rules): parts 1…n with n = ceil(size / partSize), every part but
 * the last exactly `partSize`, the last the remainder (so the sum is `size`). `parts` comes sorted from listParts.
 */
export function checkPartList(
  parts: readonly { partNumber: number; size: number }[],
  file: { size: number; partSize: number },
): "ok" | "parts_incomplete" {
  if (parts.length !== partCount(file.size, file.partSize)) {
    return "parts_incomplete";
  }
  const complete = parts.every(
    (part, i) =>
      part.partNumber === i + 1 &&
      part.size === expectedPartSize(part.partNumber, file),
  );
  return complete ? "ok" : "parts_incomplete";
}

type ObjectCheck = "ok" | "size_mismatch" | "bad_signature_bytes" | "not_found";

/** HEAD: the size equals the declared one and is within `maxBytes`; then the first 12 bytes match the kind. */
export async function verifyUploadedObject(
  key: string,
  {
    kind,
    declaredSize,
    maxBytes,
  }: { kind: "original" | "poster"; declaredSize: number; maxBytes: number },
): Promise<ObjectCheck> {
  const head = await storage().head(key);
  if (!head) return "not_found";
  if (head.size !== declaredSize || head.size > maxBytes) {
    return "size_mismatch";
  }
  let first: Uint8Array;
  try {
    first = await storage().readRange(key, 0, 11);
  } catch (error) {
    // Deleted between HEAD and the read (a parallel complete or a new start): the same answer as a missing HEAD.
    if (!(await storage().head(key))) return "not_found";
    throw error;
  }
  const signed =
    kind === "original" ? hasVideoSignature(first) : hasJpegSignature(first);
  return signed ? "ok" : "bad_signature_bytes";
}
