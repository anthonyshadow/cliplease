// The admin actions' schemas (02 §6.1), shared by the actions, the domain functions and the Disable and Revoke sheets.
import { z } from "zod";
import { DISABLE_COPY } from "../admin/copy";
import {
  LICENSE_REVOKED_REASONS,
  VIDEO_DISABLED_REASONS,
} from "../domain/values";

/** The admin's note on a disabled video or a revoked license (05 §7): admins only, never a creator or public page. */
export const ADMIN_NOTE_MAX = 200;

/** A note trimmed, at most ADMIN_NOTE_MAX characters; an empty one is no note. */
const noteField = z
  .string()
  .trim()
  .max(ADMIN_NOTE_MAX)
  .optional()
  .transform((note) => note || undefined);

/**
 * Disable video: the video, a required reason (05 §7 callout 6) and the optional note. `sweepOnly` (the sheet's Try
 * again, owner answer Q-198 a): only the sweep of the waiting requests, never the disable itself.
 */
export const AdminDisableVideoSchema = z.object({
  videoId: z.uuid(),
  reason: z.enum(VIDEO_DISABLED_REASONS, {
    error: DISABLE_COPY.reasonRequired,
  }),
  note: noteField,
  sweepOnly: z.boolean().default(false),
});
export type AdminDisableVideoInput = z.input<typeof AdminDisableVideoSchema>;
/** Disable's input as parsed: a known reason, the note trimmed or undefined, sweepOnly false unless sent. */
export type AdminDisableVideoData = z.output<typeof AdminDisableVideoSchema>;

/** Enable video: the video only. */
export const AdminEnableVideoSchema = z.object({ videoId: z.uuid() });
export type AdminEnableVideoInput = z.input<typeof AdminEnableVideoSchema>;

/** Revoke license (05 §7 callout 10; 07 D86): the license, a required reason and the optional note. */
export const AdminRevokeLicenseSchema = z.object({
  licenseId: z.uuid(),
  reason: z.enum(LICENSE_REVOKED_REASONS, {
    error: DISABLE_COPY.reasonRequired,
  }),
  note: noteField,
});
export type AdminRevokeLicenseInput = z.input<typeof AdminRevokeLicenseSchema>;

/** Retry a failed (or stuck) money movement (05 §7 callout 9; 07 D75): the movement only. */
export const AdminRetryMoneyMovementSchema = z.object({ movementId: z.uuid() });
export type AdminRetryMoneyMovementInput = z.input<
  typeof AdminRetryMoneyMovementSchema
>;
