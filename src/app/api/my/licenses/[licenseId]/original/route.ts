import { myLicensePath } from "@/lib/urls";
import { requireUser } from "@/server/auth/session";
import { getBuyerLicense } from "@/server/buyers/queries";
import {
  downloadNotFound,
  headNotAllowed,
  myDownloadResponse,
  originalDownloadResponse,
} from "@/server/licensing/downloads";

// The buyer's original by the session (02 §4.2, §9.2; 07 D126; P20b): only while the license is valid, then
// originalDownloadResponse's 302. Signed out → /sign-in?next=/licenses/{id}. Another email's license, an unknown or
// malformed id, an expired or revoked license: the empty 404 with no row, the handler's own answer (never the 404 page,
// so the status never depends on notFound() in a route). A storage or database error sends the buyer back to
// /licenses/{id}?download=failed (Q-185). The license is read by its id and the session's email only, never by the
// buyer key (02 §9.5).

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/my/licenses/[licenseId]/original">,
) {
  const { licenseId } = await ctx.params;
  const user = await requireUser(myLicensePath(licenseId));
  return myDownloadResponse("original", licenseId, async () => {
    const found = await getBuyerLicense(user, licenseId);
    if (found?.status !== "valid") return downloadNotFound();
    return originalDownloadResponse(request, found.license);
  });
}

/** HEAD (a scanner, `curl -I`) never mints a URL or logs a download: Next would answer it by running GET (Q-185). */
export function HEAD() {
  return headNotAllowed();
}
