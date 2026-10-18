// The profile step's rules and copy (02 §6.1, 07 D93). Pure and client-safe: the form, the action and Settings share them.
import { z } from "zod";
import { APP_NAME } from "../app-name";
import { HANDLE_COPY, HANDLE_RE, handleProblemMessage } from "./handle";

export const AGE_ERROR = `You must be 18 or older to sell on ${APP_NAME}.`;

/** Display-name errors (proposed copy, owner answer Q3). */
export const DISPLAY_NAME_COPY = {
  empty: "Enter your name.",
  long: "Use 60 characters or fewer.",
} as const;
export const DISPLAY_NAME_MAX = 60;

/** 02 §6.1's completeOnboarding schema, with `{APP_NAME}` filled in the 18+ message (AGE_ERROR). */
export const profileStepSchema = z.object({
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX),
  handle: z.string().regex(HANDLE_RE),
  ageConfirmed: z.literal(true, { error: AGE_ERROR }),
  timeZone: z.string().max(64).optional(),
});

export const displayNameSchema = z.object({
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX),
});

/** The message for a display name the schema refused. */
export function displayNameMessage(raw: string): string {
  return raw.trim() === "" ? DISPLAY_NAME_COPY.empty : DISPLAY_NAME_COPY.long;
}

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
