import { publicStatus } from "@/lib/licensing/public-status";
import {
  downloadFailed,
  downloadNotFound,
  downloadResponse,
  headNotAllowed,
  originalDownloadResponse,
} from "@/server/licensing/downloads";
import { findLicenseForBuyer } from "@/server/tokens/buyer-token";

// The buyer's original by the buyer link (02 §4.2, §9.5; 07 D16, D61; owner answer Q-185): only while the license is
// valid (publicStatus, unchanged until P22b adds `upcoming`, 07 D117), then originalDownloadResponse's 302. A wrong
// key, a request that isn't approved, an expired or revoked license: the empty 404, with no row. A storage or database
// error sends the buyer back to /l?download=failed. The key, the signed URL and the token are never logged.

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/licenses/[token]/original">,
) {
  const { token } = await ctx.params;
  return downloadResponse(
    "original",
    async () => {
      const found = await findLicenseForBuyer(token);
      if (!found || publicStatus(found.license, new Date()) !== "valid") {
        return downloadNotFound();
      }
      return originalDownloadResponse(request, found.license);
    },
    () => downloadFailed(token),
  );
}

/** HEAD (a scanner, `curl -I`) never mints a URL or logs a download: Next would answer it by running GET. */
export function HEAD() {
  return headNotAllowed();
}
