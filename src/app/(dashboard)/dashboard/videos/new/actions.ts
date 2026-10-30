"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { type ActionError, fieldError, formText } from "@/lib/result";
import { createVideoSchema } from "@/lib/validation/video";
import {
  type MakeLicensableRefusal,
  makeLicensableMessage,
} from "@/lib/videos/source-page";
import { NEW_VIDEO_PATH, videoStepHref } from "@/lib/videos/steps";
import { titleMessage } from "@/lib/videos/title";
import { requireCreator, toActor } from "@/server/auth/session";
import { getLibraryPost } from "@/server/library/queries";
import { redactErrors } from "@/server/rethrow-redacted";
import {
  createVideoFromPost as createVideoFromPostFor,
  createVideoFromUpload as createVideoFromUploadFor,
} from "@/server/videos/create";
import { makeLicensableErrorCode } from "@/server/videos/errors";

export type CreateVideoState = ActionError | null;

/** S18's Continue (07 D39): a self-attested draft from the title, then its File step. */
export async function createVideoFromUpload(
  _previous: CreateVideoState,
  formData: FormData,
): Promise<CreateVideoState> {
  return redactErrors("video.create_failed", async () => {
    const ctx = await requireCreator(NEW_VIDEO_PATH);
    const title = formText(formData, "title");
    const parsed = createVideoSchema.safeParse({ title });
    if (!parsed.success) {
      return fieldError("invalid_input", "title", titleMessage(title));
    }
    const { videoId } = await createVideoFromUploadFor(
      toActor(ctx),
      parsed.data,
    );
    redirect(videoStepHref(videoId, "file"));
  });
}

export type MakeLicensableState = MakeLicensableRefusal | null;

const makeLicensableInput = z.object({ socialPostId: z.uuid() });

/**
 * S16's Make licensable (02 §6.1; 07 D39): the live ownership check and the verified draft, then its File step; a
 * second press opens the same video. A post the Source page wouldn't show is a 404, as is a malformed id. The page's own
 * read also names the platform in the refusals (01 J5.2–J5.4, 07 D18), which the page words with the same function.
 */
export async function createVideoFromPost(
  _previous: MakeLicensableState,
  formData: FormData,
): Promise<MakeLicensableState> {
  return redactErrors("video.make_licensable_failed", async () => {
    const ctx = await requireCreator();
    const parsed = makeLicensableInput.safeParse({
      socialPostId: formText(formData, "socialPostId"),
    });
    if (!parsed.success) notFound();
    const actor = toActor(ctx);
    const post = await getLibraryPost(actor, parsed.data.socialPostId);
    if (!post) notFound();
    let videoId: string;
    try {
      ({ videoId } = await createVideoFromPostFor(actor, post.id));
    } catch (error) {
      const code = makeLicensableErrorCode(error);
      if (code === null) throw error;
      if (code === "not_found") notFound();
      return {
        ok: false,
        error: { code, message: makeLicensableMessage(code, post.platform) },
      };
    }
    redirect(videoStepHref(videoId, "file"));
  });
}
