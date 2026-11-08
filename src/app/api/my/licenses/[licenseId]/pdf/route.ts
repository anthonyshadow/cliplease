import { myLicensePath } from "@/lib/urls";
import { requireUser } from "@/server/auth/session";
import { getBuyerLicense } from "@/server/buyers/queries";
import {
  downloadNotFound,
  headNotAllowed,
  licensePdfResponse,
  myDownloadResponse,
} from "@/server/licensing/downloads";

// The buyer's license PDF by the session (02 §4.2, §9.2; 07 D126, D16, D17; P20b): licensePdfResponse's inline PDF. An
// expired license keeps it; a revoked one, another email's license and an unknown or malformed id get the empty 404
// with no row, the handler's own answer. Signed out → /sign-in?next=/licenses/{id}. A failed render writes no row and
// answers the 303 back to /licenses/{id}?download=failed (Q-185). Never the buyer key (02 §9.5).

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/my/licenses/[licenseId]/pdf">,
) {
  const { licenseId } = await ctx.params;
  const user = await requireUser(myLicensePath(licenseId));
  return myDownloadResponse("pdf", licenseId, async () => {
    const found = await getBuyerLicense(user, licenseId);
    if (!found || found.status === "revoked") return downloadNotFound();
    return licensePdfResponse(request, found);
  });
}

/** HEAD (a scanner, `curl -I`) never renders or logs a download: Next would answer it by running GET (Q-185). */
export function HEAD() {
  return headNotAllowed();
}
