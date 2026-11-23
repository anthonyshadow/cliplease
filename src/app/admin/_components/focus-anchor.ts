/** Where a row's action hands the focus on once it is gone (useFocusHandOff): its row's anchor, else its list's. */
export type FocusAnchorScope = "row" | "list";

/**
 * Makes an element a stable place for the focus to land once a row's action is gone: a row's (its license code) or a
 * list's (its heading). Focused by script only (tabIndex -1). Plain props, so a server component's cells can carry it.
 */
export const focusAnchor = (scope: FocusAnchorScope) =>
  ({ "data-focus-anchor": scope, tabIndex: -1 }) as const;

/** The selector of `scope`'s anchor. */
export const focusAnchorSelector = (scope: FocusAnchorScope) =>
  `[data-focus-anchor="${scope}"]`;
