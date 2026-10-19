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
