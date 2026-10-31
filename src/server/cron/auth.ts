import "server-only";
import { bytesEqual } from "../crypto/hmac";
import { env } from "../env";

// The cron routes' bearer (02 §5.11, §9.7; 07 D57): Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`, and the
// local curl and the e2e specs send the same header. Neither the header nor the secret is ever logged.

/**
 * True only for exactly `Bearer <CRON_SECRET>`, compared in constant time on the UTF-8 bytes (another length is a
 * mismatch, never an error). An empty or absent secret or header is false, so an unset secret never opens the route.
 */
export function isCronAuthorized(authorization: string | null): boolean {
  const secret = env.CRON_SECRET;
  if (!secret || !authorization) return false;
  return bytesEqual(
    Buffer.from(authorization),
    Buffer.from(`Bearer ${secret}`),
  );
}
