import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { license, licenseRequest } from "@/db/schema";
import {
  type RecordStatus,
  snapshotBadge,
  snapshotPostings,
  verifySentence,
} from "@/lib/licensing/license-record";
import { publicStatus } from "@/lib/licensing/public-status";
import { LicenseSnapshotV1Schema } from "@/lib/licensing/snapshot";
import type { PublicPostingDTO } from "@/lib/postings/types";
import { verifyPath } from "@/lib/urls";
import type { BadgeInput } from "@/lib/videos/ownership";
import { normalizeLicenseCode } from "../codes/license-code";
import { env } from "../env";

// A license's public record, /verify/[code] (S05; research/license.md §6.2–§6.4; 01 J10; 07 D16, D47, D71, D101, D113).

/**
 * What anyone may read about a license (research/license.md §6.3): an allow-list copied field by field, never a spread
 * of the snapshot, so a field the snapshot gains later stays private until it is added here. No amount or currency
 * (07 D94), no email or contact name, IP, Stripe id, storage key, download data, or revocation reason or note. The
 * badge keeps `mock`, the demo account (07 D43), which §6.3's type predates; it and the postings are the snapshot's
 * (J10.6), never live rows. Dates are ISO from the license columns.
 */
export type PublicLicenseView = {
  status: RecordStatus;
  code: string;
  /** The status sentence (§6.4; 07 D113), the territory named from the request's code (Q-115 a, Q-183). */
  sentence: string;
  issuedAt: string;
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
  licenseeName: string;
  creator: { handle: string; displayName: string };
  /** VerifiedOwnerBadge lg's input. */
  badge: BadgeInput;
  postings: PublicPostingDTO[];
  video: { title: string };
  scope: {
    useLabel: string;
    termLabel: string;
    territoryLabel: string;
    territoryDetail: string | null;
  };
  exclusions: { music: boolean; people: boolean };
  exclusive: boolean;
  termsVersion: "v1";
};

/**
 * getPublicLicenseView's answers: the 308 target for input that isn't the canonical code (07 D101); not_found with the
 * canonical code it looked up, or null for malformed input (owner answer Q-184: only a canonical code is ever printed);
 * or the record.
 */
export type VerifyLookup =
  | { redirectTo: string }
  | { status: "not_found"; code: string | null }
  | PublicLicenseView;

/**
 * The record for what someone typed after /verify/ (already decoded). Status is publicStatus at `now`, unchanged in P20
 * (`upcoming` is P22b's, 07 D117). The snapshot is checked against LicenseSnapshotV1Schema; the request gives only its
 * territory code, which never changes after checkout.
 */
export async function getPublicLicenseView(
  rawCode: string,
  now = new Date(),
): Promise<VerifyLookup> {
  const code = normalizeLicenseCode(rawCode);
  if (code === null) return { status: "not_found", code: null };
  if (code !== rawCode) return { redirectTo: verifyPath(code) };
  const [row] = await db
    .select({
      code: license.code,
      createdAt: license.createdAt,
      startsAt: license.startsAt,
      endsAt: license.endsAt,
      revokedAt: license.revokedAt,
      snapshot: license.snapshot,
      territoryCode: licenseRequest.territoryCode,
    })
    .from(license)
    .innerJoin(licenseRequest, eq(licenseRequest.id, license.licenseRequestId))
    .where(eq(license.code, code));
  const status = publicStatus(row ?? null, now);
  if (!row || status === "not_found") return { status: "not_found", code };
  const s = LicenseSnapshotV1Schema.parse(row.snapshot);
  return {
    status,
    code: row.code,
    sentence: verifySentence(s, status, {
      territoryCode: row.territoryCode,
      revokedAt: row.revokedAt,
    }),
    issuedAt: row.createdAt.toISOString(),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    licenseeName: s.licensee.name,
    creator: { handle: s.creator.handle, displayName: s.creator.displayName },
    badge: snapshotBadge(s, "lg"),
    postings: snapshotPostings(s).postings,
    video: { title: s.video.title },
    scope: {
      useLabel: s.scope.useLabel,
      termLabel: s.scope.termLabel,
      territoryLabel: s.scope.territoryLabel,
      territoryDetail: s.scope.territoryDetail,
    },
    exclusions: { music: s.exclusions.music, people: s.exclusions.people },
    exclusive: s.exclusive,
    termsVersion: s.termsVersion,
  };
}

/** The address the record's footer tells readers to check (research/license.md §6.4): APP_URL's host (07 D102). */
export const recordDomain = () => new URL(env.APP_URL).host;
