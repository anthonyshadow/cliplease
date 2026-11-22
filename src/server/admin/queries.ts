import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvent,
  creatorProfile,
  emailLog,
  license,
  licenseRequest,
  moneyMovement,
  socialAccount,
  stripeEvent,
  user,
  video,
  videoPosting,
} from "@/db/schema";
import { isAdminEventFlag } from "@/lib/admin/labels";
import type {
  AuditActorType,
  Currency,
  LicenseRequestStatus,
  MoneyMovementStatus,
  PayoutsStatus,
  PostingPlatform,
  SocialAccountStatus,
  SocialProviderId,
  VideoDisabledReason,
  VideoStatus,
} from "@/lib/domain/values";
import type { RecordStatus } from "@/lib/licensing/license-record";
import { scopeLabel } from "@/lib/licensing/selection";
import { type Actor, requireAdminActor } from "../auth/actor";
import { CONNECTION_STATE_COLUMNS } from "../library/queries";
import { downloadsColumn, statusColumn } from "../licensing/licenses";
import { deriveConnectionState } from "../social/connection-state";
import { requestCounts } from "../videos/queries";

// The admin view's read model (01 A.2, A.3; 03 §7.9; 05 §7; 07 D45, D47, D127; design/P21-admin-view.md §4.6–§4.10):
// one loader per tab, the newest 50 rows each (created_at DESC, id DESC), each column named, counts as subqueries on
// existing indexes, dates as ISO strings. Admins see buyer and creator emails (07 D47), never a credential, a sealed
// value or its hash, a storage key, an IP or user agent, a raw social id or link, or a license's snapshot. Reads only:
// nothing here expires, settles or reconciles a row (P22 relies on it).

const LIMIT = 50;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => d?.toISOString() ?? null;

/** The Creators tab (03 §7.9; 07 D93, D94): no age band and no payout country. */
export type AdminCreatorRow = {
  id: string;
  handle: string;
  displayName: string;
  /** The creator's sign-in address (07 D47). */
  email: string;
  payoutCurrency: Currency;
  payoutsStatus: PayoutsStatus;
  videoCount: number;
  createdAt: string;
};

export async function listAdminCreators(a: Actor): Promise<AdminCreatorRow[]> {
  requireAdminActor(a);
  const rows = await db
    .select({
      id: creatorProfile.id,
      handle: creatorProfile.handle,
      displayName: creatorProfile.displayName,
      email: user.email,
      payoutCurrency: creatorProfile.payoutCurrency,
      payoutsStatus: creatorProfile.payoutsStatus,
      // video_creator_status_published_idx leads with creator_id.
      videoCount: sql<number>`(select count(*)::int from ${video} v where v.creator_id = ${creatorProfile}.id)`,
      createdAt: creatorProfile.createdAt,
    })
    .from(creatorProfile)
    .innerJoin(user, eq(user.id, creatorProfile.userId))
    .orderBy(desc(creatorProfile.createdAt), desc(creatorProfile.id))
    .limit(LIMIT);
  return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
}

/** The Accounts tab (`?tab=connections`; 05 §1.5): Sync problem derived on the database's clock. */
export type AdminConnectionRow = {
  id: string;
  provider: SocialProviderId;
  /** Without "@"; null when the platform gives none. */
  username: string | null;
  ownerHandle: string;
  status: SocialAccountStatus;
  syncProblem: boolean;
  lastSyncedAt: string | null;
  /** A code only, e.g. "rate_limited". */
  lastSyncError: string | null;
  connectedAt: string;
  disconnectedAt: string | null;
};

export async function listAdminConnections(
  a: Actor,
): Promise<AdminConnectionRow[]> {
  requireAdminActor(a);
  const rows = await db
    .select({
      id: socialAccount.id,
      provider: socialAccount.provider,
      username: socialAccount.username,
      ownerHandle: creatorProfile.handle,
      ...CONNECTION_STATE_COLUMNS,
      connectedAt: socialAccount.connectedAt,
      disconnectedAt: socialAccount.disconnectedAt,
    })
    .from(socialAccount)
    .innerJoin(creatorProfile, eq(creatorProfile.id, socialAccount.creatorId))
    .orderBy(desc(socialAccount.createdAt), desc(socialAccount.id))
    .limit(LIMIT);
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    username: r.username,
    ownerHandle: r.ownerHandle,
    status: r.status,
    syncProblem: deriveConnectionState(r, r.now).syncProblem,
    lastSyncedAt: isoOrNull(r.lastSyncedAt),
    lastSyncError: r.lastSyncError,
    connectedAt: iso(r.connectedAt),
    disconnectedAt: isoOrNull(r.disconnectedAt),
  }));
}

