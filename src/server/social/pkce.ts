import "server-only";
import { createHash, randomBytes } from "node:crypto";

// PKCE, S256 only (RFC 7636; 02 §9.3).

/** base64url(sha256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** A 43-character verifier (32 random bytes, base64url) and its S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}
