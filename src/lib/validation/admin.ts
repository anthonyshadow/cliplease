// The admin actions' schemas (02 §6.1), shared by the actions, the domain functions and the Disable sheet. P21b adds
// AdminRevokeLicenseSchema.
import { z } from "zod";
import { DISABLE_COPY } from "../admin/copy";
import { VIDEO_DISABLED_REASONS } from "../domain/values";

/** The admin's note on a disabled video (05 §7): admins only, never a creator page. */
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
