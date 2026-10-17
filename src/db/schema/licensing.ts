// src/db/schema/licensing.ts
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { LicenseSnapshotV1 } from "../../lib/licensing/snapshot"; // type-only, client-safe module
import { user } from "./auth";
import { createdAt, pk, tstz, updatedAt } from "./columns";
import {
  currencyEnum,
  downloadKindEnum,
  licenseRequestStatusEnum,
  licenseRevokedReasonEnum,
  moneyMovementKindEnum,
  moneyMovementStatusEnum,
  paymentActionEnum,
  rateOptionKeyEnum,
} from "./enums";
import { video } from "./video";

export const licenseRequest = pgTable(
  "license_request",
  {
    id: pk(), // app supplies the id: it is in Stripe idempotency keys, metadata and the success URL
    videoId: uuid("video_id").notNull(),
    creatorId: uuid("creator_id").notNull(), // denormalized for the inbox (FK-checked)
    status: licenseRequestStatusEnum("status")
      .notNull()
      .default("checkout_pending"),
    // Buyer (licensee_name is public on /verify; the rest is private)
    licenseeName: text("licensee_name").notNull(),
    contactName: text("contact_name").notNull(),
    buyerEmail: text("buyer_email").notNull(), // normalizeEmail (trim + lowercase) from P16a; CHECK in 0002 (DB22)
    intendedUse: text("intended_use"),
    buyerTimeZone: text("buyer_time_zone").notNull().default("UTC"), // IANA zone from the buyer's device at checkout (normalizeTimeZone); emails only (07 D84)
    buyerTokenHash: text("buyer_token_hash").notNull(), // sha256(token) lowercase hex; raw token never stored in plaintext (DB7)
    buyerTokenEnc: text("buyer_token_enc").notNull(), // encryptSecret(token, "license_request.buyer_token:<id>"); only for building email links
    // Scope
    useKey: rateOptionKeyEnum("use_key").notNull(),
    termKey: rateOptionKeyEnum("term_key").notNull(),
    territoryKey: rateOptionKeyEnum("territory_key").notNull(),
    territoryCode: text("territory_code"), // ISO 3166-1 alpha-2 | region key | null (worldwide)
    // Pricing snapshot (server-computed by computeQuote; never from the client). Every amount is in minor units of `currency`.
    currency: currencyEnum("currency").notNull(), // = creator_profile.payout_currency at insert (07 D94)
    basePriceCents: integer("base_price_cents").notNull(), // effective base: the per-video override, else the rate card (07 D82)
    useMultiplierBps: integer("use_multiplier_bps").notNull(),
    termMultiplierBps: integer("term_multiplier_bps").notNull(),
    territoryMultiplierBps: integer("territory_multiplier_bps").notNull(),
    platformFeeBps: integer("platform_fee_bps").notNull(), // env PLATFORM_FEE_BPS at creation
    platformFeeMinCents: integer("platform_fee_min_cents").notNull(), // PLATFORM_FEE_MIN_CENTS[currency] (200) at creation (07 D79, D97)
    licensePriceCents: integer("license_price_cents").notNull(),
    platformFeeCents: integer("platform_fee_cents").notNull(),
    amountTotalCents: integer("amount_total_cents").notNull(),
    // Terms acceptance evidence
    termsVersion: text("terms_version").notNull(), // "v1"
    termsAcceptedAt: tstz("terms_accepted_at").notNull(),
    termsAcceptedIp: inet("terms_accepted_ip"), // from x-forwarded-for; null if unknown
    termsAcceptedUserAgent: text("terms_accepted_user_agent"),
    // Creator settings snapshotted at checkout (buyer copy depends on them)
    approvalWindowHours: smallint("approval_window_hours").notNull(), // the creator's choice (24 · 48 · 72 · 120) at checkout (07 D81)
    autoApprove: boolean("auto_approve").notNull().default(false), // creator_profile.auto_approve at checkout (07 D81)
    autoApproveFallbackAt: tstz("auto_approve_fallback_at"), // auto-approve gave up → manual; request-new queued once
    // Stripe (a platform charge with manual capture on the platform account of `currency`; the creator is paid by a separate
    // transfer on the same account, 07 D74, D95)
    checkoutSubmissionId: uuid("checkout_submission_id").notNull(), // hidden form input per request; one request per submission (07 D31)
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    checkoutExpiresAt: tstz("checkout_expires_at").notNull(), // computed once (now + 60 min), reused on retries; renewal rows: = expires_at
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeChargeId: text("stripe_charge_id"), // source_transaction of the creator transfer (07 D74)
    authorizedAt: tstz("authorized_at"), // renewal rows: the payment time (T16)
    captureBefore: tstz("capture_before"), // charge.payment_method_details.card.capture_before; null on renewal rows (automatic capture)
    expiresAt: tstz("expires_at"), // min(authorized + window, capture_before − 6 h); renewal rows: the deadline (§3.7.2)
    paymentAction: paymentActionEnum("payment_action"), // single-row claim before calling Stripe
    paymentActionAt: tstz("payment_action_at"),
    stripeAttempt: integer("stripe_attempt").notNull().default(0), // incremented by every claim and pre-approval cancel; part of every capture/cancel key
    // Outcomes
    approvedAt: tstz("approved_at"),
    declinedAt: tstz("declined_at"),
    expiredAt: tstz("expired_at"),
    abandonedAt: tstz("abandoned_at"),
    captureFailedAt: tstz("capture_failed_at"),
    statusReason: text("status_reason"), // text, not an enum; values per status in §2 (07 §2.1)
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "license_request_video_fk",
      columns: [t.videoId, t.creatorId],
      foreignColumns: [video.id, video.creatorId],
    }).onDelete("restrict"),
    unique("license_request_id_video_creator_uq").on(
      t.id,
      t.videoId,
      t.creatorId,
    ), // composite-FK target
    uniqueIndex("license_request_buyer_token_hash_uidx").on(t.buyerTokenHash),
    uniqueIndex("license_request_checkout_submission_uidx").on(
      t.checkoutSubmissionId,
    ),
    uniqueIndex("license_request_checkout_session_uidx").on(
      t.stripeCheckoutSessionId,
    ),
    uniqueIndex("license_request_payment_intent_uidx").on(
      t.stripePaymentIntentId,
    ),
    uniqueIndex("license_request_charge_uidx").on(t.stripeChargeId),
    index("license_request_inbox_idx").on(t.creatorId, t.status, t.expiresAt),
    index("license_request_creator_created_idx").on(
      t.creatorId,
      t.createdAt.desc().nullsFirst(),
    ),
    index("license_request_video_status_idx").on(t.videoId, t.status),
    index("license_request_status_created_idx").on(
      t.status,
      t.createdAt.desc().nullsFirst(),
    ),
    index("license_request_due_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'awaiting_approval'`),
    index("license_request_checkout_due_idx")
      .on(t.checkoutExpiresAt)
      .where(sql`${t.status} = 'checkout_pending'`),
    // CHECK tiers per 07 D60: CORE = in a CORE migration (0000_init unless tagged 0001/0002/0003); [H1] = hardening migration H1.
    // Scope
    check(
      "license_request_use_key",
      sql`${t.useKey} in ('organic_social','paid_social','broadcast')`,
    ), // CORE
    check(
      "license_request_term_key",
      sql`${t.termKey} in ('d30','m6','y1','perpetual')`,
    ), // CORE
    check(
      "license_request_territory_key",
      sql`${t.territoryKey} in ('country','region','worldwide')`,
    ), // CORE
    check(
      "license_request_territory_code",
      sql`
    (${t.territoryKey} = 'worldwide' and ${t.territoryCode} is null) or
    (${t.territoryKey} = 'country' and ${t.territoryCode} ~ '^[A-Z]{2}$') or
    (${t.territoryKey} = 'region' and ${t.territoryCode} in
      ('north_america','latam_caribbean','europe','middle_east_africa','asia_pacific'))`,
    ), // CORE
    // Money
    check(
      "license_request_base_range",
      sql`${t.basePriceCents} between 1000 and 1000000`,
    ), // CORE
    check(
      "license_request_multiplier_range",
      sql`
    ${t.useMultiplierBps} between 10000 and 100000 and ${t.termMultiplierBps} between 10000 and 100000
    and ${t.territoryMultiplierBps} between 10000 and 100000`,
    ), // CORE
    check(
      "license_request_fee_bps_range",
      sql`${t.platformFeeBps} between 0 and 5000`,
    ), // CORE
    check(
      "license_request_fee_min_range",
      sql`${t.platformFeeMinCents} between 0 and 10000`,
    ), // CORE · 07 D79
    check(
      "license_request_money_nonneg",
      sql`${t.licensePriceCents} >= 0 and ${t.platformFeeCents} >= 0`,
    ), // CORE
    check(
      "license_request_total",
      sql`${t.amountTotalCents} = ${t.licensePriceCents} + ${t.platformFeeCents}
    and ${t.amountTotalCents} between 50 and 99999999`,
    ), // CORE · 02 MAX_TOTAL_CENTS[currency] (Stripe's 8-digit limit for CAD and USD, 07 D97)
    // Buyer + evidence
    check(
      "license_request_text_lengths",
      sql`
    char_length(${t.licenseeName}) between 1 and 120 and char_length(${t.contactName}) between 1 and 120
    and char_length(${t.buyerEmail}) between 3 and 254 and position('@' in ${t.buyerEmail}) > 1
    and (${t.intendedUse} is null or char_length(${t.intendedUse}) <= 200)
    and (${t.termsAcceptedUserAgent} is null or char_length(${t.termsAcceptedUserAgent}) <= 512)`,
    ), // CORE
    check(
      "license_request_buyer_time_zone_len",
      sql`char_length(${t.buyerTimeZone}) between 1 and 64`,
    ), // CORE · 07 D84
    // Buyer token and terms
    check(
      "license_request_token_hash_format",
      sql`${t.buyerTokenHash} ~ '^[0-9a-f]{64}$'`,
    ), // CORE
    check(
      "license_request_buyer_token_sealed",
      sql`${t.buyerTokenEnc} like 'v1.%'`,
    ), // CORE
    check(
      "license_request_terms_version",
      sql`${t.termsVersion} ~ '^v[0-9]+$'`,
    ), // CORE
    check(
      "license_request_approval_window",
      sql`${t.approvalWindowHours} in (24, 48, 72, 120)`,
    ), // CORE
    // Timing
    check(
      "license_request_expires_after_auth",
      sql`${t.expiresAt} is null or ${t.authorizedAt} is null or ${t.expiresAt} > ${t.authorizedAt}`,
    ), // CORE
    check(
      "license_request_hold_margin",
      sql`${t.expiresAt} is null or ${t.captureBefore} is null
    or ${t.expiresAt} <= ${t.captureBefore} - interval '6 hours'`,
    ), // CORE
  ],
);

