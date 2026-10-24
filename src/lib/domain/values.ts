// src/lib/domain/values.ts — the only place enum tuples are declared (07 D04). Client-safe, no dependencies.
// 03 owns the values. Sources: 07 §2.1, the §7.2 additions, §8.2 CURRENCIES, the §9.2 block with the §10.2 change.

// 07 §2.1 (LICENSE_REQUEST_STATUSES and PAYMENT_ACTIONS replaced in place by their 07 §9.2 values)
export const USER_ROLES = ["creator", "admin"] as const;
export const SOCIAL_PROVIDERS = [
  "instagram",
  "tiktok",
  "youtube",
  "mock",
] as const; // type SocialProviderId
export const SOCIAL_ACCOUNT_STATUSES = [
  "connected",
  "needs_reconnect",
  "disconnected",
] as const;
export const SOCIAL_POST_MEDIA_TYPES = ["video", "reel", "short"] as const;
export const SOCIAL_POST_STATUSES = ["available", "removed", "stale"] as const;
export const SOCIAL_POST_VISIBILITIES = [
  "public",
  "unlisted",
  "private",
] as const;
export const CONNECT_ERROR_CODES = [
  "denied",
  "state",
  "missing_scope",
  "ig_personal",
  "ig_not_tester",
  "no_channel",
  "already_linked",
  "provider_error",
] as const; // not a pgEnum
export const RATE_DIMENSIONS = ["use", "term", "territory"] as const;
export const USE_KEYS = ["organic_social", "paid_social", "broadcast"] as const;
export const TERM_KEYS = ["d30", "m6", "y1", "perpetual"] as const;
export const TERRITORY_KEYS = ["country", "region", "worldwide"] as const;
export const RATE_OPTION_KEYS = [
  ...USE_KEYS,
  ...TERM_KEYS,
  ...TERRITORY_KEYS,
] as const;
export const RATE_DIMENSION_KEYS = {
  use: USE_KEYS,
  term: TERM_KEYS,
  territory: TERRITORY_KEYS,
} as const; // the keys of each RATE_DIMENSIONS group (CHECK rate_option_key_matches_dimension)
export const REGION_KEYS = [
  "north_america",
  "latam_caribbean",
  "europe",
  "middle_east_africa",
  "asia_pacific",
] as const;
export const VIDEO_SOURCES = ["library", "upload"] as const;
export const VIDEO_OWNERSHIPS = ["verified_owner", "self_attested"] as const;
export const VIDEO_STATUSES = [
  "draft",
  "published",
  "unpublished",
  "disabled",
] as const;
export const VIDEO_DISABLED_REASONS = [
  "rights_claim",
  "prohibited_content",
  "other",
] as const;
export const ORIGINAL_FILE_STATUSES = [
  "none",
  "uploading",
  "ready",
  "failed",
] as const;
export const POSTER_ORIGINS = ["frame_capture", "creator_image"] as const;
export const PAYOUTS_STATUSES = [
  "not_started",
  "pending",
  "restricted",
  "active",
  "rejected",
  "unsupported",
] as const;
export const LICENSE_REQUEST_STATUSES = [
  "checkout_pending",
  "awaiting_approval",
  "approved",
  "declined",
  "expired",
  "abandoned",
  "capture_failed",
  "renewal_pending",
  "renewal_canceled",
  "renewal_failed",
] as const; // +3, in 0000_init
export const PAYMENT_ACTIONS = [
  "capture",
  "decline",
  "expire",
  "renewal_charge",
  "renewal_checkout",
] as const; // +2, in 0000_init
export const LICENSE_REVOKED_REASONS = [
  "rights_claim",
  "licensee_breach",
  "payment_reversed",
  "issued_in_error",
] as const;
export const DOWNLOAD_KINDS = ["original", "pdf"] as const;
export const EMAIL_STATUSES = ["queued", "sent", "failed"] as const;
export const AUDIT_ACTOR_TYPES = [
  "creator",
  "admin",
  "buyer",
  "system",
  "stripe",
  "cron",
] as const;
// Removed: ORIGINAL_ORIGINS, LICENSE_STATUSES (public status is computed: valid | upcoming | expired | revoked | not_found; 07 D117)

