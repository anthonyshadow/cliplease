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

/** A settings-like page's one column (07 D145: Settings, Connections): 640 px, left-aligned with the title at every tier. */
export const SETTINGS_COLUMN =
  "flex w-full max-w-reading flex-col gap-6 py-6 lg:py-12";

/** A full-width page's one column inside <main> (the Library, 07 D145): the `max-w-app` width, with the same rhythm. */
export const WIDE_COLUMN = "flex flex-col gap-6 py-6 lg:py-12";

/** The Library grid (04 §5.2.4, 07 D146): 2 columns below md, then 10 rem auto-fill tracks; on the <ul> itself. */
export const LIBRARY_GRID =
  "grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]";
