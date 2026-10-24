// The video schemas (02 §6.1, 07 D23), shared by the actions and the domain functions. The client forms import the
// title limit and copy from ../videos/title instead, which has no Zod.
import { z } from "zod";
import { REVIEW_COPY } from "../videos/review";
import { TITLE_MAX } from "../videos/title";
import { SLUG_MAX_LENGTH, SLUG_RE } from "./handle";
import { tidiedText } from "./tidied-text";

/** Tidied (owner answer Q-43 a), then 1 to TITLE_MAX characters: the one definition of a valid title. */
export const titleField = tidiedText(TITLE_MAX);

/** 02 §6.1's createVideoFromUpload input. */
export const createVideoSchema = z.object({ title: titleField });

/** The Link row's messages (proposed copy, owner answer Q-98; "Use 60 characters or fewer." is P05's). */
export const SLUG_COPY = {
  format: "Use lowercase letters, numbers and hyphens.",
  tooLong: `Use ${SLUG_MAX_LENGTH} characters or fewer.`,
  taken: "That link is taken.",
  locked: REVIEW_COPY.linkHelper,
} as const;

/** An edited slug, trimmed and lowercased (Q-98), then SLUG_RE within SLUG_MAX_LENGTH: refused, never re-suffixed. */
export const slugField = z
  .string()
  .transform((slug) => slug.trim().toLowerCase())
  .pipe(
    z
      .string()
      .max(SLUG_MAX_LENGTH, { error: SLUG_COPY.tooLong })
      .regex(SLUG_RE, { error: SLUG_COPY.format }),
  );

/**
 * 02 §6.1's updateVideoDetails input: the title, the slug, or both. The Review sends only the row being saved, so a
 * value it rendered earlier never overwrites a newer one (another tab's).
 */
export const videoDetailsSchema = z
  .object({
    videoId: z.uuid(),
    title: titleField.optional(),
    slug: slugField.optional(),
  })
  .refine((input) => input.title !== undefined || input.slug !== undefined);