/** The Videos tab (03 §7.9; 05 §7; 07 D89): postings "{n} · {m} verified", the waiting count Disable's sheet names. */
export type AdminVideoRow = {
  id: string;
  title: string;
  creatorHandle: string;
  /** The primary verified posting's platform ("Verified · Demo"), or null when none is verified. */
  verifiedPlatform: PostingPlatform | null;
  postingCount: number;
  verifiedPostingCount: number;
  status: VideoStatus;
  disabledReason: VideoDisabledReason | null;
  /** Admins only, never a creator page. */
  disabledNote: string | null;
  /** The video's awaiting_approval requests. */
  waitingCount: number;
  createdAt: string;
};

export async function listAdminVideos(a: Actor): Promise<AdminVideoRow[]> {
  requireAdminActor(a);
  const rows = await db
    .select({
      id: video.id,
      title: video.title,
      creatorHandle: creatorProfile.handle,
      // primaryVerifiedPosting's rule (07 D70): the verified source posting, else the lowest position.
      verifiedPlatform: sql<PostingPlatform | null>`(select p.platform from ${videoPosting} p where p.video_id = ${video}.id and p.verification = 'verified' order by p.is_source desc, p.position asc limit 1)`,
      // video_posting_video_position_uidx leads with video_id.
      postingCount: sql<number>`(select count(*)::int from ${videoPosting} p where p.video_id = ${video}.id)`,
      verifiedPostingCount: sql<number>`(select count(*)::int from ${videoPosting} p where p.video_id = ${video}.id and p.verification = 'verified')`,
      status: video.status,
      disabledReason: video.disabledReason,
      disabledNote: video.disabledNote,
      // license_request_video_status_idx.
      waitingCount: requestCounts.pendingCount,
      createdAt: video.createdAt,
    })
    .from(video)
    .innerJoin(creatorProfile, eq(creatorProfile.id, video.creatorId))
    .orderBy(desc(video.createdAt), desc(video.id))
    .limit(LIMIT);
  return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
}

/** The Requests tab (03 §7.9; 05 §7; 07 D47, D81, D94, D127): money in the request's own currency. */
export type AdminRequestRow = {
  id: string;
  licenseeName: string;
  /** The buyer's address (admins only, 07 D47). */
  buyerEmail: string;
  videoTitle: string;
  /** "Paid social ads · 1 year · Worldwide". */
  scope: string;
  exclusive: boolean;
  currency: Currency;
  licensePriceCents: number;
  platformFeeCents: number;
  amountTotalCents: number;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  status: LicenseRequestStatus;
  /** A waiting request a capture, decline or expiry claim holds: "Processing…" (07 D26). */
  claimed: boolean;
  statusReason: string | null;
  autoApprove: boolean;
  /** Auto-approve handed the request to its creator (07 D81). */
  autoApproveFellBack: boolean;
  /** The approval deadline, shown in the viewer's own zone (01 G.7). */
  expiresAt: string | null;
  createdAt: string;
};

