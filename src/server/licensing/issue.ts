import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  creatorProfile,
  license,
  licenseRequest,
  socialPost,
  video,
  videoPosting,
} from "@/db/schema";
import {
  isOneOf,
  TERM_KEYS,
  TERRITORY_KEYS,
  USE_KEYS,
} from "@/lib/domain/values";
import { LICENSE_V1_VERSION } from "@/lib/legal/license-v1-summary";
import { computeEndsAt } from "@/lib/licensing/ends-at";
import {
  buildLicenseSnapshot,
  LicenseSnapshotV1Schema,
  type SnapshotPosting,
} from "@/lib/licensing/snapshot";
import { writeAudit } from "../audit";
import type { Actor } from "../auth/actor";
import { generateLicenseCode } from "../codes/license-code";

// Issuing a license (02 §5.7; 03 §3.7.2, T5; 07 D33, D71): inside the caller's transaction, which has already fenced the
// request. It reads no status and decides nothing from one, so any finish that has made the request approved, before or
// after this call, can use it. The license copies the original's key (DB13) and carries the immutable snapshot.

/** Insert attempts before giving up: a collision of 40-bit codes is rare (research/license.md §6.1). */
const CODE_ATTEMPTS = 5;

export type IssuedLicense = { licenseId: string; code: string };

/**
 * The request's license: the existing one (idempotent), or a new one starting at `startsAt` with a fresh code. Each
 * insert attempt runs in its own savepoint with ON CONFLICT DO NOTHING (a taken code, or another writer's license for
 * the request); an empty result re-checks by request first, then retries with a new code. After 5 collisions it throws,
 * and the caller's transaction rolls back. Audits `license.issued` with the code only, as `opts.actor`.
 */
export async function issueLicense(
  tx: Tx,
  requestId: string,
  startsAt: Date,
  opts: { actor: Actor },
): Promise<IssuedLicense> {
  const existing = await licenseOf(tx, requestId);
  if (existing) return existing;
  const { creatorId, original, ...facts } = await issueFacts(tx, requestId);
  const issuedAt = new Date();
  const endsAt = computeEndsAt(startsAt, facts.request.termKey);
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const code = generateLicenseCode();
    const snapshot = LicenseSnapshotV1Schema.parse(
      buildLicenseSnapshot({ ...facts, code, issuedAt, startsAt, endsAt }),
    );
    const [inserted] = await tx.transaction((sp) =>
      sp
        .insert(license)
        .values({
          licenseRequestId: requestId,
          videoId: facts.video.id,
          creatorId,
          code,
          termsVersion: LICENSE_V1_VERSION,
          startsAt,
          endsAt,
          snapshot,
          originalObjectKey: original.objectKey,
          originalBytes: original.bytes,
          originalMime: original.mime,
          createdAt: issuedAt,
        })
        .onConflictDoNothing()
        .returning({ licenseId: license.id, code: license.code }),
    );
    if (inserted) {
      await writeAudit(tx, opts.actor, {
        action: "license.issued",
        entityType: "license",
        entityId: inserted.licenseId,
        data: { code },
      });
      return inserted;
    }
    const theirs = await licenseOf(tx, requestId);
    if (theirs) return theirs;
  }
  throw new Error("issueLicense: no free license code after 5 attempts");
}

async function licenseOf(
  tx: Tx,
  requestId: string,
): Promise<IssuedLicense | null> {
  const [row] = await tx
    .select({ licenseId: license.id, code: license.code })
    .from(license)
    .where(eq(license.licenseRequestId, requestId));
  return row ?? null;
}

/** The request, its video and creator, and the video's postings, as the snapshot needs them. */
async function issueFacts(tx: Tx, requestId: string) {
  const [row] = await tx
    .select({
      videoId: licenseRequest.videoId,
      creatorId: licenseRequest.creatorId,
      licenseeName: licenseRequest.licenseeName,
      useKey: licenseRequest.useKey,
      termKey: licenseRequest.termKey,
      territoryKey: licenseRequest.territoryKey,
      territoryCode: licenseRequest.territoryCode,
      licensePriceCents: licenseRequest.licensePriceCents,
      platformFeeCents: licenseRequest.platformFeeCents,
      amountTotalCents: licenseRequest.amountTotalCents,
      currency: licenseRequest.currency,
      title: video.title,
      durationMs: video.durationMs,
      width: video.width,
      height: video.height,
      containsMusic: video.containsMusic,
      identifiablePeople: video.identifiablePeople,
      originalStatus: video.originalStatus,
      originalObjectKey: video.originalObjectKey,
      originalBytes: video.originalBytes,
      originalMime: video.originalMime,
      handle: creatorProfile.handle,
      displayName: creatorProfile.displayName,
    })
    .from(licenseRequest)
    .innerJoin(video, eq(video.id, licenseRequest.videoId))
    .innerJoin(creatorProfile, eq(creatorProfile.id, licenseRequest.creatorId))
    .where(eq(licenseRequest.id, requestId))
    .for("update", { of: licenseRequest });
  if (!row) throw new Error("issueLicense: unknown request");
  const { useKey, termKey, territoryKey } = row;
  if (
    !isOneOf(USE_KEYS, useKey) ||
    !isOneOf(TERM_KEYS, termKey) ||
    !isOneOf(TERRITORY_KEYS, territoryKey)
  ) {
    throw new Error("issueLicense: the request's scope keys");
  }
  if (
    row.originalStatus !== "ready" ||
    !row.originalObjectKey ||
    row.originalBytes === null ||
    !row.originalMime
  ) {
    throw new Error("issueLicense: the video's original isn't ready");
  }
  if (row.containsMusic === null || row.identifiablePeople === null) {
    throw new Error("issueLicense: the video's rights aren't attested");
  }
  return {
    creatorId: row.creatorId,
    original: {
      objectKey: row.originalObjectKey,
      bytes: row.originalBytes,
      mime: row.originalMime,
    },
    request: {
      licenseeName: row.licenseeName,
      useKey,
      termKey,
      territoryKey,
      territoryCode: row.territoryCode,
      licensePriceCents: row.licensePriceCents,
      platformFeeCents: row.platformFeeCents,
      amountTotalCents: row.amountTotalCents,
      currency: row.currency,
    },
    video: {
      id: row.videoId,
      title: row.title,
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      containsMusic: row.containsMusic,
      identifiablePeople: row.identifiablePeople,
    },
    creator: { handle: row.handle, displayName: row.displayName },
    postings: await postingsOf(tx, row.videoId),
  };
}

/** Every posting of the video, whatever its status now (a waiting request stays approvable after Unpublish). */
async function postingsOf(tx: Tx, videoId: string): Promise<SnapshotPosting[]> {
  const rows = await tx
    .select({
      platform: videoPosting.platform,
      otherLabel: videoPosting.otherLabel,
      url: videoPosting.url,
      showLink: videoPosting.showLink,
      isSource: videoPosting.isSource,
      verification: videoPosting.verification,
      position: videoPosting.position,
      verifiedUsername: videoPosting.verifiedUsername,
      verifiedAccountLinkedAt: videoPosting.verifiedAccountLinkedAt,
      verifiedAt: videoPosting.verifiedAt,
      removedAt: socialPost.removedAt,
    })
    .from(videoPosting)
    .leftJoin(
      socialPost,
      and(
        eq(socialPost.id, videoPosting.socialPostId),
        eq(socialPost.creatorId, videoPosting.creatorId),
      ),
    )
    .where(eq(videoPosting.videoId, videoId));
  return rows.map(({ removedAt, ...p }) => ({
    ...p,
    removed: p.verification === "verified" && removedAt !== null,
  }));
}
