import { isPgEnum } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as V from "../../lib/domain/values";
import * as enums from "./enums";

// Each pgEnum's Postgres name and the values.ts tuple it is built from (03 §2, §3.1).
const TUPLE_BY_PG_ENUM: Record<string, string> = {
  user_role: "USER_ROLES",
  social_provider: "SOCIAL_PROVIDERS",
  social_account_status: "SOCIAL_ACCOUNT_STATUSES",
  social_post_media_type: "SOCIAL_POST_MEDIA_TYPES",
  social_post_status: "SOCIAL_POST_STATUSES",
  social_post_visibility: "SOCIAL_POST_VISIBILITIES",
  rate_dimension: "RATE_DIMENSIONS",
  rate_option_key: "RATE_OPTION_KEYS",
  video_source: "VIDEO_SOURCES",
  video_ownership: "VIDEO_OWNERSHIPS",
  video_status: "VIDEO_STATUSES",
  video_disabled_reason: "VIDEO_DISABLED_REASONS",
  original_file_status: "ORIGINAL_FILE_STATUSES",
  poster_origin: "POSTER_ORIGINS",
  payouts_status: "PAYOUTS_STATUSES",
  license_request_status: "LICENSE_REQUEST_STATUSES",
  payment_action: "PAYMENT_ACTIONS",
  license_revoked_reason: "LICENSE_REVOKED_REASONS",
  download_kind: "DOWNLOAD_KINDS",
  email_status: "EMAIL_STATUSES",
  audit_actor_type: "AUDIT_ACTOR_TYPES",
  posting_platform: "POSTING_PLATFORMS",
  posting_verification: "POSTING_VERIFICATIONS",
  posting_unverified_reason: "POSTING_UNVERIFIED_REASONS",
  currency: "CURRENCIES",
  money_movement_kind: "MONEY_MOVEMENT_KINDS",
  money_movement_status: "MONEY_MOVEMENT_STATUSES",
};

// Tuples checked in TypeScript or stored as text/smallint: never a pgEnum (03 §2).
const NEVER_PG_ENUM = [
  "CONNECT_ERROR_CODES",
  "USE_KEYS",
  "TERM_KEYS",
  "TERRITORY_KEYS",
  "REGION_KEYS",
  "VERIFIABLE_POSTING_PLATFORMS",
  "POSTING_LINK_ERRORS",
  "APPROVAL_WINDOW_HOURS",
  "EXCLUSIVE_TERM_KEYS",
  "RENEWABLE_TERM_KEYS",
  "LICENSE_AVAILABILITY_STATES",
  "RENEWAL_DISPLAY_STATES",
];

// Their pgEnums arrive with 0003_renewals (P22b, 07 D116), never earlier.
const RENEWAL_TUPLES = [
  "LICENSE_REQUEST_ORIGINS",
  "RENEWAL_PLAN_STATUSES",
  "AUTO_RENEW_OFF_REASONS",
  "RENEWAL_CONSENT_KINDS",
  "RENEWAL_PRICE_DIRECTIONS",
  "RENEWAL_PROPOSAL_STATUSES",
  "RENEWAL_RESERVATION_REASONS",
  "RENEWAL_RESERVATION_STATUSES",
];

const pgEnumByName = new Map(
  Object.values(enums)
    .filter(isPgEnum)
    .map((pgEnum) => [pgEnum.enumName, pgEnum]),
);
const tupleByName = new Map(
  Object.entries(V).filter(([, value]) => Array.isArray(value)),
);

describe("pgEnums (03 §2, 07 D116)", () => {
  it("exports exactly the 27 pgEnums of 0000_init", () => {
    expect([...pgEnumByName.keys()].sort()).toEqual(
      Object.keys(TUPLE_BY_PG_ENUM).sort(),
    );
    expect(pgEnumByName.size).toBe(27);
  });

  it.each(Object.entries(TUPLE_BY_PG_ENUM))(
    "%s has the values of %s, in order",
    (pgName, tuple) => {
      expect(pgEnumByName.get(pgName)?.enumValues).toEqual(
        tupleByName.get(tuple),
      );
    },
  );

  it("accounts for every values.ts tuple: a pgEnum, never one, or a renewal one later", () => {
    expect(
      [
        ...Object.values(TUPLE_BY_PG_ENUM),
        ...NEVER_PG_ENUM,
        ...RENEWAL_TUPLES,
      ].sort(),
    ).toEqual([...tupleByName.keys()].sort());
    expect(tupleByName.size).toBe(47);
  });
});