export const license = pgTable(
  "license",
  {
    id: pk(),
    licenseRequestId: uuid("license_request_id").notNull(),
    videoId: uuid("video_id").notNull(),
    creatorId: uuid("creator_id").notNull(),
    code: text("code").notNull(), // CL-XXXX-XXXX, Crockford base32, CSPRNG (07 D101); every renewal term has its own code
    // no status column: status = publicStatus({ revokedAt, startsAt, endsAt }, now) everywhere (07 D16, D117)
    termsVersion: text("terms_version").notNull(),
    startsAt: tstz("starts_at").notNull(), // = approved_at = payment_action_at of the capture claim (07 D33); a renewal term:
    //   the renewed term's ends_at (auto, manual) or payment time during a reservation (07 D120, D122)
    endsAt: tstz("ends_at"), // null = perpetual (never exclusive); UTC computeEndsAt; renewal terms computeEndsAt(startsAt, the chain's term_key) (07 D133)
    snapshot: jsonb("snapshot").$type<LicenseSnapshotV1>().notNull(), // immutable; PDF, /l and /verify render only from this
    originalObjectKey: text("original_object_key").notNull(), // DB13: copied from video at issue
    originalBytes: bigint("original_bytes", { mode: "number" }).notNull(),
    originalMime: text("original_mime").notNull(),
    // PDF is rendered on demand from snapshot; pdf_object_key, pdf_sha256, pdf_generated_at are [H6] (07 D17)
    revokedAt: tstz("revoked_at"),
    revokedReason: licenseRevokedReasonEnum("revoked_reason"),
    revokedNote: text("revoked_note"), // admin-only, never public
    revokedByUserId: text("revoked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(), // = issued_at
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "license_request_fk",
      columns: [t.licenseRequestId, t.videoId, t.creatorId],
      foreignColumns: [
        licenseRequest.id,
        licenseRequest.videoId,
        licenseRequest.creatorId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("license_license_request_uidx").on(t.licenseRequestId), // request → license is 1:1
    uniqueIndex("license_code_uidx").on(t.code),
    index("license_creator_created_idx").on(
      t.creatorId,
      t.createdAt.desc().nullsFirst(),
    ),
    index("license_video_idx").on(t.videoId),
    check(
      "license_code_format",
      sql`${t.code} ~ '^CL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'`,
    ), // CORE · 07 D101
    check("license_terms_version", sql`${t.termsVersion} ~ '^v[0-9]+$'`), // CORE
    check(
      "license_dates",
      sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`,
    ), // CORE
    check(
      "license_revoked_fields",
      sql`(${t.revokedAt} is null) = (${t.revokedReason} is null)`,
    ), // CORE
    check(
      "license_object_keys",
      sql`${t.originalObjectKey} like 'originals/%'`,
    ), // CORE
  ],
);

// Every post-approval money step (07 D75, D86). Claim → Stripe call outside any transaction → fenced finish (§5.5).
// Never changes license_request.status or the license. Kept until OQ-27 is decided (07 D87).
export const moneyMovement = pgTable(
  "money_movement",
  {
    id: pk(),
    licenseRequestId: uuid("license_request_id")
      .notNull()
      .references(() => licenseRequest.id, { onDelete: "restrict" }),
    kind: moneyMovementKindEnum("kind").notNull(), // creator_transfer | buyer_refund | transfer_reversal
    status: moneyMovementStatusEnum("status").notNull().default("pending"),
    currency: currencyEnum("currency").notNull(), // = its license_request.currency (I33)
    amountCents: integer("amount_cents").notNull(), // minor units of currency. transfer = license_price_cents (a renewal row: the
    //   renewal license price); refund = amount_total_cents; reversal = the transferred amount
    stripeObjectId: text("stripe_object_id"), // tr_… · re_… · trr_… (fake driver: tr_fake_ · re_fake_ · trr_fake_)
    attempt: integer("attempt").notNull().default(0), // + 1 on every claim; part of the idempotency key
    claimedAt: tstz("claimed_at"), // claim and fence value (2 min lease)
    lastError: text("last_error"), // Stripe error code only
    succeededAt: tstz("succeeded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("money_movement_request_kind_uidx").on(
      t.licenseRequestId,
      t.kind,
    ), // one movement per kind per request
    uniqueIndex("money_movement_stripe_object_uidx").on(t.stripeObjectId), // NULLs are distinct
    index("money_movement_status_idx").on(t.status, t.updatedAt), // sweep, admin Events (failed)
    check("money_movement_amount_positive", sql`${t.amountCents} > 0`), // CORE
    check(
      "money_movement_succeeded_fields",
      sql`${t.status} <> 'succeeded' or
    (${t.stripeObjectId} is not null and ${t.succeededAt} is not null)`,
    ), // CORE
  ],
);

export const downloadEvent = pgTable(
  "download_event",
  {
    id: pk(),
    licenseId: uuid("license_id")
      .notNull()
      .references(() => license.id, { onDelete: "restrict" }),
    kind: downloadKindEnum("kind").notNull(),
    ip: inet("ip"), // raw inet: chargeback evidence (07 D47)
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("download_event_license_created_idx").on(
      t.licenseId,
      t.createdAt.desc().nullsFirst(),
    ),
    check(
      "download_event_ua_len",
      sql`${t.userAgent} is null or char_length(${t.userAgent}) <= 512`,
    ), // CORE
  ],
);
