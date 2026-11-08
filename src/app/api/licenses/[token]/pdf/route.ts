import { publicStatus } from "@/lib/licensing/public-status";
import {
  downloadFailed,
  downloadNotFound,
  downloadResponse,
  headNotAllowed,
  licensePdfResponse,
} from "@/server/licensing/downloads";
import { findLicenseForBuyer } from "@/server/tokens/buyer-token";

// The buyer's license PDF by the buyer link (02 §4.2, §9.5; 07 D16, D17): licensePdfResponse's inline PDF. An expired
// license keeps it; a revoked one and a wrong key get the empty 404 with no row. A failed render writes no row and
// answers the 303 back to /l (Q-185). The token is never logged. publicStatus stays two-field until P22b's `upcoming`
// (07 D117).

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/licenses/[token]/pdf">,
) {
  const { token } = await ctx.params;
  return downloadResponse(
    "pdf",
    async () => {
      const found = await findLicenseForBuyer(token);
      if (!found || publicStatus(found.license, new Date()) === "revoked") {
        return downloadNotFound();
      }
      return licensePdfResponse(request, found);
    },
    () => downloadFailed(token),
  );
}

/** HEAD (a scanner, `curl -I`) never renders or logs a download: Next would answer it by running GET (Q-185). */
export function HEAD() {
  return headNotAllowed();
}
