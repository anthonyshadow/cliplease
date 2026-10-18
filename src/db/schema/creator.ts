// src/db/schema/creator.ts
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { createdAt, pk, tstz, updatedAt } from "./columns";
import {
  currencyEnum,
  payoutsStatusEnum,
  rateDimensionEnum,
  rateOptionKeyEnum,
} from "./enums";

export const creatorProfile = pgTable(
  "creator_profile",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    handle: text("handle").notNull(), // lowercase, no "@"; immutable in the prototype (07 D20)
    displayName: text("display_name").notNull(),
    // 18+ only (07 D93): only the time of the "I'm 18 or older" tick is stored; without the tick nothing is saved.
    ageConfirmedAt: tstz("age_confirmed_at").notNull(), // time the creator ticked "I'm 18 or older" (07 D93)
    timeZone: text("time_zone").notNull().default("UTC"), // IANA zone from the device at onboarding (normalizeTimeZone); emails only (07 D84)
    approvalWindowHours: smallint("approval_window_hours")
      .notNull()
      .default(72), // selectable (07 D81): 24 · 48 · 72 · 120; new requests only
    autoApprove: boolean("auto_approve").notNull().default(false), // 07 D81: can be turned on only while payouts are active (code)
    payoutCurrency: currencyEnum("payout_currency").notNull().default("cad"), // 07 D94: prices, license page, platform account; immutable once stripe_account_id is set or any license_request exists (code)
    stripeAccountId: text("stripe_account_id"), // acct_… (Accounts v2 id) on the payout_currency's platform account, created on first "Set up payouts"
    payoutsStatus: payoutsStatusEnum("payouts_status")
      .notNull()
      .default("not_started"),
    payoutsStatusSyncedAt: tstz("payouts_status_synced_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("creator_profile_user_id_uidx").on(t.userId),
    uniqueIndex("creator_profile_handle_uidx").on(t.handle),
    uniqueIndex("creator_profile_stripe_account_id_uidx").on(t.stripeAccountId), // NULLs are distinct
    // CHECK tiers per 07 D60: CORE = in a CORE migration (0000_init unless tagged 0001/0002/0003); [H1] = hardening migration H1.
    check(
      "creator_profile_handle_format",
      sql`char_length(${t.handle}) between 3 and 30
    and ${t.handle} ~ '^[a-z0-9][a-z0-9._]*[a-z0-9]$' and position('..' in ${t.handle}) = 0`,
    ), // CORE
    check(
      "creator_profile_display_name_len",
      sql`char_length(${t.displayName}) between 1 and 60`,
    ), // CORE
    check(
      "creator_profile_approval_window",
      sql`${t.approvalWindowHours} in (24, 48, 72, 120)`,
    ), // CORE
    check(
      "creator_profile_payouts_needs_account",
      sql`${t.payoutsStatus} = 'not_started' or ${t.stripeAccountId} is not null`,
    ), // CORE
    check(
      "creator_profile_time_zone_len",
      sql`char_length(${t.timeZone}) between 1 and 64`,
    ), // CORE
  ],
);

export const rateCard = pgTable(
  "rate_card",
  {
    id: pk(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creatorProfile.id, { onDelete: "cascade" }),
    basePriceCents: integer("base_price_cents").notNull().default(15000), // CA$150 default, in the creator's payout_currency (DEFAULT_BASE_PRICE_CENTS[currency], 07 D97)
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("rate_card_creator_id_uidx").on(t.creatorId),
    check(
      "rate_card_base_price_range",
      sql`${t.basePriceCents} between 1000 and 1000000`,
    ), // CORE · CA$10 … CA$10,000 (equal in USD, 07 D97)
  ],
);

export const rateOption = pgTable(
  "rate_option",
  {
    id: pk(),
    rateCardId: uuid("rate_card_id")
      .notNull()
      .references(() => rateCard.id, { onDelete: "cascade" }),
    dimension: rateDimensionEnum("dimension").notNull(),
    optionKey: rateOptionKeyEnum("option_key").notNull(),
    multiplierBps: integer("multiplier_bps").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: smallint("sort_order").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("rate_option_card_key_uidx").on(t.rateCardId, t.optionKey),
    check(
      "rate_option_multiplier_range",
      sql`${t.multiplierBps} between 10000 and 100000`,
    ), // CORE · 1.00× … 10.00×
    check(
      "rate_option_key_matches_dimension",
      sql`
    (${t.dimension} = 'use' and ${t.optionKey} in ('organic_social','paid_social','broadcast')) or
    (${t.dimension} = 'term' and ${t.optionKey} in ('d30','m6','y1','perpetual')) or
    (${t.dimension} = 'territory' and ${t.optionKey} in ('country','region','worldwide'))`,
    ), // CORE
  ],
);
