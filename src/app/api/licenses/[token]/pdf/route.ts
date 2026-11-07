import { APP_NAME } from "@/lib/app-name";
import { publicStatus } from "@/lib/licensing/public-status";
import {
  DOWNLOAD_HEADERS,
  downloadNotFound,
  downloadResponse,
  headNotAllowed,
  recordDownload,
} from "@/server/licensing/downloads";
import { renderLicensePdf } from "@/server/pdf/generate";
import { contentDisposition } from "@/server/storage/content-disposition";
import { findLicenseForBuyer } from "@/server/tokens/buyer-token";

// The buyer's license PDF (02 §4.2, §9.5; 07 D16, D17): rendered from the snapshot and the request's two checkout facts
// (owner answer Q-183) on each GET, sent inline as `ClipLease-CL-7K3M-9QXA-license.pdf`, never stored. An expired
// license keeps it; a revoked one and a wrong key get the empty 404 with no row. The row is written once the PDF is
// rendered, so a failed render writes none and answers the 303 back to /l (Q-185). The token is never logged.
// publicStatus stays two-field until P22b's `upcoming` (07 D117).

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/licenses/[token]/pdf">,
) {
  const { token } = await ctx.params;
  return downloadResponse(token, "pdf", async () => {
    const found = await findLicenseForBuyer(token);
    if (!found || publicStatus(found.license, new Date()) === "revoked") {
      return downloadNotFound();
    }
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
  });
}

/** HEAD (a scanner, `curl -I`) never renders or logs a download: Next would answer it by running GET (Q-185). */
export function HEAD() {
  return headNotAllowed();
}
