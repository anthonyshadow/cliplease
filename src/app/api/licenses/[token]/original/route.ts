import { APP_NAME } from "@/lib/app-name";
import { publicStatus } from "@/lib/licensing/public-status";
import { originalExtension } from "@/lib/upload/limits";
import {
  DOWNLOAD_HEADERS,
  downloadNotFound,
  downloadResponse,
  headNotAllowed,
  recordDownload,
} from "@/server/licensing/downloads";
import { presignDownload } from "@/server/storage/uploads";
import { findLicenseForBuyer } from "@/server/tokens/buyer-token";

// The buyer's original (02 §4.2, §9.5; 07 D16, D61; owner answer Q-185): only while the license is valid
// (publicStatus, unchanged until P22b adds `upcoming`, 07 D117), a 302 to a 5-minute signed URL that downloads it as
// `ClipLease-CL-7K3M-9QXA-original.mp4`, from the license's own copy of the key (DB13), never the video's. A wrong key,
// a request that isn't approved, an expired or revoked license: the empty 404, with no row. The download_event is
// written once the URL is minted, so a failed attempt logs none; a storage or database error sends the buyer back to
// /l?download=failed. The key, the signed URL and the token are never logged.

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/licenses/[token]/original">,
) {
  const { token } = await ctx.params;
  return downloadResponse(token, "original", async () => {
    const found = await findLicenseForBuyer(token);
    if (!found || publicStatus(found.license, new Date()) !== "valid") {
      return downloadNotFound();
    }
    const { license } = found;
    // A broken row's unknown type throws, answered as a failure.
    const extension = originalExtension(license.originalMime);
    const url = await presignDownload({
      key: license.originalObjectKey,
      filename: `${APP_NAME}-${license.code}-original.${extension}`,
      disposition: "attachment",
      contentType: license.originalMime,
    });
    await recordDownload(request, license.id, "original");
    return new Response(null, {
      status: 302,
      headers: { ...DOWNLOAD_HEADERS, Location: url },
    });
  });
}

/** HEAD (a scanner, `curl -I`) never mints a URL or logs a download: Next would answer it by running GET. */
export function HEAD() {
  return headNotAllowed();
}
