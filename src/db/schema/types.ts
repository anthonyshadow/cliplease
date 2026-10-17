// src/db/schema/types.ts — row types for the server data-access layer only.
// Server Actions and pages return small DTOs, never these rows (stack.md fact 15).
import type * as s from "./index";

export type User = typeof s.user.$inferSelect;
export type CreatorProfile = typeof s.creatorProfile.$inferSelect;
export type NewCreatorProfile = typeof s.creatorProfile.$inferInsert;
export type RateCard = typeof s.rateCard.$inferSelect;
export type RateOption = typeof s.rateOption.$inferSelect;
export type NewRateOption = typeof s.rateOption.$inferInsert;
export type SocialAccount = typeof s.socialAccount.$inferSelect;
export type NewSocialAccount = typeof s.socialAccount.$inferInsert;
export type SocialPostRow = typeof s.socialPost.$inferSelect; // "Row": adapters already export a SocialPost DTO
export type NewSocialPostRow = typeof s.socialPost.$inferInsert;
export type Video = typeof s.video.$inferSelect;
export type NewVideo = typeof s.video.$inferInsert;
export type VideoPosting = typeof s.videoPosting.$inferSelect; // pages get a small DTO, never this row
export type NewVideoPosting = typeof s.videoPosting.$inferInsert;
export type LicenseRequest = typeof s.licenseRequest.$inferSelect;
export type NewLicenseRequest = typeof s.licenseRequest.$inferInsert;
export type License = typeof s.license.$inferSelect;
export type NewLicense = typeof s.license.$inferInsert;
export type MoneyMovement = typeof s.moneyMovement.$inferSelect;
export type NewMoneyMovement = typeof s.moneyMovement.$inferInsert;
export type DownloadEvent = typeof s.downloadEvent.$inferSelect;
export type StripeEventRow = typeof s.stripeEvent.$inferSelect;
export type EmailLog = typeof s.emailLog.$inferSelect;
export type AuditEvent = typeof s.auditEvent.$inferSelect;
