// Safe-area-aware page gutter for full-width containers (P01 follow-up; 04 §5.3): never narrower than --gutter,
// wider when a landscape iPhone's sensor housing needs it. Kept out of the client modules so Server Components
// receive the string itself, not a client reference.
export const SHELL_GUTTER =
  "pl-[max(var(--gutter),env(safe-area-inset-left))] pr-[max(var(--gutter),env(safe-area-inset-right))]";

/** A page's <main> column: centered at `max-w-app`, with the safe-area gutter. */
export const SHELL_MAIN = `mx-auto w-full max-w-app ${SHELL_GUTTER}`;
