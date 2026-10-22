// "Where was it posted?" limits (07 §7.2, 02 §5.12). Client-safe: the picker, the save action's Zod shape and the parser
// share them.

/** Postings per video, the source posting included. */
export const POSTINGS_MAX = 12;
/** The longest paste the parser reads, and the longest canonical url it stores (CHECK video_posting_url_shape). */
export const POSTING_URL_MAX = 2048;
/** The creator's name for an Other posting, trimmed (CHECK video_posting_other_label). */
export const POSTING_OTHER_LABEL_MAX = 40;
