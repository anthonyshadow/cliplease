import "server-only";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/client";
import { creatorProfile, license, licenseRequest, video } from "@/db/schema";
import type {
  BuyerStatus,
  CreatorRequest,
  InboxView,
} from "@/lib/licensing/request-dto";
import { scopeLabel } from "@/lib/licensing/selection";
import { displayStatus } from "@/lib/licensing/transitions";
import { isUuid } from "@/lib/validation/uuid";
import { enabledPlatforms } from "../social/registry";
import { findRequestForBuyer } from "../tokens/buyer-token";
import {
  isPubliclyAvailable,
  posterSrc,
  postingPlatformsColumn,
} from "../videos/visibility";
import { overdueColumn } from "./deadline";

// The request pages' reads (02 §4.1; 03 §7.1, §7.6). Every creator query is scoped to the caller's creator id, which
// comes from requireCreator, never from the URL. A creator never sees a request in checkout, an abandoned one or a
// renewal row (01 §3.0), nor the buyer's email (07 D47).

/** History: decided requests (03 §7.1 (c)). */
const HISTORY_STATUSES = [
  "approved",
  "declined",
  "expired",
  "capture_failed",
] as const;
/** The statuses a creator sees (01 §3.0): Waiting's and History's. */
const CREATOR_STATUSES = ["awaiting_approval", ...HISTORY_STATUSES] as const;
const HISTORY_LIMIT = 20;

/** The columns every request page reads. */
const FACTS = {
  id: licenseRequest.id,
  status: licenseRequest.status,
  statusReason: licenseRequest.statusReason,
  paymentAction: licenseRequest.paymentAction,
  // displayStatus's deadline, on the database's clock as the claims read it (02 §4.4 rule 3).
  overdue: overdueColumn,
  useKey: licenseRequest.useKey,
  termKey: licenseRequest.termKey,
  territoryKey: licenseRequest.territoryKey,
  territoryCode: licenseRequest.territoryCode,
  licensePriceCents: licenseRequest.licensePriceCents,
  amountTotalCents: licenseRequest.amountTotalCents,
  currency: licenseRequest.currency,
  expiresAt: licenseRequest.expiresAt,
  videoId: video.id,
  title: video.title,
  posterObjectKey: video.posterObjectKey,
  handle: creatorProfile.handle,
  slug: video.slug,
  licenseCode: license.code,
};
/** A creator's view adds the buyer's entries (never their email). */
const CREATOR_FACTS = {
  ...FACTS,
  licenseeName: licenseRequest.licenseeName,
  contactName: licenseRequest.contactName,
  intendedUse: licenseRequest.intendedUse,
  createdAt: licenseRequest.createdAt,
};
/** /r adds what decides whether its poster may load. */
const BUYER_FACTS = {
  ...FACTS,
  videoStatus: video.status,
  postingPlatforms: postingPlatformsColumn,
};

/** A creator's request rows with their video, creator and license (license_license_request_uidx: at most one). */
const creatorRequests = () =>
  db
    .select(CREATOR_FACTS)
    .from(licenseRequest)
    .innerJoin(video, eq(video.id, licenseRequest.videoId))
    .innerJoin(creatorProfile, eq(creatorProfile.id, licenseRequest.creatorId))
    .leftJoin(license, eq(license.licenseRequestId, licenseRequest.id));

type CreatorRow = Awaited<ReturnType<typeof creatorRequests>>[number];
type FactsRow = Pick<CreatorRow, keyof typeof FACTS>;

/** The shared DTO fields, mapped one by one. */
function factsOf(r: FactsRow, posterUrl: string | null) {
  return {
    id: r.id,
    status: r.status,
    displayStatus: displayStatus(r),
    statusReason: r.statusReason,
    scope: scopeLabel(r),
    licensePriceCents: r.licensePriceCents,
    amountTotalCents: r.amountTotalCents,
    currency: r.currency,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    videoId: r.videoId,
    title: r.title,
    posterUrl,
    handle: r.handle,
    slug: r.slug,
    licenseCode: r.licenseCode,
  };
}

