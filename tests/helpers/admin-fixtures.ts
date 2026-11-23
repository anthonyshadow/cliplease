// The admin loaders' rows as the page gets them (src/server/admin/queries.ts), for the admin view's unit tests.
import type { AdminLicenseAction } from "@/app/admin/_components/license-row-action";
import type { AdminVideoAction } from "@/app/admin/_components/video-row-action";
import type { VideoStatus } from "@/lib/domain/values";
import type {
  AdminAuditRow,
  AdminConnectionRow,
  AdminCreatorRow,
  AdminEvents,
  AdminFailedEmailRow,
  AdminFailedMovementRow,
  AdminLicenseRow,
  AdminRequestRow,
  AdminStripeEventRow,
  AdminVideoRow,
} from "@/server/admin/queries";

export const CREATED_AT = "2026-11-02T14:32:00.000Z";
/** CREATED_AT as every admin time but a deadline prints it (UTC). */
export const CREATED_TEXT = "2 Nov 2026, 14:32 UTC";

export const CREATOR: AdminCreatorRow = {
  id: "c0000000-0000-4000-8000-000000000001",
  handle: "maya",
  displayName: "Maya Reyes",
  email: "maya@example.com",
  payoutCurrency: "cad",
  payoutsStatus: "active",
  videoCount: 3,
  createdAt: CREATED_AT,
};

export const CONNECTION: AdminConnectionRow = {
  id: "a0000000-0000-4000-8000-000000000001",
  provider: "mock",
  username: "demo.creator",
  ownerHandle: "maya",
  status: "connected",
  syncProblem: false,
  lastSyncedAt: CREATED_AT,
  lastSyncError: null,
  connectedAt: CREATED_AT,
  disconnectedAt: null,
};

export const LIVE_VIDEO: AdminVideoRow = {
  id: "v0000000-0000-4000-8000-000000000001",
  title: "First snow",
  creatorHandle: "maya",
  verifiedPlatform: "mock",
  postingCount: 3,
  verifiedPostingCount: 2,
  status: "published",
  disabledReason: null,
  disabledNote: null,
  waitingCount: 2,
  createdAt: CREATED_AT,
};

/** A Videos row's action: LIVE_VIDEO's id and title, with `status` and its waiting requests. */
export const video = (
  status: VideoStatus = "published",
  waitingCount = 2,
): AdminVideoAction => ({
  id: LIVE_VIDEO.id,
  title: LIVE_VIDEO.title,
  status,
  waitingCount,
});

export const DISABLED_VIDEO: AdminVideoRow = {
  ...LIVE_VIDEO,
  id: "v0000000-0000-4000-8000-000000000002",
  title: "Rooftop storm timelapse",
  verifiedPlatform: null,
  postingCount: 2,
  verifiedPostingCount: 0,
  status: "disabled",
  disabledReason: "rights_claim",
  disabledNote: "ticket-4821",
  waitingCount: 0,
};

export const WAITING_REQUEST: AdminRequestRow = {
  id: "r0000000-0000-4000-8000-000000000001",
  licenseeName: "Daily Laughs Media LLC",
  buyerEmail: "ana@studio.com",
  videoTitle: "First snow",
  scope: "Paid social ads · 1 year · Worldwide",
  exclusive: true,
  currency: "cad",
  licensePriceCents: 157500,
  platformFeeCents: 15750,
  amountTotalCents: 173250,
  stripeCheckoutSessionId: "cs_test_a1B2c3D4e5F6g7H8",
  stripePaymentIntentId: "pi_3QfKx2eZvKYlo2C0",
  stripeChargeId: "ch_3QfKx2eZvKYlo2C0",
  status: "awaiting_approval",
  claimed: false,
  statusReason: null,
  autoApprove: true,
  autoApproveFellBack: false,
  expiresAt: "2026-11-19T22:00:00.000Z",
  createdAt: CREATED_AT,
};

export const DECLINED_REQUEST: AdminRequestRow = {
  ...WAITING_REQUEST,
  id: "r0000000-0000-4000-8000-000000000002",
  licenseeName: "Morning Show Inc.",
  exclusive: false,
  status: "declined",
  statusReason: "video_disabled",
  autoApproveFellBack: true,
  stripeChargeId: null,
};

export const VALID_LICENSE: AdminLicenseRow = {
  id: "l0000000-0000-4000-8000-000000000001",
  code: "CL-7K3M-9QXA",
  licenseeName: "Daily Laughs Media LLC",
  videoTitle: "First snow",
  creatorHandle: "maya",
  status: "valid",
  exclusive: true,
  issuedAt: CREATED_AT,
  downloads: 2,
  licensePriceCents: 157500,
  amountTotalCents: 173250,
  currency: "cad",
  transfer: {
    id: "t0000000-0000-4000-8000-000000000001",
    status: "succeeded",
    amountCents: 157500,
    lastError: null,
  },
  refund: null,
  reversal: null,
  revokedAt: null,
  revokedReason: null,
};

