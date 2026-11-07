import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { z } from "zod";
import {
  LICENSE_RECORD_COPY,
  verifyTitle,
} from "@/lib/licensing/license-record";
import {
  getPublicLicenseView,
  recordDomain,
  type VerifyLookup,
} from "@/server/licensing/verify";
import { PublicRecord } from "./public-record";

/** One read per request, shared by the metadata and the page. */
const publicView = cache(getPublicLicenseView);

/**
 * The code as typed: Next hands user code the segment percent-encoded, so "CL-7K3M-9QXA " (01 J10.4) arrives as
 * "…%20". A segment that can't be decoded can't be a code.
 */
const RouteParams = z.object({
  code: z.string().transform((param, ctx) => {
    try {
      return decodeURIComponent(param);
    } catch {
      ctx.addIssue({ code: "custom", message: "not a code" });
      return z.NEVER;
    }
  }),
});

async function lookup(
  params: Promise<{ code: string }>,
): Promise<VerifyLookup> {
  const route = RouteParams.safeParse(await params);
  return route.success
    ? publicView(route.data.code)
    : { status: "not_found", code: null };
}

/**
 * noindex on every answer (02 §4.6; 01 J10.5): next.config sends the header, and this covers client navigations, which
 * never get it. Titles per owner answer Q-186: "Valid license: CL-7K3M-9QXA" (the root template adds " · ClipLease").
 */
const NOINDEX: Metadata = { robots: { index: false, follow: false } };

export async function generateMetadata({
  params,
}: PageProps<"/verify/[code]">): Promise<Metadata> {
  const found = await lookup(params);
  if ("redirectTo" in found) return NOINDEX;
  return {
    ...NOINDEX,
    title:
      found.status === "not_found"
        ? LICENSE_RECORD_COPY.verify.notFoundHeading
        : verifyTitle(found.status, found.code),
  };
}

/**
 * S05, the public record (01 J10; 05 §4.5): anyone, signed in or not. Input that isn't the canonical code is a 308 to it
 * (07 D101); an unknown or malformed code is the segment's 404. Rendered per request (connection()), so it is never
 * cached and answers `no-store` (J10.5). No loading.tsx: a streamed route answers 200, and the 404 must be real (owner
 * answer Q-110 a).
 */
export default async function VerifyPage({
  params,
}: PageProps<"/verify/[code]">) {
  await connection();
  const found = await lookup(params);
  if ("redirectTo" in found) permanentRedirect(found.redirectTo);
  if (found.status === "not_found") notFound();
  return <PublicRecord view={found} domain={recordDomain()} />;
}