export async function listAdminRequests(a: Actor): Promise<AdminRequestRow[]> {
  requireAdminActor(a);
  const rows = await db
    .select({
      id: licenseRequest.id,
      licenseeName: licenseRequest.licenseeName,
      buyerEmail: licenseRequest.buyerEmail,
      videoTitle: video.title,
      useKey: licenseRequest.useKey,
      termKey: licenseRequest.termKey,
      territoryKey: licenseRequest.territoryKey,
      territoryCode: licenseRequest.territoryCode,
      exclusive: licenseRequest.exclusive,
      currency: licenseRequest.currency,
      licensePriceCents: licenseRequest.licensePriceCents,
      platformFeeCents: licenseRequest.platformFeeCents,
      amountTotalCents: licenseRequest.amountTotalCents,
      stripeCheckoutSessionId: licenseRequest.stripeCheckoutSessionId,
      stripePaymentIntentId: licenseRequest.stripePaymentIntentId,
      stripeChargeId: licenseRequest.stripeChargeId,
      status: licenseRequest.status,
      paymentAction: licenseRequest.paymentAction,
      statusReason: licenseRequest.statusReason,
      autoApprove: licenseRequest.autoApprove,
      autoApproveFallbackAt: licenseRequest.autoApproveFallbackAt,
      expiresAt: licenseRequest.expiresAt,
      createdAt: licenseRequest.createdAt,
    })
    .from(licenseRequest)
    .innerJoin(video, eq(video.id, licenseRequest.videoId))
    .orderBy(desc(licenseRequest.createdAt), desc(licenseRequest.id))
    .limit(LIMIT);
  return rows.map((r) => ({
    id: r.id,
    licenseeName: r.licenseeName,
    buyerEmail: r.buyerEmail,
    videoTitle: r.videoTitle,
    scope: scopeLabel(r),
    exclusive: r.exclusive,
    currency: r.currency,
    licensePriceCents: r.licensePriceCents,
    platformFeeCents: r.platformFeeCents,
    amountTotalCents: r.amountTotalCents,
    stripeCheckoutSessionId: r.stripeCheckoutSessionId,
    stripePaymentIntentId: r.stripePaymentIntentId,
    stripeChargeId: r.stripeChargeId,
    status: r.status,
    // Finished rows keep their claim: only a waiting one is in flight.
    claimed: r.status === "awaiting_approval" && r.paymentAction !== null,
    statusReason: r.statusReason,
    autoApprove: r.autoApprove,
    autoApproveFellBack: r.autoApproveFallbackAt !== null,
    expiresAt: isoOrNull(r.expiresAt),
    createdAt: iso(r.createdAt),
  }));
}

/** A license's creator transfer as the Licenses tab prints it (05 §7 callout 7): never its Stripe id. */
export type AdminTransfer = {
  status: MoneyMovementStatus;
  amountCents: number;
  currency: Currency;
  /** A Stripe error code only. */
  lastError: string | null;
};

/** The Licenses tab (03 §7.9; 07 D16, D127): the status computed by the creator list's CASE, never stored. */
export type AdminLicenseRow = {
  id: string;
  code: string;
  licenseeName: string;
  videoTitle: string;
  status: RecordStatus;
  exclusive: boolean;
  /** license.created_at. */
  issuedAt: string;
  downloads: number;
  transfer: AdminTransfer | null;
  revokedAt: string | null;
};

export async function listAdminLicenses(a: Actor): Promise<AdminLicenseRow[]> {
  requireAdminActor(a);
  const rows = await db
    .select({
      id: license.id,
      code: license.code,
      licenseeName: licenseRequest.licenseeName,
      videoTitle: video.title,
      status: statusColumn,
      exclusive: license.exclusive,
      createdAt: license.createdAt,
      downloads: downloadsColumn,
      transferStatus: moneyMovement.status,
      transferAmountCents: moneyMovement.amountCents,
      transferCurrency: moneyMovement.currency,
      transferLastError: moneyMovement.lastError,
      revokedAt: license.revokedAt,
    })
    .from(license)
    .innerJoin(licenseRequest, eq(licenseRequest.id, license.licenseRequestId))
    .innerJoin(video, eq(video.id, license.videoId))
    // money_movement_request_kind_uidx: at most one transfer, so each license stays one row.
    .leftJoin(
      moneyMovement,
      and(
        eq(moneyMovement.licenseRequestId, license.licenseRequestId),
        eq(moneyMovement.kind, "creator_transfer"),
      ),
    )
    .orderBy(desc(license.createdAt), desc(license.id))
    .limit(LIMIT);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    licenseeName: r.licenseeName,
    videoTitle: r.videoTitle,
    status: r.status,
    exclusive: r.exclusive,
    issuedAt: iso(r.createdAt),
    downloads: r.downloads,
    transfer:
      r.transferStatus !== null &&
      r.transferAmountCents !== null &&
      r.transferCurrency !== null
        ? {
            status: r.transferStatus,
            amountCents: r.transferAmountCents,
            currency: r.transferCurrency,
            lastError: r.transferLastError,
          }
        : null,
    revokedAt: isoOrNull(r.revokedAt),
  }));
}

