// The schema of typed text that others read: video titles and display names (owner answer Q-43 a).
import { z } from "zod";
import { tidyText } from "../text/tidy";

/** Tidied (../text/tidy), then 1 to `max` characters. */
export const tidiedText = (max: number) =>
  z.string().transform(tidyText).pipe(z.string().min(1).max(max));
