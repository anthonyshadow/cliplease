// The video title's limit, tidy-up and messages, with no Zod: the client form imports only these. The schema that
// enforces them lives in ../validation/video.
import { tidyText } from "../text/tidy";

/** 07 D23: 1 to 100 characters. */
export const TITLE_MAX = 100;

/** Title errors (proposed copy, owner answer Q-40 a). */
export const TITLE_COPY = {
  empty: "Add a title.",
  long: "Keep it to 100 characters.",
} as const;

/** A title as stored (owner answer Q-43 a): ../text/tidy's rules, which display names share. */
export const tidyTitle = tidyText;

/** The message for a title the schema refused. */
export function titleMessage(raw: string): string {
  return tidyTitle(raw) === "" ? TITLE_COPY.empty : TITLE_COPY.long;
}