/** One audit_event row (02 §5; 07 D47): its data redacted when written, its system source in the actor cell. */
export type AdminAuditRow = {
  id: string;
  createdAt: string;
  action: string;
  actorType: AuditActorType;
  /** The acting user's sign-in address, when the actor is a user (07 D47). */
  actorEmail: string | null;
  /** A system actor's source ("auto_approve", "lazy"), else null. */
  actorSource: string | null;
  entityType: string;
  entityId: string;
  /** The row's data as JSON, without the source the actor cell shows. */
  details: string;
  /** One of ADMIN_EVENT_FLAGS: red, a warning icon and "Flagged" (design §4.9). */
  flagged: boolean;
};

/** A failed email_log row: never its recipient (design §4.9). */
export type AdminFailedEmailRow = {
  id: string;
  createdAt: string;
  template: string;
  entityType: string;
  entityId: string;
  attempts: number;
  error: string | null;
};

/** An unprocessed stripe_event row (03 §7.9; 07 D96). */
export type AdminStripeEventRow = {
  id: string;
  receivedAt: string;
  type: string;
  platformCurrency: Currency;
  /** The connected account, null for platform-scope events. */
  account: string | null;
  attempts: number;
  lastError: string | null;
};

/** The Events tab's three lists. */
export type AdminEvents = {
  audit: AdminAuditRow[];
  failedEmails: AdminFailedEmailRow[];
  stripeEvents: AdminStripeEventRow[];
};

export async function listAdminEvents(a: Actor): Promise<AdminEvents> {
  requireAdminActor(a);
  const [audit, failedEmails, stripeEvents] = await Promise.all([
    latestAudit(),
    failedEmailRows(),
    unprocessedStripeEvents(),
  ]);
  return { audit, failedEmails, stripeEvents };
}

/** audit_event_created_idx; the actor's email through user only. */
async function latestAudit(): Promise<AdminAuditRow[]> {
  const rows = await db
    .select({
      id: auditEvent.id,
      createdAt: auditEvent.createdAt,
      action: auditEvent.action,
      actorType: auditEvent.actorType,
      actorEmail: user.email,
      entityType: auditEvent.entityType,
      entityId: auditEvent.entityId,
      data: auditEvent.data,
    })
    .from(auditEvent)
    .leftJoin(user, eq(user.id, auditEvent.actorUserId))
    .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id))
    .limit(LIMIT);
  return rows.map((r) => {
    const { source, ...rest } = r.data;
    const actorSource = typeof source === "string" ? source : null;
    return {
      id: r.id,
      createdAt: iso(r.createdAt),
      action: r.action,
      actorType: r.actorType,
      actorEmail: r.actorEmail,
      actorSource,
      entityType: r.entityType,
      entityId: r.entityId,
      details: JSON.stringify(actorSource === null ? r.data : rest),
      flagged: isAdminEventFlag(r.action),
    };
  });
}

/** email_log_status_created_idx. */
async function failedEmailRows(): Promise<AdminFailedEmailRow[]> {
  const rows = await db
    .select({
      id: emailLog.id,
      createdAt: emailLog.createdAt,
      template: emailLog.template,
      entityType: emailLog.entityType,
      entityId: emailLog.entityId,
      attempts: emailLog.attempts,
      error: emailLog.error,
    })
    .from(emailLog)
    .where(eq(emailLog.status, "failed"))
    .orderBy(desc(emailLog.createdAt), desc(emailLog.id))
    .limit(LIMIT);
  return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
}

/** stripe_event_unprocessed_idx: newest received first. */
async function unprocessedStripeEvents(): Promise<AdminStripeEventRow[]> {
  const rows = await db
    .select({
      id: stripeEvent.id,
      receivedAt: stripeEvent.receivedAt,
      type: stripeEvent.type,
      platformCurrency: stripeEvent.platformCurrency,
      account: stripeEvent.account,
      attempts: stripeEvent.attempts,
      lastError: stripeEvent.lastError,
    })
    .from(stripeEvent)
    .where(isNull(stripeEvent.processedAt))
    .orderBy(desc(stripeEvent.receivedAt), desc(stripeEvent.id))
    .limit(LIMIT);
  return rows.map((r) => ({ ...r, receivedAt: iso(r.receivedAt) }));
}
