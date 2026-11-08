import "server-only";
import { APP_NAME } from "@/lib/app-name";
import { renderLicensePdf } from "../pdf/generate";
import { contentDisposition } from "../storage/content-disposition";
import type { BuyerLicense } from "./buyer-license";
import { DOWNLOAD_HEADERS, recordDownload } from "./downloads";

// The license PDF's download answer (02 §4.2; 07 D17; owner answer Q-183), for /api/licenses/[token]/pdf and
// /api/my/licenses/[licenseId]/pdf only: its own module, so the routes that send the original never load the renderer.

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
