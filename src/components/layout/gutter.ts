// Safe-area-aware page gutter for full-width containers (P01 follow-up; 04 §5.3): never narrower than --gutter,
// wider when a landscape iPhone's sensor housing needs it. Kept out of the client modules so Server Components
// receive the string itself, not a client reference.
export const SHELL_GUTTER =
  "pl-[max(var(--gutter),env(safe-area-inset-left))] pr-[max(var(--gutter),env(safe-area-inset-right))]";

/** A page's <main> column: centered at `max-w-app`, with the safe-area gutter. */
export const SHELL_MAIN = `mx-auto w-full max-w-app ${SHELL_GUTTER}`;

/** A reading page's one column inside <main> (04 §5.2.3, 07 D145): 640 px, centered at every tier. */
export const READING_COLUMN =
  "mx-auto flex w-full max-w-reading flex-col gap-6 py-6 lg:py-12";

/** A one-message page's column (05 §10's errors, /r): 640 px, centered, its blocks left-aligned. */
export const MESSAGE_COLUMN =
  "mx-auto flex w-full max-w-reading flex-col items-start gap-4 py-6 lg:py-12";

/** A settings-like page's one column (07 D145: Settings, Connections): 640 px, left-aligned with the title at every tier. */
export const SETTINGS_COLUMN =
  "flex w-full max-w-reading flex-col gap-6 py-6 lg:py-12";

/** A full-width page's one column inside <main> (the Library, 07 D145): the `max-w-app` width, with the same rhythm. */
export const WIDE_COLUMN = "flex flex-col gap-6 py-6 lg:py-12";

/** The Library grid (04 §5.2.4, 07 D146): 2 columns below md, then 10 rem auto-fill tracks; on the <ul> itself. */
export const LIBRARY_GRID =
  "grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]";

/** The video grids, /dashboard/videos and the public /@handle (04 §9.27, 07 D146): 2 / 3 / 4 / 5 columns. */
export const VIDEO_GRID =
  "grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5";

/**
 * A two-column creator page (07 D146; 04 §5.2.4; 05 §1.6 S17): one centered max-w-reading column below lg, in the
 * Mobile order; from lg the two columns of 05 §6.5's Desktop frame in the max-w-app width, 5 + 7 of 12 with a 48 px gap.
 * `page` is the grid; its children place themselves with `span` (above both columns: the back link, the Stepper), `side`
 * (the video, left) and `main` (the step, right).
 */
export const TWO_COLUMN = {
  page: "mx-auto grid w-full max-w-reading grid-cols-1 gap-6 py-6 lg:max-w-app lg:grid-cols-12 lg:items-start lg:gap-x-12 lg:py-12",
  span: "min-w-0 lg:col-span-12",
  side: "min-w-0 lg:col-span-5",
  main: "min-w-0 lg:col-span-7",
} as const;

/**
 * The license page (07 D148; 04 §5.2.3; 05 §1.6 S01): one centered max-w-reading column below lg (Mobile, Tablet); from
 * lg two columns in max-w-license (1056, not widened at XL), 12 of them with a 48 px gap: `side` (poster, ownership,
 * postings, notices) in 1–5, `main` (options, summary, details) in 7–12. From lg the PriceBar is fixed under the NavBar,
 * so the grid starts below it; `side` sticks 24 px under both bars and is capped at the window, scrolling inside itself
 * when taller (its 4 px inset keeps focus rings inside the scroll box; SC 2.4.11).
 */
export const LICENSE_COLUMNS = {
  page: "mx-auto grid w-full max-w-reading grid-cols-1 gap-8 py-6 lg:max-w-license lg:grid-cols-12 lg:items-start lg:gap-x-12 lg:pt-[calc(var(--pricebar-h)+1.5rem)] lg:pb-12",
  side: "flex min-w-0 flex-col gap-6 lg:sticky lg:top-[calc(var(--nav-h)+var(--pricebar-h)+1.5rem)] lg:col-span-5 lg:-m-1 lg:max-h-[calc(100svh-var(--nav-h)-var(--pricebar-h)-3rem)] lg:overflow-y-auto lg:p-1",
  main: "flex min-w-0 flex-col gap-8 lg:col-span-6 lg:col-start-7",
} as const;
