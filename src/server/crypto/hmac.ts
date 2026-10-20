import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Signed values (P10a's local storage URLs and poster upload tokens): one HMAC and one constant-time compare.

/** HMAC-SHA256 of `data` under `key`. */
export const hmacSha256 = (key: Buffer, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

/** Constant time; a different length is a mismatch, never an error. */
export const bytesEqual = (a: Buffer, b: Buffer): boolean =>
  a.length === b.length && timingSafeEqual(a, b);
