import {
  LIBRARY_SUBTITLE,
  LIBRARY_TITLE,
  LIBRARY_TITLE_ID,
} from "./library-messages";

/** S12's two-tone title (05 §6.1 callout 2), shared by the page and its error state; it takes the focus a sync hands on. */
export function LibraryTitle() {
  return (
    <h1
      id={LIBRARY_TITLE_ID}
      tabIndex={-1}
      className="text-title-1 text-ink outline-none"
    >
      {LIBRARY_TITLE} <span className="text-ink-2">{LIBRARY_SUBTITLE}</span>
    </h1>
  );
}
