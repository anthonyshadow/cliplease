// src/db/schema/video.ts
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, tstz, updatedAt } from "./columns";
import { creatorProfile } from "./creator";
import {
  originalFileStatusEnum,
  posterOriginEnum,
  postingPlatformEnum,
  postingUnverifiedReasonEnum,
  postingVerificationEnum,
  rateOptionKeyEnum,
  videoDisabledReasonEnum,
  videoOwnershipEnum,
  videoSourceEnum,
  videoStatusEnum,
} from "./enums";
import { socialAccount, socialPost } from "./social";

export const video = pgTable(
  "video",
  {
    id: pk(), // app supplies crypto.randomUUID(): object keys include it
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfile.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    status: videoStatusEnum("status").notNull().default("draft"),
    source: videoSourceEnum("source").notNull(), // 'library' (made licensable from a Library post) | 'upload'
    ownership: videoOwnershipEnum("ownership").notNull(), // stored summary: 'verified_owner' iff ≥ 1 verified posting (07 D66)
    // Where it was posted: the rows live in video_posting (07 D65); no denormalized copy here
    postingsConfirmedAt: tstz("postings_confirmed_at"), // "Where was it posted?" saved (also with zero rows: "not posted yet")
    sameVideoConfirmedAt: tstz("same_video_confirmed_at"), // "These posts show this same video" (needed when ≥ 1 posting is verified, 07 D69)
    // Rights attestation (license.md §7) — null = not answered yet
    containsMusic: boolean("contains_music"),
    identifiablePeople: boolean("identifiable_people"),
    rightsAttestedAt: tstz("rights_attested_at"),
    attestationVersion: text("attestation_version"), // "v1"
    // Pricing overrides (CORE, 07 D82)
    basePriceOverrideCents: integer("base_price_override_cents"), // in the creator's payout_currency; null = use the rate card; setVideoBasePrice; new requests only
    disabledUses: rateOptionKeyEnum("disabled_uses")
      .array()
      .notNull()
      .default(sql`'{}'`), // music → paid_social, broadcast;
    //   setVideoUseEnabled re-enables either (07 D82)
    // Original file (private bucket; keys only; always the creator's upload, never imported — 07 D64)
    originalStatus: originalFileStatusEnum("original_status")
      .notNull()
      .default("none"),
    originalObjectKey: text("original_object_key"), // server-generated at upload start; ready after HEAD size + magic-byte check
    originalUploadId: text("original_upload_id"), // multipart upload id while uploading (07 D80); cleared on ready, abort, expiry
    originalPartBytes: integer("original_part_bytes"), // PART_BYTES (16 MiB) fixed at start
    originalUploadStartedAt: tstz("original_upload_started_at"), // resume allowed < UPLOAD_RESUME_WINDOW_MS (24 h) after this
    // [H3]: original_pending_key (replacing a published original) is not in CORE (07 D09, D91)
    originalBytes: bigint("original_bytes", { mode: "number" }), // declared size while uploading, verified size when ready (≤ 2 GiB)
    originalMime: text("original_mime"),
    originalFilename: text("original_filename"), // creator's filename, display only; never used in keys
    originalError: text("original_error"), // code, e.g. "size_mismatch", "upload_expired"
    originalUpdatedAt: tstz("original_updated_at"),
    durationMs: integer("duration_ms"), // browser-read hints, never trusted for money
    width: integer("width"),
    height: integer("height"),
    posterObjectKey: text("poster_object_key"),
    posterOrigin: posterOriginEnum("poster_origin"),
    publishedAt: tstz("published_at"), // first publish
    disabledAt: tstz("disabled_at"),
    disabledReason: videoDisabledReasonEnum("disabled_reason"), // admin picks it; the creator sees only the label
    disabledNote: text("disabled_note"), // admin-only (≤ 200 in Zod), never shown to the creator
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("video_creator_slug_uidx").on(t.creatorId, t.slug),
    unique("video_id_creator_uq").on(t.id, t.creatorId), // composite-FK target (license_request, video_posting)
    index("video_creator_status_published_idx").on(
      t.creatorId,
      t.status,
      t.publishedAt.desc().nullsFirst(),
    ),
    check(
      "video_slug_format",
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) <= 60`,
    ), // CORE
    check("video_title_len", sql`char_length(${t.title}) between 1 and 100`), // CORE
    check(
      "video_price_override_range",
      sql`${t.basePriceOverrideCents} is null or
    (${t.basePriceOverrideCents} between 1000 and 1000000 and ${t.basePriceOverrideCents} % 100 = 0)`,
    ), // CORE · whole dollars in the creator's `payout_currency` (bounds equal in CAD and USD)
    check(
      "video_disabled_uses_subset",
      sql`${t.disabledUses} <@ array['organic_social','paid_social','broadcast']::rate_option_key[]`,
    ), // CORE
    check(
      "video_object_keys",
      sql`
    (${t.originalObjectKey} is null or ${t.originalObjectKey} like 'originals/%') and
    (${t.posterObjectKey} is null or ${t.posterObjectKey} like 'posters/%')`,
    ), // CORE
    check(
      "video_original_ready",
      sql`${t.originalStatus} <> 'ready' or
    (${t.originalObjectKey} is not null and ${t.originalBytes} > 0
      and ${t.originalMime} in ('video/mp4','video/quicktime'))`,
    ), // CORE
    check(
      "video_published_requirements",
      sql`${t.status} <> 'published' or (
    ${t.originalStatus} = 'ready' and ${t.rightsAttestedAt} is not null and ${t.attestationVersion} is not null
    and ${t.containsMusic} is not null and ${t.identifiablePeople} is not null and ${t.publishedAt} is not null
    and ${t.posterObjectKey} is not null and ${t.postingsConfirmedAt} is not null)`,
    ), // CORE
  ],
);

// One row per place the video was originally posted (07 D65). Written only by createVideoFromPost, saveVideoPostings,
// recheckPosting, adminSetVideoDisabled and the seed, each followed by refreshVideoOwnership in the same transaction (07 D66).
export const videoPosting = pgTable(
  "video_posting",
  {
    id: pk(),
    videoId: uuid("video_id").notNull(),
    creatorId: uuid("creator_id").notNull(), // denormalized (FK-checked): composite FKs below
    platform: postingPlatformEnum("platform").notNull(),
    otherLabel: text("other_label"), // platform 'other' only: the creator's name for it (1–40)
    url: text("url"), // canonical URL rebuilt by parsePostingLink, never the raw paste; null = posted, no link
    linkKey: text("link_key"), // normalized post id: IG shortcode, TikTok/YouTube video id, X status id,
    //   Snapchat spotlight id, Facebook video/reel id or {page}/{postId}, mock post id;
    //   null for 'other' and link-less rows
    verification: postingVerificationEnum("verification").notNull(),
    unverifiedReason: postingUnverifiedReasonEnum("unverified_reason"), // null iff verified
    isSource: boolean("is_source").notNull().default(false), // the locked Library posting created by createVideoFromPost
    socialAccountId: uuid("social_account_id").references(
      () => socialAccount.id,
      { onDelete: "restrict" },
    ),
    socialPostId: uuid("social_post_id"), // composite FK below; kept on a released row for audit
    verifiedUsername: text("verified_username"), // display form shown after "Verified · " (07 D43): "@handle" or the channel title
    verifiedAccountLinkedAt: tstz("verified_account_linked_at"), // social_account.connected_at at verification
    verifiedAt: tstz("verified_at"),
    checkedAt: tstz("checked_at"), // last verification attempt (Check again)
    showLink: boolean("show_link").notNull().default(true), // the creator's direction to show buyers the link (07 D18 per posting);
    //   default false for an unlisted YouTube post
    position: smallint("position").notNull(), // 0 = the source posting; others 1…n in the creator's order
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "video_posting_video_fk",
      columns: [t.videoId, t.creatorId],
      foreignColumns: [video.id, video.creatorId],
    }).onDelete("cascade"), // a deleted draft takes its postings with it
    foreignKey({
      name: "video_posting_social_post_fk",
      columns: [t.socialPostId, t.creatorId],
      foreignColumns: [socialPost.id, socialPost.creatorId],
    }).onDelete("restrict"), // referenced posts can never be deleted (I5)
    uniqueIndex("video_posting_video_position_uidx").on(t.videoId, t.position),
    uniqueIndex("video_posting_video_link_uidx")
      .on(t.videoId, t.platform, t.linkKey)
      .where(sql`${t.linkKey} is not null`), // the same post once per video
    uniqueIndex("video_posting_verified_uidx")
      .on(t.platform, t.linkKey)
      .where(sql`${t.verification} = 'verified'`), // one verified posting per platform post, all creators (DB14)
    uniqueIndex("video_posting_source_uidx")
      .on(t.videoId)
      .where(sql`${t.isSource} = true`),
    index("video_posting_link_idx").on(t.platform, t.linkKey), // cross-creator check, incl. unverified rows (07 D68)
    index("video_posting_social_post_idx").on(t.socialPostId), // Library "already licensable", purge/disconnect reference checks
    check(
      "video_posting_other_label",
      sql`(${t.platform} = 'other') = (${t.otherLabel} is not null)
    and (${t.otherLabel} is null or char_length(${t.otherLabel}) between 1 and 40)`,
    ), // CORE
    check(
      "video_posting_url_shape",
      sql`${t.url} is null or (${t.url} like 'https://%' and char_length(${t.url}) <= 2048)`,
    ), // CORE
    check(
      "video_posting_link_key",
      sql`
    (${t.platform} = 'other' and ${t.linkKey} is null)
    or (${t.platform} <> 'other' and (${t.url} is null) = (${t.linkKey} is null))`,
    ), // CORE
    check(
      "video_posting_reason",
      sql`(${t.verification} = 'verified') = (${t.unverifiedReason} is null)`,
    ), // CORE
    check(
      "video_posting_verified_fields",
      sql`${t.verification} <> 'verified' or (
    ${t.platform} in ('instagram','tiktok','youtube','mock') and ${t.linkKey} is not null
    and ${t.socialAccountId} is not null and ${t.socialPostId} is not null and ${t.verifiedUsername} is not null
    and ${t.verifiedAccountLinkedAt} is not null and ${t.verifiedAt} is not null)`,
    ), // CORE
    check(
      "video_posting_unverifiable",
      sql`${t.platform} in ('instagram','tiktok','youtube','mock')
    or ${t.verification} = 'unverified'`,
    ), // CORE · facebook, x, snapchat, other are never verified
  ],
);
