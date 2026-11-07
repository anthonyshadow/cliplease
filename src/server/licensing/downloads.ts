import "server-only";
import { db } from "@/db/client";
import { downloadEvent } from "@/db/schema";
import type { DownloadKind } from "@/lib/domain/values";
import { downloadFailedPath } from "@/lib/licensing/license-record";
import { env } from "../env";
import { errorName, logEvent } from "../log";
import { clientIp, clientUserAgent } from "../request-context";
import { isBuyerToken } from "../tokens/buyer-token";

// The buyer's two downloads, GET /api/licenses/[token]/original and /pdf (02 §4.2, §9.5; 07 D16, D17; owner answer
// Q-185): one download_event per answered tap, and the answers both routes share. The routes are plain links, so a
// failure can only be shown by sending the buyer back to /l; HEAD (a scanner, `curl -I`) never runs GET's work.

/** Every download answer's headers: never cached, and no referrer leaves a URL that carries the key (07 D61). */
export const DOWNLOAD_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

/**
 * Logs a download (07 D47: the raw client address as inet takes it, the user agent cut to its CHECK). The values come
 * from the route's own Request, so a handler called with `new Request()` logs them too; never requestContext(), which
 * reads next/headers (supersedes PROGRESS P16a's "take requestContext()"). Call it once the file is ready (the signed
 * URL minted, the PDF rendered) and before answering, so a failed attempt writes no row.
 */
export async function recordDownload(
  request: Request,
  licenseId: string,
  kind: DownloadKind,
): Promise<void> {
  await db.insert(downloadEvent).values({
    licenseId,
    kind,
    ip: clientIp(request.headers.get("x-forwarded-for")),
    userAgent: clientUserAgent(request.headers.get("user-agent")),
  });
}

/** A wrong or dead key, a revoked license, an expired one's original: the same empty 404, with no row (Q-185). */
export const downloadNotFound = () =>
  new Response(null, { status: 404, headers: DOWNLOAD_HEADERS });

/** HEAD answers 405 and writes nothing: Next would otherwise run GET for it (Q-185). */
export const headNotAllowed = () =>
  new Response(null, {
    status: 405,
    headers: { ...DOWNLOAD_HEADERS, Allow: "GET" },
  });

/** The 303 back to `/l/{token}?download=failed` (Q-185); a token that can't be a key gets the 404 instead. */
export function downloadFailed(token: string): Response {
  if (!isBuyerToken(token)) return downloadNotFound();
  const location = new URL(downloadFailedPath(token), env.APP_URL);
  return new Response(null, {
    status: 303,
    headers: { ...DOWNLOAD_HEADERS, Location: location.href },
  });
}

/**
 * A download route's answer: `respond`'s, or, when it throws for an unexpected reason (a storage, database or render
 * error), the 303 back to /l (Q-185), logged with the kind and the error's name only (never the key or a signed URL).
 */
export async function downloadResponse(
  token: string,
  kind: DownloadKind,
  respond: () => Promise<Response>,
): Promise<Response> {
  try {
    return await respond();
  } catch (error) {
    logEvent("error", "license.download_failed", {
      kind,
      error: errorName(error),
    });
    return downloadFailed(token);
  }
}
