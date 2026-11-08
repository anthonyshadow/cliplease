import type { Metadata } from "next";

/**
 * A private page's metadata (07 D61, §9.2; 02 §9.5): no referrer and no index, on /r, /l and My licenses. next.config's
 * header rows cover a document request, but a client navigation never gets them, so each page states them too. Pages
 * spread it and add their title.
 */
export const PRIVATE_PAGE: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
