"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionResult,
  fieldError,
  formText,
  GENERIC_ERROR_MESSAGE,
} from "@/lib/result";
import { displayNameMessage } from "@/lib/validation/display-name";
import { displayNameSchema } from "@/lib/validation/profile";
import { requireCreator, toActor } from "@/server/auth/session";
import { updateProfile, updateTimeZone } from "@/server/creators/profile";

/** Profile → Save (07 D20: the display name only). */
export async function saveDisplayName(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const displayName = formText(formData, "displayName");
  const parsed = displayNameSchema.safeParse({ displayName });
  if (!parsed.success) {
    return fieldError(
      "invalid_input",
      "displayName",
      displayNameMessage(displayName),
    );
  }
  const ctx = await requireCreator("/dashboard/settings");
  await updateProfile(toActor(ctx), parsed.data);
  revalidatePath("/dashboard", "layout");
  return { ok: true, data: undefined };
}

const timeZoneInput = z.object({ timeZone: z.string() });

/**
 * Emails → Update from this device (07 D84): the browser's zone. An unknown one, or one over 64 characters, becomes UTC
 * (normalizeTimeZone, as onboarding does); only a non-string is refused.
 */
export async function updateTimeZoneFromDevice(input: {
  timeZone: string;
}): Promise<ActionResult> {
  const ctx = await requireCreator("/dashboard/settings");
  const parsed = timeZoneInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
    };
  }
  await updateTimeZone(toActor(ctx), parsed.data);
  revalidatePath("/dashboard/settings");
  return { ok: true, data: undefined };
}
