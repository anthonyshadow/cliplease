"use server";

import { redirect } from "next/navigation";
import { type ActionError, fieldError, formText } from "@/lib/result";
import { createVideoSchema } from "@/lib/validation/video";
import { videoStepHref } from "@/lib/videos/steps";
import { titleMessage } from "@/lib/videos/title";
import { requireCreator, toActor } from "@/server/auth/session";
import { createVideoFromUpload as createVideoFromUploadFor } from "@/server/videos/create";

export type CreateVideoState = ActionError | null;

/** S18's Continue (07 D39): a self-attested draft from the title, then its File step. */
export async function createVideoFromUpload(
  _previous: CreateVideoState,
  formData: FormData,
): Promise<CreateVideoState> {
  const ctx = await requireCreator("/dashboard/videos/new");
  const title = formText(formData, "title");
  const parsed = createVideoSchema.safeParse({ title });
  if (!parsed.success) {
    return fieldError("invalid_input", "title", titleMessage(title));
  }
  const { videoId } = await createVideoFromUploadFor(toActor(ctx), parsed.data);
  redirect(videoStepHref(videoId, "file"));
}
