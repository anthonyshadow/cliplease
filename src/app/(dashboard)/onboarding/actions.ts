"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionError, fieldError, formText } from "@/lib/result";
import { HANDLE_COPY, normalizeHandleInput } from "@/lib/validation/handle";
import {
  profileStepFieldErrors,
  profileStepSchema,
} from "@/lib/validation/profile";
import { requireUser } from "@/server/auth/session";
import {
  completeOnboarding as completeOnboardingFor,
  OnboardingError,
} from "@/server/creators/profile";
import {
  checkHandleAvailability,
  type HandleAvailability,
} from "@/server/creators/queries";

/** The profile step's refusal: a field error, plus fresh suggestions when the handle was just taken. */
export type ProfileStepError = ActionError & { suggestions?: string[] };
export type ProfileStepState = ProfileStepError | null;

const checkHandleInput = z.object({ handle: z.string().max(64) });

/** The live availability line (01 J1.4). */
export async function checkHandle(input: {
  handle: string;
}): Promise<HandleAvailability> {
  await requireUser("/onboarding");
  const { handle } = checkHandleInput.parse(input);
  return checkHandleAvailability(handle);
}

/**
 * Step 1 (05 §5.2): checks the name, the handle and the 18+ tick first; an unticked box returns its field error and
 * nothing is written (07 D93). The handle is normalized as the field does, so a post without JavaScript works too.
 */
export async function completeOnboarding(
  _previous: ProfileStepState,
  formData: FormData,
): Promise<ProfileStepState> {
  const timeZone = formText(formData, "timeZone");
  const input = {
    displayName: formText(formData, "displayName"),
    handle: normalizeHandleInput(formText(formData, "handle")),
    // The checkbox posts "on" only when ticked.
    ageConfirmed: formData.get("ageConfirmed") === "on",
    // A zone longer than 64 characters can't be real; it becomes UTC rather than an error on a hidden field.
    timeZone: timeZone.length <= 64 ? timeZone : undefined,
  };
  const parsed = profileStepSchema.safeParse(input);
  if (!parsed.success) {
    const fields = profileStepFieldErrors(parsed.error, input);
    const message = Object.values(fields)[0]?.[0] ?? HANDLE_COPY.characters;
    return { ok: false, error: { code: "invalid_input", message, fields } };
  }
  const user = await requireUser("/onboarding");
  const { handle } = parsed.data;
  try {
    await completeOnboardingFor(user, {
      ...parsed.data,
      timeZone: parsed.data.timeZone ?? "",
    });
  } catch (error) {
    if (!(error instanceof OnboardingError)) throw error;
    if (error.code === "already_onboarded") redirect("/dashboard");
    if (error.code === "handle_taken") {
      const { suggestions } = await checkHandleAvailability(handle);
      return {
        ...fieldError("handle_taken", "handle", `@${handle} was just taken`),
        suggestions,
      };
    }
    if (error.code === "handle_reserved") {
      return fieldError("handle_reserved", "handle", HANDLE_COPY.reserved);
    }
    return fieldError(error.code, "handle", HANDLE_COPY.characters);
  }
  redirect("/onboarding?step=connect");
}
