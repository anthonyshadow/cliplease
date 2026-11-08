import "server-only";
import { unstable_rethrow } from "next/navigation";
import { db } from "@/db/client";
import { downloadEvent } from "@/db/schema";
import { APP_NAME } from "@/lib/app-name";
import type { DownloadKind } from "@/lib/domain/values";
import { downloadFailedPath } from "@/lib/licensing/license-record";
import { originalExtension } from "@/lib/upload/limits";
import { myLicenseDownloadFailedPath } from "@/lib/urls";
import { isUuid } from "@/lib/validation/uuid";
import { env } from "../env";
import { errorName, logEvent } from "../log";
import { renderLicensePdf } from "../pdf/generate";
import { clientIp, clientUserAgent } from "../request-context";
import { contentDisposition } from "../storage/content-disposition";
import { presignDownload } from "../storage/uploads";
import { isBuyerToken } from "../tokens/buyer-token";
import type { BuyerLicense } from "./buyer-license";

// The buyer's downloads (02 §4.2, §9.5; 07 D16, D17; owner answer Q-185): GET /api/licenses/[token]/original and /pdf
// by the buyer link, /api/my/licenses/[licenseId]/original and /pdf by the session (P20b). One download_event per
// answered tap, and the answers all four routes share; each route keeps its own lookup and gate. The routes are plain
// links, so a failure can only be shown by sending the buyer back to the page; HEAD (a scanner, `curl -I`) never runs
// GET's work.

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

/** The 303 that sends a failed download back to its page (Q-185), with an absolute Location. */
const seeOther = (path: string) =>
  new Response(null, {
    status: 303,
    headers: {
      ...DOWNLOAD_HEADERS,
      Location: new URL(path, env.APP_URL).href,
    },
  });

/** The 303 back to `/l/{token}?download=failed` (Q-185); a token that can't be a key gets the 404 instead. */
export const downloadFailed = (token: string): Response =>
  isBuyerToken(token)
    ? seeOther(downloadFailedPath(token))
    : downloadNotFound();

/** The 303 back to `/licenses/{id}?download=failed` (Q-185 on My licenses); an id that isn't a uuid gets the 404. */
export const myDownloadFailed = (licenseId: string): Response =>
  isUuid(licenseId)
    ? seeOther(myLicenseDownloadFailedPath(licenseId))
    : downloadNotFound();

/**
 * A download route's answer: `respond`'s, or, when it throws for an unexpected reason (a storage, database or render
 * error), `onFailure`'s (the 303 back to the page, Q-185), logged with the kind and the error's name only (never the
 * key, an email or a signed URL). Next's redirect and notFound throws pass through (unstable_rethrow).
 */
export async function downloadResponse(
  kind: DownloadKind,
  respond: () => Promise<Response>,
  onFailure: () => Response,
): Promise<Response> {
  try {
    return await respond();
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "license.download_failed", {
      kind,
      error: errorName(error),
    });
    return onFailure();
  }
}

/**
 * A session download route's answer (P20b): downloadResponse with the 303 back to `/licenses/{id}?download=failed`,
 * marked noindex (next.config's /api/my row sends it too; the handler's own answer carries it as well).
 */
export async function myDownloadResponse(
  kind: DownloadKind,
  licenseId: string,
  respond: () => Promise<Response>,
): Promise<Response> {
  const response = await downloadResponse(kind, respond, () =>
    myDownloadFailed(licenseId),
  );
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

/**
 * The original, once a route's gate let it through (only while the license is valid): a 302 to a 5-minute signed URL
 * that downloads it as `ClipLease-CL-7K3M-9QXA-original.mp4`, from the license's own copy of the key (DB13), never the
 * video's. The row is written once the URL is minted (AD-98), so a failed attempt writes none. A broken row's unknown
 * type throws, answered as a failure.
 */
export async function originalDownloadResponse(
  request: Request,
  l: Pick<
    BuyerLicense["license"],
    "id" | "code" | "originalObjectKey" | "originalMime"
  >,
): Promise<Response> {
  const extension = originalExtension(l.originalMime);
  const url = await presignDownload({
    key: l.originalObjectKey,
    filename: `${APP_NAME}-${l.code}-original.${extension}`,
    disposition: "attachment",
    contentType: l.originalMime,
  });
  await recordDownload(request, l.id, "original");
  return new Response(null, {
    status: 302,
    headers: { ...DOWNLOAD_HEADERS, Location: url },
  });
}

/**
 * The license PDF, once a route's gate let it through (unless revoked): rendered from the snapshot and the request's
 * two checkout facts (owner answer Q-183), sent inline as `ClipLease-CL-7K3M-9QXA-license.pdf`, never stored. The row
 * is written once the PDF is rendered (AD-98), so a failed render writes none.
 */
export async function licensePdfResponse(
  request: Request,
  found: {
    license: Pick<BuyerLicense["license"], "id" | "code" | "snapshot">;
    request: Pick<BuyerLicense["request"], "territoryCode" | "termsAcceptedAt">;
  },
): Promise<Response> {
  const { license, request: facts } = found;
  const pdf = await renderLicensePdf(license.snapshot, {
    territoryCode: facts.territoryCode,
    acceptedAt: facts.termsAcceptedAt,
  });
  await recordDownload(request, license.id, "pdf");
  return new Response(new Uint8Array(pdf), {
    headers: {
      ...DOWNLOAD_HEADERS,
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(
        "inline",
        `${APP_NAME}-${license.code}-license.pdf`,
      ),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
