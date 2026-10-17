CREATE TYPE "public"."audit_actor_type" AS ENUM('creator', 'admin', 'buyer', 'system', 'stripe', 'cron');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('cad', 'usd');--> statement-breakpoint
CREATE TYPE "public"."download_kind" AS ENUM('original', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."license_request_status" AS ENUM('checkout_pending', 'awaiting_approval', 'approved', 'declined', 'expired', 'abandoned', 'capture_failed', 'renewal_pending', 'renewal_canceled', 'renewal_failed');--> statement-breakpoint
CREATE TYPE "public"."license_revoked_reason" AS ENUM('rights_claim', 'licensee_breach', 'payment_reversed', 'issued_in_error');--> statement-breakpoint
CREATE TYPE "public"."money_movement_kind" AS ENUM('creator_transfer', 'buyer_refund', 'transfer_reversal');--> statement-breakpoint
CREATE TYPE "public"."money_movement_status" AS ENUM('pending', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."original_file_status" AS ENUM('none', 'uploading', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_action" AS ENUM('capture', 'decline', 'expire', 'renewal_charge', 'renewal_checkout');--> statement-breakpoint
CREATE TYPE "public"."payouts_status" AS ENUM('not_started', 'pending', 'restricted', 'active', 'rejected', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."poster_origin" AS ENUM('frame_capture', 'creator_image');--> statement-breakpoint
CREATE TYPE "public"."posting_platform" AS ENUM('instagram', 'tiktok', 'youtube', 'facebook', 'x', 'snapchat', 'other', 'mock');--> statement-breakpoint
CREATE TYPE "public"."posting_unverified_reason" AS ENUM('not_found', 'no_account', 'check_failed', 'unverifiable', 'no_link', 'released');--> statement-breakpoint
CREATE TYPE "public"."posting_verification" AS ENUM('verified', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."rate_dimension" AS ENUM('use', 'term', 'territory');--> statement-breakpoint
CREATE TYPE "public"."rate_option_key" AS ENUM('organic_social', 'paid_social', 'broadcast', 'd30', 'm6', 'y1', 'perpetual', 'country', 'region', 'worldwide');--> statement-breakpoint
CREATE TYPE "public"."social_account_status" AS ENUM('connected', 'needs_reconnect', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."social_post_media_type" AS ENUM('video', 'reel', 'short');--> statement-breakpoint
CREATE TYPE "public"."social_post_status" AS ENUM('available', 'removed', 'stale');--> statement-breakpoint
CREATE TYPE "public"."social_post_visibility" AS ENUM('public', 'unlisted', 'private');--> statement-breakpoint
CREATE TYPE "public"."social_provider" AS ENUM('instagram', 'tiktok', 'youtube', 'mock');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('creator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."video_disabled_reason" AS ENUM('rights_claim', 'prohibited_content', 'other');--> statement-breakpoint
CREATE TYPE "public"."video_ownership" AS ENUM('verified_owner', 'self_attested');--> statement-breakpoint
CREATE TYPE "public"."video_source" AS ENUM('library', 'upload');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('draft', 'published', 'unpublished', 'disabled');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" "user_role" DEFAULT 'creator' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"age_confirmed_at" timestamp with time zone NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"approval_window_hours" smallint DEFAULT 72 NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"payout_currency" "currency" DEFAULT 'cad' NOT NULL,
	"stripe_account_id" text,
	"payouts_status" "payouts_status" DEFAULT 'not_started' NOT NULL,
	"payouts_status_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_profile_handle_format" CHECK (char_length("creator_profile"."handle") between 3 and 30
    and "creator_profile"."handle" ~ '^[a-z0-9][a-z0-9._]*[a-z0-9]$' and position('..' in "creator_profile"."handle") = 0),
	CONSTRAINT "creator_profile_display_name_len" CHECK (char_length("creator_profile"."display_name") between 1 and 60),
	CONSTRAINT "creator_profile_approval_window" CHECK ("creator_profile"."approval_window_hours" in (24, 48, 72, 120)),
	CONSTRAINT "creator_profile_payouts_needs_account" CHECK ("creator_profile"."payouts_status" = 'not_started' or "creator_profile"."stripe_account_id" is not null),
	CONSTRAINT "creator_profile_time_zone_len" CHECK (char_length("creator_profile"."time_zone") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "rate_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"base_price_cents" integer DEFAULT 15000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_card_base_price_range" CHECK ("rate_card"."base_price_cents" between 1000 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "rate_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"dimension" "rate_dimension" NOT NULL,
	"option_key" "rate_option_key" NOT NULL,
	"multiplier_bps" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_option_multiplier_range" CHECK ("rate_option"."multiplier_bps" between 10000 and 100000),
	CONSTRAINT "rate_option_key_matches_dimension" CHECK (
    ("rate_option"."dimension" = 'use' and "rate_option"."option_key" in ('organic_social','paid_social','broadcast')) or
    ("rate_option"."dimension" = 'term' and "rate_option"."option_key" in ('d30','m6','y1','perpetual')) or
    ("rate_option"."dimension" = 'territory' and "rate_option"."option_key" in ('country','region','worldwide')))
);
--> statement-breakpoint
CREATE TABLE "download_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_id" uuid NOT NULL,
	"kind" "download_kind" NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "download_event_ua_len" CHECK ("download_event"."user_agent" is null or char_length("download_event"."user_agent") <= 512)
);
--> statement-breakpoint
CREATE TABLE "license" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_request_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"code" text NOT NULL,
	"terms_version" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"snapshot" jsonb NOT NULL,
	"original_object_key" text NOT NULL,
	"original_bytes" bigint NOT NULL,
	"original_mime" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" "license_revoked_reason",
	"revoked_note" text,
	"revoked_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_code_format" CHECK ("license"."code" ~ '^CL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
	CONSTRAINT "license_terms_version" CHECK ("license"."terms_version" ~ '^v[0-9]+$'),
	CONSTRAINT "license_dates" CHECK ("license"."ends_at" is null or "license"."ends_at" > "license"."starts_at"),
	CONSTRAINT "license_revoked_fields" CHECK (("license"."revoked_at" is null) = ("license"."revoked_reason" is null)),
	CONSTRAINT "license_object_keys" CHECK ("license"."original_object_key" like 'originals/%')
);
--> statement-breakpoint
CREATE TABLE "license_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"status" "license_request_status" DEFAULT 'checkout_pending' NOT NULL,
	"licensee_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"buyer_email" text NOT NULL,
	"intended_use" text,
	"buyer_time_zone" text DEFAULT 'UTC' NOT NULL,
	"buyer_token_hash" text NOT NULL,
	"buyer_token_enc" text NOT NULL,
	"use_key" "rate_option_key" NOT NULL,
	"term_key" "rate_option_key" NOT NULL,
	"territory_key" "rate_option_key" NOT NULL,
	"territory_code" text,
	"currency" "currency" NOT NULL,
	"base_price_cents" integer NOT NULL,
	"use_multiplier_bps" integer NOT NULL,
	"term_multiplier_bps" integer NOT NULL,
	"territory_multiplier_bps" integer NOT NULL,
	"platform_fee_bps" integer NOT NULL,
	"platform_fee_min_cents" integer NOT NULL,
	"license_price_cents" integer NOT NULL,
	"platform_fee_cents" integer NOT NULL,
	"amount_total_cents" integer NOT NULL,
	"terms_version" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"terms_accepted_ip" "inet",
	"terms_accepted_user_agent" text,
	"approval_window_hours" smallint NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"auto_approve_fallback_at" timestamp with time zone,
	"checkout_submission_id" uuid NOT NULL,
	"stripe_checkout_session_id" text,
	"checkout_expires_at" timestamp with time zone NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"authorized_at" timestamp with time zone,
	"capture_before" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"payment_action" "payment_action",
	"payment_action_at" timestamp with time zone,
	"stripe_attempt" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	"capture_failed_at" timestamp with time zone,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_request_id_video_creator_uq" UNIQUE("id","video_id","creator_id"),
	CONSTRAINT "license_request_use_key" CHECK ("license_request"."use_key" in ('organic_social','paid_social','broadcast')),
	CONSTRAINT "license_request_term_key" CHECK ("license_request"."term_key" in ('d30','m6','y1','perpetual')),
	CONSTRAINT "license_request_territory_key" CHECK ("license_request"."territory_key" in ('country','region','worldwide')),
	CONSTRAINT "license_request_territory_code" CHECK (
    ("license_request"."territory_key" = 'worldwide' and "license_request"."territory_code" is null) or
    ("license_request"."territory_key" = 'country' and "license_request"."territory_code" ~ '^[A-Z]{2}$') or
    ("license_request"."territory_key" = 'region' and "license_request"."territory_code" in
      ('north_america','latam_caribbean','europe','middle_east_africa','asia_pacific'))),
	CONSTRAINT "license_request_base_range" CHECK ("license_request"."base_price_cents" between 1000 and 1000000),
	CONSTRAINT "license_request_multiplier_range" CHECK (
    "license_request"."use_multiplier_bps" between 10000 and 100000 and "license_request"."term_multiplier_bps" between 10000 and 100000
    and "license_request"."territory_multiplier_bps" between 10000 and 100000),
	CONSTRAINT "license_request_fee_bps_range" CHECK ("license_request"."platform_fee_bps" between 0 and 5000),
	CONSTRAINT "license_request_fee_min_range" CHECK ("license_request"."platform_fee_min_cents" between 0 and 10000),
	CONSTRAINT "license_request_money_nonneg" CHECK ("license_request"."license_price_cents" >= 0 and "license_request"."platform_fee_cents" >= 0),
	CONSTRAINT "license_request_total" CHECK ("license_request"."amount_total_cents" = "license_request"."license_price_cents" + "license_request"."platform_fee_cents"
    and "license_request"."amount_total_cents" between 50 and 99999999),
	CONSTRAINT "license_request_text_lengths" CHECK (
    char_length("license_request"."licensee_name") between 1 and 120 and char_length("license_request"."contact_name") between 1 and 120
    and char_length("license_request"."buyer_email") between 3 and 254 and position('@' in "license_request"."buyer_email") > 1
    and ("license_request"."intended_use" is null or char_length("license_request"."intended_use") <= 200)
    and ("license_request"."terms_accepted_user_agent" is null or char_length("license_request"."terms_accepted_user_agent") <= 512)),
	CONSTRAINT "license_request_buyer_time_zone_len" CHECK (char_length("license_request"."buyer_time_zone") between 1 and 64),
	CONSTRAINT "license_request_token_hash_format" CHECK ("license_request"."buyer_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "license_request_buyer_token_sealed" CHECK ("license_request"."buyer_token_enc" like 'v1.%'),
	CONSTRAINT "license_request_terms_version" CHECK ("license_request"."terms_version" ~ '^v[0-9]+$'),
	CONSTRAINT "license_request_approval_window" CHECK ("license_request"."approval_window_hours" in (24, 48, 72, 120)),
	CONSTRAINT "license_request_expires_after_auth" CHECK ("license_request"."expires_at" is null or "license_request"."authorized_at" is null or "license_request"."expires_at" > "license_request"."authorized_at"),
	CONSTRAINT "license_request_hold_margin" CHECK ("license_request"."expires_at" is null or "license_request"."capture_before" is null
    or "license_request"."expires_at" <= "license_request"."capture_before" - interval '6 hours')
);
--> statement-breakpoint
CREATE TABLE "money_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_request_id" uuid NOT NULL,
	"kind" "money_movement_kind" NOT NULL,
	"status" "money_movement_status" DEFAULT 'pending' NOT NULL,
	"currency" "currency" NOT NULL,
	"amount_cents" integer NOT NULL,
	"stripe_object_id" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"succeeded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_movement_amount_positive" CHECK ("money_movement"."amount_cents" > 0),
	CONSTRAINT "money_movement_succeeded_fields" CHECK ("money_movement"."status" <> 'succeeded' or
    ("money_movement"."stripe_object_id" is not null and "money_movement"."succeeded_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_action_format" CHECK ("audit_event"."action" ~ '^[a-z_]+([.][a-z_]+)+$')
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"subject" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_log_entity_type" CHECK ("email_log"."entity_type" in ('user','license_request','license','social_account')),
	CONSTRAINT "email_log_provider" CHECK ("email_log"."provider" in ('resend','console')),
	CONSTRAINT "email_log_recipient_hash" CHECK ("email_log"."recipient_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "email_log_key_len" CHECK (char_length("email_log"."idempotency_key") between 1 and 256)
);
--> statement-breakpoint
CREATE TABLE "stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"platform_currency" "currency" NOT NULL,
	"type" text NOT NULL,
	"livemode" boolean NOT NULL,
	"api_version" text,
	"account" text,
	"object_id" text,
	"license_request_id" uuid,
	"attempts" integer DEFAULT 1 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_event_test_mode_only" CHECK ("stripe_event"."livemode" = false)
);
--> statement-breakpoint
CREATE TABLE "social_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"provider" "social_provider" NOT NULL,
	"provider_account_id" text NOT NULL,
	"username" text,
	"display_name" text,
	"avatar_url" text,
	"profile_url" text,
	"account_type" text,
	"status" "social_account_status" DEFAULT 'connected' NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"token_refreshed_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"has_older" boolean DEFAULT false NOT NULL,
	"sync_started_at" timestamp with time zone,
	"sync_blocked_until" timestamp with time zone,
	"last_sync_error" text,
	"last_sync_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_account_id_creator_provider_uq" UNIQUE("id","creator_id","provider"),
	CONSTRAINT "social_account_tokens_sealed" CHECK (
    ("social_account"."access_token_enc" is null or "social_account"."access_token_enc" like 'v1.%') and
    ("social_account"."refresh_token_enc" is null or "social_account"."refresh_token_enc" like 'v1.%')),
	CONSTRAINT "social_account_live_has_token" CHECK ("social_account"."status" <> 'connected' or "social_account"."access_token_enc" is not null),
	CONSTRAINT "social_account_disconnected_clean" CHECK ("social_account"."status" <> 'disconnected' or
    ("social_account"."access_token_enc" is null and "social_account"."refresh_token_enc" is null and "social_account"."disconnected_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "social_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"social_account_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"provider" "social_provider" NOT NULL,
	"provider_post_id" text NOT NULL,
	"media_type" "social_post_media_type" NOT NULL,
	"status" "social_post_status" DEFAULT 'available' NOT NULL,
	"title" text,
	"caption" text,
	"permalink" text NOT NULL,
	"link_key" text NOT NULL,
	"thumbnail_url" text,
	"thumbnail_fetched_at" timestamp with time zone,
	"thumbnail_expires_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"duration_sec" integer,
	"width" integer,
	"height" integer,
	"view_count" bigint,
	"like_count" bigint,
	"comment_count" bigint,
	"share_count" bigint,
	"visibility" "social_post_visibility",
	"fetched_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_post_id_creator_uq" UNIQUE("id","creator_id")
);
--> statement-breakpoint
CREATE TABLE "video" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" "video_status" DEFAULT 'draft' NOT NULL,
	"source" "video_source" NOT NULL,
	"ownership" "video_ownership" NOT NULL,
	"postings_confirmed_at" timestamp with time zone,
	"same_video_confirmed_at" timestamp with time zone,
	"contains_music" boolean,
	"identifiable_people" boolean,
	"rights_attested_at" timestamp with time zone,
	"attestation_version" text,
	"base_price_override_cents" integer,
	"disabled_uses" "rate_option_key"[] DEFAULT '{}' NOT NULL,
	"original_status" "original_file_status" DEFAULT 'none' NOT NULL,
	"original_object_key" text,
	"original_upload_id" text,
	"original_part_bytes" integer,
	"original_upload_started_at" timestamp with time zone,
	"original_bytes" bigint,
	"original_mime" text,
	"original_filename" text,
	"original_error" text,
	"original_updated_at" timestamp with time zone,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"poster_object_key" text,
	"poster_origin" "poster_origin",
	"published_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"disabled_reason" "video_disabled_reason",
	"disabled_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_id_creator_uq" UNIQUE("id","creator_id"),
	CONSTRAINT "video_slug_format" CHECK ("video"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("video"."slug") <= 60),
	CONSTRAINT "video_title_len" CHECK (char_length("video"."title") between 1 and 100),
	CONSTRAINT "video_price_override_range" CHECK ("video"."base_price_override_cents" is null or
    ("video"."base_price_override_cents" between 1000 and 1000000 and "video"."base_price_override_cents" % 100 = 0)),
	CONSTRAINT "video_disabled_uses_subset" CHECK ("video"."disabled_uses" <@ array['organic_social','paid_social','broadcast']::rate_option_key[]),
	CONSTRAINT "video_object_keys" CHECK (
    ("video"."original_object_key" is null or "video"."original_object_key" like 'originals/%') and
    ("video"."poster_object_key" is null or "video"."poster_object_key" like 'posters/%')),
	CONSTRAINT "video_original_ready" CHECK ("video"."original_status" <> 'ready' or
    ("video"."original_object_key" is not null and "video"."original_bytes" > 0
      and "video"."original_mime" in ('video/mp4','video/quicktime'))),
	CONSTRAINT "video_published_requirements" CHECK ("video"."status" <> 'published' or (
    "video"."original_status" = 'ready' and "video"."rights_attested_at" is not null and "video"."attestation_version" is not null
    and "video"."contains_music" is not null and "video"."identifiable_people" is not null and "video"."published_at" is not null
    and "video"."poster_object_key" is not null and "video"."postings_confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "video_posting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform" "posting_platform" NOT NULL,
	"other_label" text,
	"url" text,
	"link_key" text,
	"verification" "posting_verification" NOT NULL,
	"unverified_reason" "posting_unverified_reason",
	"is_source" boolean DEFAULT false NOT NULL,
	"social_account_id" uuid,
	"social_post_id" uuid,
	"verified_username" text,
	"verified_account_linked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"show_link" boolean DEFAULT true NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_posting_other_label" CHECK (("video_posting"."platform" = 'other') = ("video_posting"."other_label" is not null)
    and ("video_posting"."other_label" is null or char_length("video_posting"."other_label") between 1 and 40)),
	CONSTRAINT "video_posting_url_shape" CHECK ("video_posting"."url" is null or ("video_posting"."url" like 'https://%' and char_length("video_posting"."url") <= 2048)),
	CONSTRAINT "video_posting_link_key" CHECK (
    ("video_posting"."platform" = 'other' and "video_posting"."link_key" is null)
    or ("video_posting"."platform" <> 'other' and ("video_posting"."url" is null) = ("video_posting"."link_key" is null))),
	CONSTRAINT "video_posting_reason" CHECK (("video_posting"."verification" = 'verified') = ("video_posting"."unverified_reason" is null)),
	CONSTRAINT "video_posting_verified_fields" CHECK ("video_posting"."verification" <> 'verified' or (
    "video_posting"."platform" in ('instagram','tiktok','youtube','mock') and "video_posting"."link_key" is not null
    and "video_posting"."social_account_id" is not null and "video_posting"."social_post_id" is not null and "video_posting"."verified_username" is not null
    and "video_posting"."verified_account_linked_at" is not null and "video_posting"."verified_at" is not null)),
	CONSTRAINT "video_posting_unverifiable" CHECK ("video_posting"."platform" in ('instagram','tiktok','youtube','mock')
    or "video_posting"."verification" = 'unverified')
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profile" ADD CONSTRAINT "creator_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_creator_id_creator_profile_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_option" ADD CONSTRAINT "rate_option_rate_card_id_rate_card_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_event" ADD CONSTRAINT "download_event_license_id_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."license"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license" ADD CONSTRAINT "license_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license" ADD CONSTRAINT "license_request_fk" FOREIGN KEY ("license_request_id","video_id","creator_id") REFERENCES "public"."license_request"("id","video_id","creator_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_request" ADD CONSTRAINT "license_request_video_fk" FOREIGN KEY ("video_id","creator_id") REFERENCES "public"."video"("id","creator_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_movement" ADD CONSTRAINT "money_movement_license_request_id_license_request_id_fk" FOREIGN KEY ("license_request_id") REFERENCES "public"."license_request"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_event" ADD CONSTRAINT "stripe_event_license_request_id_license_request_id_fk" FOREIGN KEY ("license_request_id") REFERENCES "public"."license_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_creator_id_creator_profile_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_account_fk" FOREIGN KEY ("social_account_id","creator_id","provider") REFERENCES "public"."social_account"("id","creator_id","provider") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_creator_id_creator_profile_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profile"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_posting" ADD CONSTRAINT "video_posting_social_account_id_social_account_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_posting" ADD CONSTRAINT "video_posting_video_fk" FOREIGN KEY ("video_id","creator_id") REFERENCES "public"."video"("id","creator_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_posting" ADD CONSTRAINT "video_posting_social_post_fk" FOREIGN KEY ("social_post_id","creator_id") REFERENCES "public"."social_post"("id","creator_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_profile_user_id_uidx" ON "creator_profile" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_profile_handle_uidx" ON "creator_profile" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_profile_stripe_account_id_uidx" ON "creator_profile" USING btree ("stripe_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_card_creator_id_uidx" ON "rate_card" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_option_card_key_uidx" ON "rate_option" USING btree ("rate_card_id","option_key");--> statement-breakpoint
CREATE INDEX "download_event_license_created_idx" ON "download_event" USING btree ("license_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "license_license_request_uidx" ON "license" USING btree ("license_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "license_code_uidx" ON "license" USING btree ("code");--> statement-breakpoint
CREATE INDEX "license_creator_created_idx" ON "license" USING btree ("creator_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "license_video_idx" ON "license" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "license_request_buyer_token_hash_uidx" ON "license_request" USING btree ("buyer_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "license_request_checkout_submission_uidx" ON "license_request" USING btree ("checkout_submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "license_request_checkout_session_uidx" ON "license_request" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "license_request_payment_intent_uidx" ON "license_request" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "license_request_charge_uidx" ON "license_request" USING btree ("stripe_charge_id");--> statement-breakpoint
CREATE INDEX "license_request_inbox_idx" ON "license_request" USING btree ("creator_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "license_request_creator_created_idx" ON "license_request" USING btree ("creator_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "license_request_video_status_idx" ON "license_request" USING btree ("video_id","status");--> statement-breakpoint
CREATE INDEX "license_request_status_created_idx" ON "license_request" USING btree ("status","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "license_request_due_idx" ON "license_request" USING btree ("expires_at") WHERE "license_request"."status" = 'awaiting_approval';--> statement-breakpoint
CREATE INDEX "license_request_checkout_due_idx" ON "license_request" USING btree ("checkout_expires_at") WHERE "license_request"."status" = 'checkout_pending';--> statement-breakpoint
CREATE UNIQUE INDEX "money_movement_request_kind_uidx" ON "money_movement" USING btree ("license_request_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "money_movement_stripe_object_uidx" ON "money_movement" USING btree ("stripe_object_id");--> statement-breakpoint
CREATE INDEX "money_movement_status_idx" ON "money_movement" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" USING btree ("entity_type","entity_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_event_created_idx" ON "audit_event" USING btree ("created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "email_log_idempotency_key_uidx" ON "email_log" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_log_entity_idx" ON "email_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "email_log_status_created_idx" ON "email_log" USING btree ("status","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "stripe_event_license_request_idx" ON "stripe_event" USING btree ("license_request_id");--> statement-breakpoint
CREATE INDEX "stripe_event_unprocessed_idx" ON "stripe_event" USING btree ("received_at") WHERE "stripe_event"."processed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "social_account_creator_provider_account_uidx" ON "social_account" USING btree ("creator_id","provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_account_live_provider_account_uidx" ON "social_account" USING btree ("provider","provider_account_id") WHERE "social_account"."status" <> 'disconnected';--> statement-breakpoint
CREATE UNIQUE INDEX "social_post_account_post_uidx" ON "social_post" USING btree ("social_account_id","provider_post_id");--> statement-breakpoint
CREATE INDEX "social_post_library_idx" ON "social_post" USING btree ("creator_id","posted_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "social_post"."status" = 'available';--> statement-breakpoint
CREATE INDEX "social_post_library_provider_idx" ON "social_post" USING btree ("creator_id","provider","posted_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "social_post"."status" = 'available';--> statement-breakpoint
CREATE INDEX "social_post_library_account_idx" ON "social_post" USING btree ("creator_id","social_account_id","posted_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "social_post"."status" = 'available';--> statement-breakpoint
CREATE INDEX "social_post_fetched_at_idx" ON "social_post" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "social_post_link_key_idx" ON "social_post" USING btree ("creator_id","provider","link_key");--> statement-breakpoint
CREATE UNIQUE INDEX "video_creator_slug_uidx" ON "video" USING btree ("creator_id","slug");--> statement-breakpoint
CREATE INDEX "video_creator_status_published_idx" ON "video" USING btree ("creator_id","status","published_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "video_posting_video_position_uidx" ON "video_posting" USING btree ("video_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "video_posting_video_link_uidx" ON "video_posting" USING btree ("video_id","platform","link_key") WHERE "video_posting"."link_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "video_posting_verified_uidx" ON "video_posting" USING btree ("platform","link_key") WHERE "video_posting"."verification" = 'verified';--> statement-breakpoint
CREATE UNIQUE INDEX "video_posting_source_uidx" ON "video_posting" USING btree ("video_id") WHERE "video_posting"."is_source" = true;--> statement-breakpoint
CREATE INDEX "video_posting_link_idx" ON "video_posting" USING btree ("platform","link_key");--> statement-breakpoint
CREATE INDEX "video_posting_social_post_idx" ON "video_posting" USING btree ("social_post_id");