// 07 §7.2 additions
export const POSTING_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "x",
  "snapchat",
  "other",
  "mock",
] as const;
export const VERIFIABLE_POSTING_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "mock",
] as const; // === SOCIAL_PROVIDERS
export const POSTING_VERIFICATIONS = ["verified", "unverified"] as const;
export const POSTING_UNVERIFIED_REASONS = [
  "not_found",
  "no_account",
  "check_failed",
  "unverifiable",
  "no_link",
  "released",
] as const;
export const POSTING_LINK_ERRORS = [
  "empty",
  "too_long",
  "not_a_url",
  "bad_host",
  "wrong_platform",
  "short_link",
  "profile_link",
  "not_a_video",
  "unrecognized",
] as const; // client-safe, not a pgEnum
export const MONEY_MOVEMENT_KINDS = [
  "creator_transfer",
  "buyer_refund",
  "transfer_reversal",
] as const;
export const MONEY_MOVEMENT_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "canceled",
] as const;
export const APPROVAL_WINDOW_HOURS = [24, 48, 72, 120] as const; // int CHECK, not a pgEnum
// unchanged (D64): ORIGINAL_FILE_STATUSES has no importing value; POSTER_ORIGINS has no platform copy value

// 07 §8.2
export const CURRENCIES = ["cad", "usd"] as const; // type Currency; pgEnum currency; ENABLED_CURRENCIES picks the live ones (MVP: cad)
// removed: AGE_BANDS, GUARDIAN_RELATIONSHIPS (D93); PAYOUT_COUNTRIES (D94)

// 07 §9.2 exclusive and renewal tuples, with the one 07 §10.2 change (every exclusive length renews)
export const EXCLUSIVE_TERM_KEYS = ["d30", "m6", "y1"] as const; // subset of TERM_KEYS; client-safe, not a pgEnum
export const RENEWABLE_TERM_KEYS = EXCLUSIVE_TERM_KEYS; // OQ-49 answered (07 §10.2, D133); not a pgEnum
export const LICENSE_AVAILABILITY_STATES = [
  "open",
  "non_exclusive_only",
  "reserved",
  "exclusive_active",
  "renewal_reserved",
] as const; // computed, not a pgEnum
export const RENEWAL_DISPLAY_STATES = [
  "auto_renew_on",
  "price_change_pending",
  "payment_needed",
  "auto_renew_off",
  "not_renewable",
  "reserved",
  "ended",
] as const; // computed, not a pgEnum
// New pgEnums (migration 0003_renewals)
export const LICENSE_REQUEST_ORIGINS = [
  "checkout",
  "auto_renewal",
  "manual_renewal",
] as const;
export const RENEWAL_PLAN_STATUSES = ["active", "reserved", "ended"] as const;
export const AUTO_RENEW_OFF_REASONS = [
  "buyer_turned_off",
  "price_increase_declined",
  "price_increase_not_answered",
  "payment_failed",
  "creator_unavailable",
  "video_unavailable",
  "license_revoked",
] as const;
export const RENEWAL_CONSENT_KINDS = [
  "auto_renew_on",
  "auto_renew_off",
  "price_accepted",
  "price_declined",
  "manual_renewal",
] as const;
export const RENEWAL_PRICE_DIRECTIONS = ["increase", "decrease"] as const;
export const RENEWAL_PROPOSAL_STATUSES = [
  "scheduled",
  "pending",
  "accepted",
  "declined",
  "expired",
  "applied",
  "superseded",
] as const;
export const RENEWAL_RESERVATION_REASONS = [
  "price_increase_not_accepted",
  "payment_failed",
  "creator_unavailable",
] as const;
export const RENEWAL_RESERVATION_STATUSES = [
  "active",
  "converted",
  "expired",
  "canceled",
] as const;
// USER_ROLES unchanged: ["creator", "admin"] (no buyer role, D126)

