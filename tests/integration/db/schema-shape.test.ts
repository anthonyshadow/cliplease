import { sql } from "drizzle-orm";
import { isPgEnum } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { db } from "../../../src/db/client";
import * as schema from "../../../src/db/schema";

// 0000_init (P03): 19 tables, 27 pgEnums, 56 CORE CHECKs (07 D60, D105).
const TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "rate_limit",
  "creator_profile",
  "rate_card",
  "rate_option",
  "social_account",
  "social_post",
  "video",
  "video_posting",
  "license_request",
  "license",
  "money_movement",
  "download_event",
  "stripe_event",
  "email_log",
  "audit_event",
];

const CORE_CHECKS = [
  "creator_profile_handle_format",
  "creator_profile_display_name_len",
  "creator_profile_approval_window",
  "creator_profile_payouts_needs_account",
  "creator_profile_time_zone_len",
  "rate_card_base_price_range",
  "rate_option_multiplier_range",
  "rate_option_key_matches_dimension",
  "social_account_tokens_sealed",
  "social_account_live_has_token",
  "social_account_disconnected_clean",
  "video_slug_format",
  "video_title_len",
  "video_price_override_range",
  "video_disabled_uses_subset",
  "video_object_keys",
  "video_original_ready",
  "video_published_requirements",
  "video_posting_other_label",
  "video_posting_url_shape",
  "video_posting_link_key",
  "video_posting_reason",
  "video_posting_verified_fields",
  "video_posting_unverifiable",
  "license_request_use_key",
  "license_request_term_key",
  "license_request_territory_key",
  "license_request_territory_code",
  "license_request_base_range",
  "license_request_multiplier_range",
  "license_request_fee_bps_range",
  "license_request_fee_min_range",
  "license_request_money_nonneg",
  "license_request_total",
  "license_request_text_lengths",
  "license_request_buyer_time_zone_len",
  "license_request_token_hash_format",
  "license_request_buyer_token_sealed",
  "license_request_terms_version",
  "license_request_approval_window",
  "license_request_expires_after_auth",
  "license_request_hold_margin",
  "license_code_format",
  "license_terms_version",
  "license_dates",
  "license_revoked_fields",
  "license_object_keys",
  "money_movement_amount_positive",
  "money_movement_succeeded_fields",
  "download_event_ua_len",
  "stripe_event_test_mode_only",
  "email_log_entity_type",
  "email_log_provider",
  "email_log_recipient_hash",
  "email_log_key_len",
  "audit_event_action_format",
];

// Gone with the single-post ownership model (07 D65), the import path (D64), the H3/H6 columns (D16, D17) and the
// teen schema and payout country (D93, D94).
const REMOVED_COLUMNS = [
  "license.status",
  "social_account.token_version",
  "social_post.raw",
  "video.original_origin",
  "video.original_pending_key",
  "video.social_post_id",
  "video.verified_provider",
  "video.source_permalink",
  "video.source_provider_post_id",
  "video.show_platform_link",
  "license.pdf_object_key",
  "creator_profile.age_band",
  "creator_profile.adult_on",
  "creator_profile.payout_country",
];

describe("0000_init schema shape", () => {
  it("has exactly the 19 tables in public", async () => {
    const { rows: tables } = await db.execute<{ name: string }>(
      sql`select tablename as name from pg_tables where schemaname = 'public'`,
    );
    expect(tables.map((t) => t.name).sort()).toEqual([...TABLES].sort());
  });

  it("has the 27 enums with the values.ts labels, in order", async () => {
    const { rows: dbEnums } = await db.execute<{
      name: string;
      labels: string[];
    }>(sql`
      select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      where t.typnamespace = 'public'::regnamespace
      group by t.typname`);
    // enums.test.ts proves each pgEnum's values equal its values.ts tuple.
    const exports: unknown[] = Object.values(schema);
    const expected = exports
      .filter(isPgEnum)
      .map((e) => ({ name: e.enumName, labels: [...e.enumValues] }));
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name);
    expect(dbEnums.sort(byName)).toEqual(expected.sort(byName));
    expect(dbEnums).toHaveLength(27);
    const labels = Object.fromEntries(dbEnums.map((e) => [e.name, e.labels]));
    expect(labels.currency).toEqual(["cad", "usd"]);
    expect(labels.license_request_status?.slice(-3)).toEqual([
      "renewal_pending",
      "renewal_canceled",
      "renewal_failed",
    ]);
    expect(labels.payment_action?.slice(-2)).toEqual([
      "renewal_charge",
      "renewal_checkout",
    ]);
  });

  it("has the four currency columns: NOT NULL, type currency, a default only on payout_currency", async () => {
    // Rows: table, column, nullable, default (every column here has the type currency).
    const { rows: columns } = await db.execute<{
      table_name: string;
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(sql`
      select table_name, column_name, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and udt_name = 'currency'
      order by table_name, column_name`);
    expect(columns).toEqual([
      {
        table_name: "creator_profile",
        column_name: "payout_currency",
        is_nullable: "NO",
        column_default: "'cad'::currency",
      },
      {
        table_name: "license_request",
        column_name: "currency",
        is_nullable: "NO",
        column_default: null,
      },
      {
        table_name: "money_movement",
        column_name: "currency",
        is_nullable: "NO",
        column_default: null,
      },
      {
        table_name: "stripe_event",
        column_name: "platform_currency",
        is_nullable: "NO",
        column_default: null,
      },
    ]);
  });

  it("has exactly the 56 CORE CHECKs", async () => {
    // Filtered to public: every database also has two information_schema domain checks.
    const { rows: checks } = await db.execute<{ name: string }>(sql`
      select conname as name from pg_constraint
      where contype = 'c' and connamespace = 'public'::regnamespace`);
    expect(CORE_CHECKS).toHaveLength(56);
    expect(checks.map((c) => c.name).sort()).toEqual([...CORE_CHECKS].sort());
  });

  it("has none of the removed columns and no date-of-birth column", async () => {
    const { rows: columns } = await db.execute<{
      table_name: string;
      column_name: string;
    }>(sql`
      select table_name, column_name from information_schema.columns where table_schema = 'public'`);
    const present = new Set(
      columns.map((c) => `${c.table_name}.${c.column_name}`),
    );
    // The columns P03's Verify names, so an empty result can't pass this test.
    expect(
      [
        "video.postings_confirmed_at",
        "video.same_video_confirmed_at",
        "video.base_price_override_cents",
        "video.original_upload_id",
        "video.disabled_reason",
        "creator_profile.age_confirmed_at",
        "creator_profile.payout_currency",
      ].filter((column) => !present.has(column)),
    ).toEqual([]);
    expect(REMOVED_COLUMNS.filter((column) => present.has(column))).toEqual([]);
    expect(columns.filter((c) => c.column_name.includes("birth"))).toEqual([]);
  });
});
