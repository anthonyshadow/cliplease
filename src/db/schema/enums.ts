// src/db/schema/enums.ts
import { pgEnum } from "drizzle-orm/pg-core";
import * as V from "../../lib/domain/values";

export const userRoleEnum = pgEnum("user_role", V.USER_ROLES);
export const socialProviderEnum = pgEnum("social_provider", V.SOCIAL_PROVIDERS);
export const socialAccountStatusEnum = pgEnum(
  "social_account_status",
  V.SOCIAL_ACCOUNT_STATUSES,
);
export const socialPostMediaTypeEnum = pgEnum(
  "social_post_media_type",
  V.SOCIAL_POST_MEDIA_TYPES,
);
export const socialPostStatusEnum = pgEnum(
  "social_post_status",
  V.SOCIAL_POST_STATUSES,
);
export const socialPostVisibilityEnum = pgEnum(
  "social_post_visibility",
  V.SOCIAL_POST_VISIBILITIES,
);
export const rateDimensionEnum = pgEnum("rate_dimension", V.RATE_DIMENSIONS);
export const rateOptionKeyEnum = pgEnum("rate_option_key", V.RATE_OPTION_KEYS);
export const videoSourceEnum = pgEnum("video_source", V.VIDEO_SOURCES);
export const videoOwnershipEnum = pgEnum("video_ownership", V.VIDEO_OWNERSHIPS);
export const videoStatusEnum = pgEnum("video_status", V.VIDEO_STATUSES);
export const videoDisabledReasonEnum = pgEnum(
  "video_disabled_reason",
  V.VIDEO_DISABLED_REASONS,
);
export const originalFileStatusEnum = pgEnum(
  "original_file_status",
  V.ORIGINAL_FILE_STATUSES,
);
export const posterOriginEnum = pgEnum("poster_origin", V.POSTER_ORIGINS);
export const payoutsStatusEnum = pgEnum("payouts_status", V.PAYOUTS_STATUSES);
export const licenseRequestStatusEnum = pgEnum(
  "license_request_status",
  V.LICENSE_REQUEST_STATUSES,
);
export const paymentActionEnum = pgEnum("payment_action", V.PAYMENT_ACTIONS);
export const licenseRevokedReasonEnum = pgEnum(
  "license_revoked_reason",
  V.LICENSE_REVOKED_REASONS,
);
export const downloadKindEnum = pgEnum("download_kind", V.DOWNLOAD_KINDS);
export const emailStatusEnum = pgEnum("email_status", V.EMAIL_STATUSES);
export const auditActorTypeEnum = pgEnum(
  "audit_actor_type",
  V.AUDIT_ACTOR_TYPES,
);
// Owner-answer additions (07 D65, D75) and the currency (07 D94) — 27 pgEnums in 0000_init
export const postingPlatformEnum = pgEnum(
  "posting_platform",
  V.POSTING_PLATFORMS,
);
export const postingVerificationEnum = pgEnum(
  "posting_verification",
  V.POSTING_VERIFICATIONS,
);
export const postingUnverifiedReasonEnum = pgEnum(
  "posting_unverified_reason",
  V.POSTING_UNVERIFIED_REASONS,
);
export const currencyEnum = pgEnum("currency", V.CURRENCIES);
export const moneyMovementKindEnum = pgEnum(
  "money_movement_kind",
  V.MONEY_MOVEMENT_KINDS,
);
export const moneyMovementStatusEnum = pgEnum(
  "money_movement_status",
  V.MONEY_MOVEMENT_STATUSES,
);
