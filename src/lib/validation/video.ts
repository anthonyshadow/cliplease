// The video schemas (02 §6.1, 07 D23), shared by the actions and the domain functions. The client forms import the
// title limit and copy from ../videos/title instead, which has no Zod.
import { z } from "zod";
import { TITLE_MAX } from "../videos/title";
import { tidiedText } from "./tidied-text";

/** Tidied (owner answer Q-43 a), then 1 to TITLE_MAX characters: the one definition of a valid title. */
export const titleField = tidiedText(TITLE_MAX);

/** 02 §6.1's createVideoFromUpload input. */
export const createVideoSchema = z.object({ title: titleField });
