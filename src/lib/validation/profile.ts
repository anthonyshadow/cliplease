// The profile step's schemas and copy (02 §6.1, 07 D93), shared by the onboarding and Settings actions and the domain
// functions. The client forms import the display-name limit from ./display-name instead, which has no Zod.
import { z } from "zod";
import { APP_NAME } from "../app-name";
import { DISPLAY_NAME_MAX, displayNameMessage } from "./display-name";
import { HANDLE_COPY, HANDLE_RE, handleProblemMessage } from "./handle";

export const AGE_ERROR = `You must be 18 or older to sell on ${APP_NAME}.`;

// Trimmed, 1 to DISPLAY_NAME_MAX characters: the one definition of a valid display name.
const displayNameField = z.string().trim().min(1).max(DISPLAY_NAME_MAX);

/** 02 §6.1's completeOnboarding schema, with `{APP_NAME}` filled in the 18+ message (AGE_ERROR). */
export const profileStepSchema = z.object({
  displayName: displayNameField,
  handle: z.string().regex(HANDLE_RE),
  ageConfirmed: z.literal(true, { error: AGE_ERROR }),
  timeZone: z.string().max(64).optional(),
});

export const displayNameSchema = z.object({ displayName: displayNameField });

/** Field errors for a refused profile step, in the docs' words (never Zod's own text). */
export function profileStepFieldErrors(
  error: z.ZodError,
  input: { displayName: string; handle: string },
): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0]);
    if (fields[field]) continue;
    if (field === "displayName") {
      fields.displayName = [displayNameMessage(input.displayName)];
    } else if (field === "handle") {
      fields.handle = [
        handleProblemMessage(input.handle) ?? HANDLE_COPY.characters,
      ];
    } else if (field === "ageConfirmed") {
      fields.ageConfirmed = [AGE_ERROR];
    }
  }
  return fields;
}
