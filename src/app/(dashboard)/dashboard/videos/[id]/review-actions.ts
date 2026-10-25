"use server";

import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import type { PayoutsStatus, VideoStatus } from "@/lib/domain/values";
import {
  type ActionResult,
  fieldError,
  fieldErrors,
  formError,
  formText,
} from "@/lib/result";
import { isUuid } from "@/lib/validation/uuid";
import { SLUG_COPY, videoDetailsSchema } from "@/lib/validation/video";
import { RIGHTS_COPY, RIGHTS_LOCK_COPY } from "@/lib/videos/rights";
import { videoHref, videoStepHref } from "@/lib/videos/steps";
import { titleMessage } from "@/lib/videos/title";
import { requireCreator, toActor } from "@/server/auth/session";
import { refreshPayoutsStatus as readPayoutsStatus } from "@/server/creators/profile";
import {
  attestRights as attest,
  updateVideoDetails as updateDetails,
} from "@/server/videos/edit";
import {
  RightsLockedError,
  SlugLockedError,
  SlugTakenError,
  VideoDisabledError,
  VideoNotFoundError,
} from "@/server/videos/errors";

// The Rights and Review steps' Server Actions (02 §6.1): Rights' Continue (attestRights), the Review's Title and Link
// rows (updateVideoDetails) and the payouts Notice's Check again (refreshPayoutsStatus). Thin: Zod at the boundary, the
// session gate, the domain, and its refusals in words. redirect() and notFound() throw, so they stay outside every try.

/** The form's four answers: both boxes ticked ("on") and both questions answered (02 §6.1 as posted). */
const rightsInput = z.object({
  ownsRights: z.literal("on"),
  notReupload: z.literal("on"),
  containsMusic: z.enum(["yes", "no"]),
  identifiablePeople: z.enum(["yes", "no"]),
});

/**
 * Rights → Continue (01 J5.13, J5.14): the answers stored, then Review for a draft and the video's page for a video past
 * its draft (P14b's Rights _Edit_). Locked answers say why (owner answer Q-96 a).
 */
export async function attestRights(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const videoId = formText(formData, "videoId");
  if (!isUuid(videoId)) notFound();
  const parsed = rightsInput.safeParse({
    ownsRights: formText(formData, "ownsRights"),
    notReupload: formText(formData, "notReupload"),
    containsMusic: formText(formData, "containsMusic"),
    identifiablePeople: formText(formData, "identifiablePeople"),
  });
  if (!parsed.success) return formError("invalid_input", RIGHTS_COPY.answerAll);
  const ctx = await requireCreator(videoStepHref(videoId, "rights"));
  let status: VideoStatus;
  try {
    status = await attest(toActor(ctx), {
      videoId,
      ownsRights: true,
      containsMusic: parsed.data.containsMusic === "yes",
      identifiablePeople: parsed.data.identifiablePeople === "yes",
    });
  } catch (error) {
    if (error instanceof RightsLockedError) {
      return formError("rights_locked", RIGHTS_LOCK_COPY[error.lock]);
    }
    if (error instanceof VideoDisabledError) return formError("video_disabled");
    if (!(error instanceof VideoNotFoundError)) throw error;
    notFound();
  }
  redirect(
    status === "draft" ? videoStepHref(videoId, "review") : videoHref(videoId),
  );
}

/** The details action's shape, checked before anything reads it (a Server Action takes any value). */
const detailsInput = z.object({
  videoId: z.string(),
  title: z.string().optional(),
  slug: z.string().optional(),
});

/**
 * The Title and Link rows of the Review and of the video page (02 §6.1; 07 D09, D23): the row being saved, then the
 * page again. A refused title reads as on the title page ("Add a title.", titleMessage); a refused link, its first
 * message.
 */
export async function updateVideoDetails(input: {
  videoId: string;
  title?: string;
  slug?: string;
}): Promise<ActionResult> {
  const shaped = detailsInput.safeParse(input);
  if (!shaped.success) return formError("invalid_input");
  const { videoId, title } = shaped.data;
  if (!isUuid(videoId)) notFound();
  const parsed = videoDetailsSchema.safeParse(shaped.data);
  if (!parsed.success) {
    const { issues } = parsed.error;
    const slugIssue = issues.find((issue) => issue.path[0] === "slug");
    const fields = [
      ...(title !== undefined && issues.some((i) => i.path[0] === "title")
        ? [["title", titleMessage(title)] as const]
        : []),
      ...(slugIssue ? [["slug", slugIssue.message] as const] : []),
    ];
    return fields.length > 0
      ? fieldErrors("invalid_input", fields)
      : formError("invalid_input");
  }
  // Back to the video after a sign-in: a draft's Review, or the page of a video past its draft.
  const ctx = await requireCreator(videoHref(videoId));
  try {
    await updateDetails(toActor(ctx), parsed.data);
  } catch (error) {
    if (error instanceof SlugTakenError) {
      return fieldError("slug_taken", "slug", SLUG_COPY.taken);
    }
    if (error instanceof SlugLockedError) {
      return fieldError("slug_locked", "slug", SLUG_COPY.locked);
    }
    if (error instanceof VideoDisabledError) return formError("video_disabled");
    if (!(error instanceof VideoNotFoundError)) throw error;
    notFound();
  }
  refresh();
  return { ok: true, data: undefined };
}

/**
 * The payouts Notice's Check again (02 §6.1): the status read from the payments driver now (`maxAgeMs: 0`; a reload
 * would reuse the 10-minute read), then the page again when it changed (the button says what it found either way). A
 * failed read says so; the page keeps the stored status.
 */
export async function refreshPayoutsStatus(): Promise<
  ActionResult<{ payoutsStatus: PayoutsStatus }>
> {
  const ctx = await requireCreator();
  let payoutsStatus: PayoutsStatus;
  try {
    payoutsStatus = await readPayoutsStatus(ctx.creator.id, {
      maxAgeMs: 0,
      row: ctx.creator,
    });
  } catch {
    return formError("failed");
  }
  if (payoutsStatus !== ctx.creator.payoutsStatus) refresh();
  return { ok: true, data: { payoutsStatus } };
}
