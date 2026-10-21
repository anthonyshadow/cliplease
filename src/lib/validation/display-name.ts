// The display-name limit and its messages, with no Zod: the client forms import only these, so the browser never loads
// the validation library for them. The schemas that enforce the limit live in ./profile.
import { tidyText } from "../text/tidy";

export const DISPLAY_NAME_MAX = 60;

/** Display-name errors (proposed copy, owner answer Q3). */
export const DISPLAY_NAME_COPY = {
  empty: "Enter your name.",
  long: "Use 60 characters or fewer.",
} as const;

/** The message for a display name the schema refused. */
export function displayNameMessage(raw: string): string {
  return tidyText(raw) === ""
    ? DISPLAY_NAME_COPY.empty
    : DISPLAY_NAME_COPY.long;
}