// One type per tuple (03 §4 names; the rest follow the same pattern)
export type UserRole = (typeof USER_ROLES)[number];
export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number];
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];
export type SocialPostMediaType = (typeof SOCIAL_POST_MEDIA_TYPES)[number];
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];
export type SocialPostVisibility = (typeof SOCIAL_POST_VISIBILITIES)[number];
export type ConnectErrorCode = (typeof CONNECT_ERROR_CODES)[number];
export type RateDimension = (typeof RATE_DIMENSIONS)[number];
export type UseKey = (typeof USE_KEYS)[number];
export type TermKey = (typeof TERM_KEYS)[number];
export type TerritoryKey = (typeof TERRITORY_KEYS)[number];
export type RateOptionKey = (typeof RATE_OPTION_KEYS)[number];
export type RegionKey = (typeof REGION_KEYS)[number];
export type VideoSource = (typeof VIDEO_SOURCES)[number];
export type Ownership = (typeof VIDEO_OWNERSHIPS)[number];
export type VideoStatus = (typeof VIDEO_STATUSES)[number];
export type VideoDisabledReason = (typeof VIDEO_DISABLED_REASONS)[number];
export type OriginalFileStatus = (typeof ORIGINAL_FILE_STATUSES)[number];
export type PosterOrigin = (typeof POSTER_ORIGINS)[number];
export type PayoutsStatus = (typeof PAYOUTS_STATUSES)[number];
export type LicenseRequestStatus = (typeof LICENSE_REQUEST_STATUSES)[number];
export type PaymentAction = (typeof PAYMENT_ACTIONS)[number];
export type RevokedReason = (typeof LICENSE_REVOKED_REASONS)[number];
export type DownloadKind = (typeof DOWNLOAD_KINDS)[number];
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
export type PostingPlatform = (typeof POSTING_PLATFORMS)[number];
export type VerifiablePostingPlatform =
  (typeof VERIFIABLE_POSTING_PLATFORMS)[number];
export type PostingVerification = (typeof POSTING_VERIFICATIONS)[number];
export type PostingUnverifiedReason =
  (typeof POSTING_UNVERIFIED_REASONS)[number];
export type PostingLinkError = (typeof POSTING_LINK_ERRORS)[number];
export type MoneyMovementKind = (typeof MONEY_MOVEMENT_KINDS)[number];
export type MoneyMovementStatus = (typeof MONEY_MOVEMENT_STATUSES)[number];
export type ApprovalWindowHours = (typeof APPROVAL_WINDOW_HOURS)[number];
export type Currency = (typeof CURRENCIES)[number];
export type ExclusiveTermKey = (typeof EXCLUSIVE_TERM_KEYS)[number];
export type RenewableTermKey = (typeof RENEWABLE_TERM_KEYS)[number];
export type LicenseAvailabilityState =
  (typeof LICENSE_AVAILABILITY_STATES)[number];
export type RenewalDisplayState = (typeof RENEWAL_DISPLAY_STATES)[number];
export type LicenseRequestOrigin = (typeof LICENSE_REQUEST_ORIGINS)[number];
export type RenewalPlanStatus = (typeof RENEWAL_PLAN_STATUSES)[number];
export type AutoRenewOffReason = (typeof AUTO_RENEW_OFF_REASONS)[number];
export type RenewalConsentKind = (typeof RENEWAL_CONSENT_KINDS)[number];
export type RenewalPriceDirection = (typeof RENEWAL_PRICE_DIRECTIONS)[number];
export type RenewalProposalStatus = (typeof RENEWAL_PROPOSAL_STATUSES)[number];
export type RenewalReservationReason =
  (typeof RENEWAL_RESERVATION_REASONS)[number];
export type RenewalReservationStatus =
  (typeof RENEWAL_RESERVATION_STATUSES)[number];

/** Narrows `value` (a query or form value, say) to one of `tuple`'s members. */
export function isOneOf<const T extends readonly string[]>(
  tuple: T,
  value: string,
): value is T[number] {
  return (tuple as readonly string[]).includes(value);
}