export const FAILED_TRANSFER_LICENSE: AdminLicenseRow = {
  ...VALID_LICENSE,
  id: "l0000000-0000-4000-8000-000000000002",
  code: "CL-9P2D-6HNC",
  exclusive: false,
  downloads: 0,
  licensePriceCents: 90000,
  amountTotalCents: 99000,
  transfer: {
    id: "t0000000-0000-4000-8000-000000000002",
    status: "failed",
    amountCents: 90000,
    lastError: "account_closed",
  },
};

/** VALID_LICENSE revoked (Issued in error), its refund and take-back done: D99's "Refunded … · Taken back …". */
export const REFUNDED_LICENSE: AdminLicenseRow = {
  ...VALID_LICENSE,
  id: "l0000000-0000-4000-8000-000000000003",
  code: "CL-4F8T-2WRB",
  status: "revoked",
  refund: {
    id: "f0000000-0000-4000-8000-000000000003",
    status: "succeeded",
    amountCents: 173250,
    lastError: null,
  },
  reversal: {
    id: "b0000000-0000-4000-8000-000000000003",
    status: "succeeded",
    amountCents: 157500,
    lastError: null,
  },
  revokedAt: CREATED_AT,
  revokedReason: "issued_in_error",
};

/** A revoked license whose refund and take-back both failed: two Retries. */
export const FAILED_RETURNS_LICENSE: AdminLicenseRow = {
  ...REFUNDED_LICENSE,
  id: "l0000000-0000-4000-8000-000000000004",
  code: "CL-2B7Q-K9WD",
  refund: {
    id: "f0000000-0000-4000-8000-000000000004",
    status: "failed",
    amountCents: 173250,
    lastError: "charge_disputed",
  },
  reversal: {
    id: "b0000000-0000-4000-8000-000000000004",
    status: "failed",
    amountCents: 157500,
    lastError: "insufficient_funds",
  },
  revokedReason: "rights_claim",
};

/** A license's Revoke, from VALID_LICENSE with `transferStatus` (succeeded unless given). */
export const licenseAction = (
  transferStatus: AdminLicenseAction["transferStatus"] = "succeeded",
): AdminLicenseAction => ({
  id: VALID_LICENSE.id,
  code: VALID_LICENSE.code,
  creatorHandle: VALID_LICENSE.creatorHandle,
  licensePriceCents: VALID_LICENSE.licensePriceCents,
  amountTotalCents: VALID_LICENSE.amountTotalCents,
  currency: VALID_LICENSE.currency,
  transferStatus,
});

/** A failed take-back in Events' failed-movements list. */
export const FAILED_MOVEMENT: AdminFailedMovementRow = {
  id: "b0000000-0000-4000-8000-000000000004",
  kind: "transfer_reversal",
  licenseCode: "CL-2B7Q-K9WD",
  creatorHandle: "maya",
  amountCents: 157500,
  currency: "cad",
  attempt: 2,
  lastError: "insufficient_funds",
  updatedAt: CREATED_AT,
};

export const AUDIT_ROW: AdminAuditRow = {
  id: "e0000000-0000-4000-8000-000000000001",
  createdAt: CREATED_AT,
  action: "video.enabled",
  actorType: "admin",
  actorEmail: "owner@example.com",
  actorSource: null,
  entityType: "video",
  entityId: LIVE_VIDEO.id,
  details: '{"previousReason":"other"}',
  flagged: false,
};

export const FLAGGED_AUDIT_ROW: AdminAuditRow = {
  ...AUDIT_ROW,
  id: "e0000000-0000-4000-8000-000000000002",
  action: "license_request.exclusive_conflict",
  actorType: "system",
  actorEmail: null,
  actorSource: "auto_approve",
  entityType: "license_request",
  entityId: WAITING_REQUEST.id,
  details: '{"exclusive":true}',
  flagged: true,
};

export const FAILED_EMAIL: AdminFailedEmailRow = {
  id: "m0000000-0000-4000-8000-000000000001",
  createdAt: CREATED_AT,
  template: "request-declined",
  entityType: "license_request",
  entityId: WAITING_REQUEST.id,
  attempts: 3,
  error: "SmtpError",
};

export const STRIPE_EVENT: AdminStripeEventRow = {
  id: "evt_1QfKx2eZvKYlo2C0aBcDeF",
  receivedAt: CREATED_AT,
  type: "payment_intent.amount_capturable_updated",
  platformCurrency: "cad",
  account: null,
  attempts: 1,
  lastError: "timeout",
};

export const EVENTS: AdminEvents = {
  audit: [AUDIT_ROW, FLAGGED_AUDIT_ROW],
  failedMovements: [FAILED_MOVEMENT],
  failedEmails: [FAILED_EMAIL],
  stripeEvents: [],
};
