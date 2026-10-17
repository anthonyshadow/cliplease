// src/db/schema/relations.ts  (drizzle-orm 0.45 relations v1 API)
import { relations } from "drizzle-orm";
import { user } from "./auth";
import { creatorProfile, rateCard, rateOption } from "./creator";
import {
  downloadEvent,
  license,
  licenseRequest,
  moneyMovement,
} from "./licensing";
import { auditEvent, stripeEvent } from "./ops";
import { socialAccount, socialPost } from "./social";
import { video, videoPosting } from "./video";
// Every pair of tables here is linked by one FK, so no relationName is needed (license_request ↔ license included: see
// PROGRESS, P03 Decisions). P22b's multi-FK renewal pairs name each relation on both sides and give every one() its
// fields and references: in drizzle 0.45 a one() with only a relationName crashes drizzle() at startup.

export const creatorProfileRelations = relations(
  creatorProfile,
  ({ one, many }) => ({
    user: one(user, { fields: [creatorProfile.userId], references: [user.id] }),
    rateCard: one(rateCard),
    socialAccounts: many(socialAccount),
    videos: many(video),
    licenseRequests: many(licenseRequest),
    licenses: many(license),
  }),
);
export const rateCardRelations = relations(rateCard, ({ one, many }) => ({
  creator: one(creatorProfile, {
    fields: [rateCard.creatorId],
    references: [creatorProfile.id],
  }),
  options: many(rateOption),
}));
export const rateOptionRelations = relations(rateOption, ({ one }) => ({
  rateCard: one(rateCard, {
    fields: [rateOption.rateCardId],
    references: [rateCard.id],
  }),
}));
export const socialAccountRelations = relations(
  socialAccount,
  ({ one, many }) => ({
    creator: one(creatorProfile, {
      fields: [socialAccount.creatorId],
      references: [creatorProfile.id],
    }),
    posts: many(socialPost),
    postings: many(videoPosting),
  }),
);
export const socialPostRelations = relations(socialPost, ({ one, many }) => ({
  account: one(socialAccount, {
    fields: [socialPost.socialAccountId],
    references: [socialAccount.id],
  }),
  postings: many(videoPosting),
}));
export const videoRelations = relations(video, ({ one, many }) => ({
  creator: one(creatorProfile, {
    fields: [video.creatorId],
    references: [creatorProfile.id],
  }),
  postings: many(videoPosting),
  requests: many(licenseRequest),
  licenses: many(license),
}));
export const videoPostingRelations = relations(videoPosting, ({ one }) => ({
  video: one(video, { fields: [videoPosting.videoId], references: [video.id] }),
  socialAccount: one(socialAccount, {
    fields: [videoPosting.socialAccountId],
    references: [socialAccount.id],
  }),
  socialPost: one(socialPost, {
    fields: [videoPosting.socialPostId],
    references: [socialPost.id],
  }),
}));
export const licenseRequestRelations = relations(
  licenseRequest,
  ({ one, many }) => ({
    video: one(video, {
      fields: [licenseRequest.videoId],
      references: [video.id],
    }),
    creator: one(creatorProfile, {
      fields: [licenseRequest.creatorId],
      references: [creatorProfile.id],
    }),
    license: one(license),
    moneyMovements: many(moneyMovement),
    stripeEvents: many(stripeEvent),
  }),
);
export const licenseRelations = relations(license, ({ one, many }) => ({
  request: one(licenseRequest, {
    fields: [license.licenseRequestId],
    references: [licenseRequest.id],
  }),
  video: one(video, { fields: [license.videoId], references: [video.id] }),
  creator: one(creatorProfile, {
    fields: [license.creatorId],
    references: [creatorProfile.id],
  }),
  revokedBy: one(user, {
    fields: [license.revokedByUserId],
    references: [user.id],
  }),
  downloads: many(downloadEvent),
}));
export const moneyMovementRelations = relations(moneyMovement, ({ one }) => ({
  licenseRequest: one(licenseRequest, {
    fields: [moneyMovement.licenseRequestId],
    references: [licenseRequest.id],
  }),
}));
export const downloadEventRelations = relations(downloadEvent, ({ one }) => ({
  license: one(license, {
    fields: [downloadEvent.licenseId],
    references: [license.id],
  }),
}));
export const stripeEventRelations = relations(stripeEvent, ({ one }) => ({
  licenseRequest: one(licenseRequest, {
    fields: [stripeEvent.licenseRequestId],
    references: [licenseRequest.id],
  }),
}));
export const auditEventRelations = relations(auditEvent, ({ one }) => ({
  actor: one(user, { fields: [auditEvent.actorUserId], references: [user.id] }),
}));
