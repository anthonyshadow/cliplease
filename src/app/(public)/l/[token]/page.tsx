import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { LicenseDelivery } from "@/components/cleared/license-delivery";
import {
  isDownloadFailed,
  LICENSE_RECORD_COPY,
  recordStatus,
} from "@/lib/licensing/license-record";
import { maskEmail, signInPath } from "@/lib/sign-in";
import { DAY_MS } from "@/lib/time";
import { originalExtension } from "@/lib/upload/limits";
import { licenseDownloadPath, myLicensePath, verifyPath } from "@/lib/urls";
import { env } from "@/server/env";
import { findLicenseForBuyer } from "@/server/tokens/buyer-token";

/** One read per request, shared by the metadata and the page. */
const buyerLicense = cache(findLicenseForBuyer);

/**
 * No referrer and no index on every answer (07 D61; 02 §9.5): a client navigation here (/r's Get file and license) never
 * gets next.config's headers. The title is 07 D100's moment word (the root template adds " · ClipLease"); a dead link
 * gets none, so it reads "ClipLease" whatever the reason.
 */
const PRIVATE: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export async function generateMetadata({
  params,
}: PageProps<"/l/[token]">): Promise<Metadata> {
  const found = await buyerLicense((await params).token);
  return found
    ? {
        ...PRIVATE,
        title: LICENSE_RECORD_COPY.buyer.title(
          found.license.snapshot.video.title,
        ),
      }
    : PRIVATE;
}

/**
 * S04, the buyer's file and license (01 J9; 05 §4.4): the approved request's license by its buyer key (02 §9.5), else
 * the "Buyer link dead" 404. The download routes are /api/licenses/{key}/original and /pdf; one that fails sends the
 * buyer back with `?download=failed` (owner answer Q-185). **Manage in My licenses** goes through the sign-in to the
 * license's page (owner answer Q-193): this page still reads no session and sets no cookie. No loading.tsx: a streamed
 * route answers 200, and a dead link must be a real 404 (owner answer Q-110 a, as /r); 05's Loading state isn't built.
 */
export default async function LicenseDeliveryPage({
  params,
  searchParams,
}: PageProps<"/l/[token]">) {
  const { token } = await params;
  const found = await buyerLicense(token);
  if (!found) notFound();
  const { license, request } = found;
  const now = new Date();
  const status = recordStatus(license, now);
  const query = await searchParams;
  return (
    <LicenseDelivery
      snapshot={license.snapshot}
      status={status}
      revokedAt={license.revokedAt}
      original={{
        type: originalExtension(license.originalMime).toUpperCase(),
        bytes: license.originalBytes,
      }}
      territoryCode={request.territoryCode}
      amountTotalCents={request.amountTotalCents}
      maskedEmail={maskEmail(request.buyerEmail)}
      links={{
        original: licenseDownloadPath(token, "original"),
        pdf: licenseDownloadPath(token, "pdf"),
        verify: `${env.APP_URL}${verifyPath(license.code)}`,
        manage: signInPath(myLicensePath(license.id)),
      }}
      fresh={now.getTime() - license.createdAt.getTime() < DAY_MS}
      downloadFailed={isDownloadFailed(query)}
    />
  );
}
