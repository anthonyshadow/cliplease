"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  type ActionError,
  fieldError,
  formText,
  GENERIC_ERROR_MESSAGE,
} from "@/lib/result";
import { DROPZONE_COPY } from "@/lib/upload/messages";
import { isUuid } from "@/lib/validation/uuid";
import { SAME_VIDEO_COPY } from "@/lib/videos/source-page";
import { videoStepHref } from "@/lib/videos/steps";
import { requireCreator, toActor } from "@/server/auth/session";
import { confirmSameVideo as confirmSameVideoFor } from "@/server/videos/edit";
import {
  type ConfirmSameVideoErrorCode,
  confirmSameVideoErrorCode,
} from "@/server/videos/errors";

export type ConfirmSameVideoState = ActionError | null;

// A refusal's words; not_found is the 404 instead. A file replaced since the page loaded asks for the original again;
// an upload never shows the tick.
const CONFIRM_SAME_VIDEO_MESSAGES = {
  original_not_ready: DROPZONE_COPY.continueHelper,
  not_from_library: GENERIC_ERROR_MESSAGE,
} as const satisfies Record<
  Exclude<ConfirmSameVideoErrorCode, "not_found">,
  string
>;

// The checkbox posts "on" only when ticked.
const confirmSameVideoInput = z.strictObject({
  videoId: z.uuid(),
  sameVideo: z.literal("on"),
});

/**
 * The Library File step's Continue (07 D39; P11 stages the tick there, P11c moves it to Where posted, D69): "This file
 * is the same video as the post" sets `same_video_confirmed_at` once, then Rights. Without the tick it answers owner
 * answer Q-64 a's line on the box; an id that isn't the creator's video is the 404 the page gives it.
 */
export async function confirmSameVideo(
  _previous: ConfirmSameVideoState,
  formData: FormData,
): Promise<ConfirmSameVideoState> {
  const videoId = formText(formData, "videoId");
  const ctx = await requireCreator(
    isUuid(videoId) ? videoStepHref(videoId, "file") : "/dashboard/videos",
  );
  const parsed = confirmSameVideoInput.safeParse({
    videoId,
    sameVideo: formText(formData, "sameVideo"),
  });
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "videoId")) {
      notFound();
    }
    return fieldError(
      "invalid_input",
      "sameVideo",
      SAME_VIDEO_COPY.tickToContinue,
    );
  }
  try {
    await confirmSameVideoFor(toActor(ctx), parsed.data.videoId);
  } catch (error) {
    const code = confirmSameVideoErrorCode(error);
    if (code === null) throw error;
    if (code === "not_found") notFound();
    return {
      ok: false,
      error: { code, message: CONFIRM_SAME_VIDEO_MESSAGES[code] },
    };
  }
  redirect(videoStepHref(parsed.data.videoId, "rights"));
}
