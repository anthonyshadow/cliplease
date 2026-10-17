// src/db/schema/social.ts
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, tstz, updatedAt } from "./columns";
import { creatorProfile } from "./creator";
import {
  socialAccountStatusEnum,
  socialPostMediaTypeEnum,
  socialPostStatusEnum,
  socialPostVisibilityEnum,
  socialProviderEnum,
} from "./enums";

export const socialAccount = pgTable(
  "social_account",
  {
    id: pk(), // app supplies crypto.randomUUID() on insert: it is part of the token AAD
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfile.id, { onDelete: "cascade" }),
    provider: socialProviderEnum("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(), // IG user_id (string), TikTok open_id, YouTube channel id, mock id
    username: text("username"), // without "@"; YouTube: customUrl minus "@", else null
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"), // hotlink only (may expire); shown only to the creator
    profileUrl: text("profile_url"),
    accountType: text("account_type"), // IG: "Business" | "Media_Creator"
    status: socialAccountStatusEnum("status").notNull().default("connected"),
    scopes: text("scopes").array().notNull().default(sql`'{}'`),
    // Sealed with encryptSecret(): "v1.<kid>.<iv>.<tag>.<ct>", AAD "social_account.access_token:<id>" / ".refresh_token:<id>"
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"), // null for Instagram (no refresh token)
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    tokenRefreshedAt: tstz("token_refreshed_at"), // set on connect and every refresh; IG refresh needs >= 24 h
    connectedAt: tstz("connected_at").notNull().defaultNow(), // last successful (re)connect; snapshotted onto verified postings
    disconnectedAt: tstz("disconnected_at"),
    lastSyncedAt: tstz("last_synced_at"),
    hasOlder: boolean("has_older").notNull().default(false), // set by every run: true when it stopped before nextCursor was null ("Load older videos", 07 D13)
    syncStartedAt: tstz("sync_started_at"), // single-flight marker (2 min lease)
    syncBlockedUntil: tstz("sync_blocked_until"), // rate-limit backoff
    lastSyncError: text("last_sync_error"), // code only, e.g. "rate_limited" — never a token or URL
    lastSyncErrorAt: tstz("last_sync_error_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Reconnects by the same creator reuse the row (keeps posting → account and post references stable).
    uniqueIndex("social_account_creator_provider_account_uidx").on(
      t.creatorId,
      t.provider,
      t.providerAccountId,
    ),
    // One live ClipLease owner per platform account (social.md §6.4). Disconnected rows don't count.
    uniqueIndex("social_account_live_provider_account_uidx")
      .on(t.provider, t.providerAccountId)
      .where(sql`${t.status} <> 'disconnected'`),
    unique("social_account_id_creator_provider_uq").on(
      t.id,
      t.creatorId,
      t.provider,
    ), // composite-FK target
    check(
      "social_account_tokens_sealed",
      sql`
    (${t.accessTokenEnc} is null or ${t.accessTokenEnc} like 'v1.%') and
    (${t.refreshTokenEnc} is null or ${t.refreshTokenEnc} like 'v1.%')`,
    ), // CORE
    // needs_reconnect rows may hold no token: the purge cron wipes them after 30 days (07 D47, §9.2)
    check(
      "social_account_live_has_token",
      sql`${t.status} <> 'connected' or ${t.accessTokenEnc} is not null`,
    ), // CORE
    check(
      "social_account_disconnected_clean",
      sql`${t.status} <> 'disconnected' or
    (${t.accessTokenEnc} is null and ${t.refreshTokenEnc} is null and ${t.disconnectedAt} is not null)`,
    ), // CORE
  ],
);

export const socialPost = pgTable(
  "social_post",
  {
    id: pk(),
    socialAccountId: uuid("social_account_id").notNull(),
    creatorId: uuid("creator_id").notNull(), // denormalized for Library queries (FK-checked below)
    provider: socialProviderEnum("provider").notNull(), // denormalized for the platform filter (FK-checked)
    providerPostId: text("provider_post_id").notNull(),
    mediaType: socialPostMediaTypeEnum("media_type").notNull(),
    status: socialPostStatusEnum("status").notNull().default("available"),
    title: text("title"), // YouTube/TikTok title
    caption: text("caption"), // IG caption, TikTok description, YouTube description (≤ 500 chars)
    permalink: text("permalink").notNull(), // mock: https://example.com/mock/{provider_post_id} (07 D68)
    linkKey: text("link_key").notNull(), // id a pasted link is matched on (07 D68): IG shortcode (from `shortcode`,
    //   else parsed from permalink); TikTok/YouTube/mock = provider_post_id.
    //   Written by every sync; the stale scrub keeps it.
    thumbnailUrl: text("thumbnail_url"), // platform CDN; hotlinked/proxied for the creator only
    thumbnailFetchedAt: tstz("thumbnail_fetched_at"),
    thumbnailExpiresAt: tstz("thumbnail_expires_at"), // TikTok fetched+5h55m; IG fetched+24h (assumption); else null
    postedAt: tstz("posted_at"), // null only on stale rows (scrubbed, 07 D47)
    durationSec: integer("duration_sec"), // null for Instagram
    width: integer("width"),
    height: integer("height"),
    viewCount: bigint("view_count", { mode: "number" }), // bigint: YouTube views can exceed int4; Instagram only while the optional
    //   insights scope is in social_account.scopes, else null (07 D83); creator-only
    likeCount: bigint("like_count", { mode: "number" }),
    commentCount: bigint("comment_count", { mode: "number" }),
    shareCount: bigint("share_count", { mode: "number" }),
    visibility: socialPostVisibilityEnum("visibility"),
    fetchedAt: tstz("fetched_at").notNull(), // last time a sync saw it (30-day rule, §9)
    removedAt: tstz("removed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "social_post_account_fk",
      columns: [t.socialAccountId, t.creatorId, t.provider],
      foreignColumns: [
        socialAccount.id,
        socialAccount.creatorId,
        socialAccount.provider,
      ],
    }).onDelete("cascade"),
    uniqueIndex("social_post_account_post_uidx").on(
      t.socialAccountId,
      t.providerPostId,
    ), // sync upsert target
    unique("social_post_id_creator_uq").on(t.id, t.creatorId), // composite-FK target
    index("social_post_library_idx")
      .on(t.creatorId, t.postedAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`${t.status} = 'available'`),
    index("social_post_library_provider_idx")
      .on(
        t.creatorId,
        t.provider,
        t.postedAt.desc().nullsFirst(),
        t.id.desc().nullsFirst(),
      )
      .where(sql`${t.status} = 'available'`),
    index("social_post_library_account_idx") // ?account= (07 D48)
      .on(
        t.creatorId,
        t.socialAccountId,
        t.postedAt.desc().nullsFirst(),
        t.id.desc().nullsFirst(),
      )
      .where(sql`${t.status} = 'available'`),
    index("social_post_fetched_at_idx").on(t.fetchedAt), // 30-day purge
    index("social_post_link_key_idx").on(t.creatorId, t.provider, t.linkKey), // posting verification by DB match (07 D68)
  ],
);