function creatorRequestOf(r: CreatorRow): CreatorRequest {
  return {
    // The creator always gets their own poster (02 §4.2).
    ...factsOf(
      r,
      posterSrc({ id: r.videoId, posterObjectKey: r.posterObjectKey }),
    ),
    licenseeName: r.licenseeName,
    contactName: r.contactName,
    intendedUse: r.intendedUse,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * The request a buyer link opens (03 §7.6), or null for a wrong key, an unknown id or anything malformed. A pure read:
 * nothing is asked of Stripe. The poster only while the video is public: the route answers anyone else with a 404.
 */
export async function getBuyerStatus(
  requestId: string,
  token: string,
): Promise<BuyerStatus | null> {
  const request = await findRequestForBuyer(requestId, token);
  if (!request) return null;
  const [r] = await db
    .select(BUYER_FACTS)
    .from(licenseRequest)
    .innerJoin(video, eq(video.id, licenseRequest.videoId))
    .innerJoin(creatorProfile, eq(creatorProfile.id, licenseRequest.creatorId))
    .leftJoin(license, eq(license.licenseRequestId, licenseRequest.id))
    .where(eq(licenseRequest.id, request.id));
  if (!r) return null;
  const visible = isPubliclyAvailable(
    { status: r.videoStatus, postingPlatforms: r.postingPlatforms },
    enabledPlatforms(),
  );
  return factsOf(
    r,
    visible
      ? posterSrc({ id: r.videoId, posterObjectKey: r.posterObjectKey })
      : null,
  );
}

/**
 * The inbox (03 §7.1): `waiting`, every request waiting for the creator, soonest deadline first; `history`, the 20
 * newest decided ones, with the license's code when there is one.
 */
export async function listInbox(
  creatorId: string,
  view: InboxView,
): Promise<CreatorRequest[]> {
  const mine = eq(licenseRequest.creatorId, creatorId);
  const rows =
    view === "waiting"
      ? await creatorRequests()
          .where(and(mine, eq(licenseRequest.status, "awaiting_approval")))
          .orderBy(asc(licenseRequest.expiresAt), asc(licenseRequest.id))
      : await creatorRequests()
          .where(and(mine, inArray(licenseRequest.status, HISTORY_STATUSES)))
          .orderBy(desc(licenseRequest.createdAt), desc(licenseRequest.id))
          .limit(HISTORY_LIMIT);
  return rows.map(creatorRequestOf);
}

/** One of the creator's requests (S15), or null: another creator's, an unknown or malformed id, or one they never see. */
export async function getRequestForCreator(
  creatorId: string,
  requestId: string,
): Promise<CreatorRequest | null> {
  if (!isUuid(requestId)) return null;
  const [r] = await creatorRequests().where(
    and(
      eq(licenseRequest.id, requestId),
      eq(licenseRequest.creatorId, creatorId),
      inArray(licenseRequest.status, CREATOR_STATUSES),
    ),
  );
  return r ? creatorRequestOf(r) : null;
}

/**
 * The requests waiting for the creator: how many (the Inbox title, its segment and the NavBar/TabBar badge, 05 §6.3) and
 * the soonest deadline still ahead on the database's clock (the payouts Banner, 07 D77): an overdue request reads
 * Expired until its expiry is stored (owner answer Q-142 a), so the Banner never names a deadline that has passed. One
 * aggregate on license_request_inbox_idx, once per request.
 */
export const waitingSummary = cache(
  async (
    creatorId: string,
  ): Promise<{ count: number; soonestExpiresAt: string | null }> => {
    const [row] = await db
      .select({
        count: count(),
        soonest:
          sql<Date | null>`min(${licenseRequest.expiresAt}) filter (where ${licenseRequest.expiresAt} > now())`.mapWith(
            licenseRequest.expiresAt,
          ),
      })
      .from(licenseRequest)
      .where(
        and(
          eq(licenseRequest.creatorId, creatorId),
          eq(licenseRequest.status, "awaiting_approval"),
        ),
      );
    return {
      count: row?.count ?? 0,
      soonestExpiresAt: row?.soonest?.toISOString() ?? null,
    };
  },
);
