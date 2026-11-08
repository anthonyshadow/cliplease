import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  LICENSE_FACTS_CARD,
  LicenseFacts,
} from "@/components/cleared/license-facts";
import { LicenseFiles } from "@/components/cleared/license-files";
import { CopyLinkField } from "@/components/ui/copy-link-field";
import { StatusPill } from "@/components/ui/status-pill";
import { BackLink } from "@/components/videos/back-link";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import {
  isDownloadFailed,
  LICENSE_RECORD_COPY,
  licenseStatusPill,
} from "@/lib/licensing/license-record";
import { PRIVATE_PAGE } from "@/lib/private-page";
import { originalExtension } from "@/lib/upload/limits";
import {
  myLicenseDownloadPath,
  myLicensePath,
  myLicensesPath,
  verifyPath,
} from "@/lib/urls";
import { getSessionUser, requireUser } from "@/server/auth/session";
import { getBuyerLicense } from "@/server/buyers/queries";
import { env } from "@/server/env";

const COPY = LICENSE_RECORD_COPY.myLicenses;
const BUYER = LICENSE_RECORD_COPY.buyer;

/** One read per request, shared by the metadata and the page (the session user is the same object in both). */
const buyerLicense = cache(getBuyerLicense);

/**
 * PRIVATE_PAGE on every answer (07 §9.2; a My licenses row is a client navigation), with the video's title (the root
 * template adds " · ClipLease"), read only for the signed-in buyer's own license, so a 404 for another email's id never
 * carries its title: signed out, or not theirs, the page reads "ClipLease". It never redirects; the page does.
 */
export async function generateMetadata({
  params,
}: PageProps<"/licenses/[licenseId]">): Promise<Metadata> {
  const user = await getSessionUser();
  const found = user
    ? await buyerLicense(user, (await params).licenseId)
    : null;
  return found
    ? { ...PRIVATE_PAGE, title: found.license.snapshot.video.title }
    : PRIVATE_PAGE;
}

/**
 * S31 `/licenses/[licenseId]` (05 §4.10 callouts 1–3 and 8; 04 §9.37; 07 D16, D98, D113, D126), in the (buyer) layout's
 * one centered column: ‹ My licenses; the title, "@{handle} · {code}", the status pill and «Exclusive» or "Standard";
 * the license's facts as /l prints them; its files through the session routes, with /l's gates and failed line (owner
 * answer Q-185); "Anyone can check this license:" with the public record's link. Signed out → the sign-in; another
 * email's, an unknown or a malformed id → the generic 404, never a 403. The renewal panel is M6b's. No loading.tsx: a
 * streamed route answers 200, and these 404s must be real (owner answer Q-110 a, as /l).
 */
export default async function MyLicensePage({
  params,
  searchParams,
}: PageProps<"/licenses/[licenseId]">) {
  const { licenseId } = await params;
  const user = await requireUser(myLicensePath(licenseId));
  const found = await buyerLicense(user, licenseId);
  if (!found) notFound();
  const { license, request, status } = found;
  const { snapshot } = license;
  const pill = licenseStatusPill(status);
  const query = await searchParams;
  return (
    <>
      <BackLink href={myLicensesPath}>{COPY.back}</BackLink>
      <div className="flex flex-col items-start gap-2">
        <h1 className="text-title-1 text-ink wrap-anywhere">
          {snapshot.video.title}
        </h1>
        <p className="text-callout text-ink-2 tabular-nums wrap-anywhere">
          {`@${snapshot.creator.handle} · `}
          <span className="tracking-code">{license.code}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          {license.exclusive ? (
            <StatusPill>{INBOX_COPY.exclusiveTag}</StatusPill>
          ) : (
            <span className="text-callout text-ink-2">{COPY.standard}</span>
          )}
        </div>
      </div>
      <div className={LICENSE_FACTS_CARD}>
        <LicenseFacts
          snapshot={snapshot}
          status={status}
          amountTotalCents={request.amountTotalCents}
        />
      </div>
      <LicenseFiles
        status={status}
        revokedAt={license.revokedAt}
        original={{
          href: myLicenseDownloadPath(license.id, "original"),
          type: originalExtension(license.originalMime).toUpperCase(),
          bytes: license.originalBytes,
        }}
        pdfHref={myLicenseDownloadPath(license.id, "pdf")}
        failed={isDownloadFailed(query)}
      />
      <div className="flex flex-col gap-2">
        <p className="text-callout text-ink">{BUYER.verifyLead}</p>
        <CopyLinkField
          url={`${env.APP_URL}${verifyPath(license.code)}`}
          label={BUYER.verifyLink}
        />
      </div>
    </>
  );
}
