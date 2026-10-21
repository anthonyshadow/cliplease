/**
 * A plain primary click that nothing has handled yet. A Cmd, Ctrl, Shift or Alt click (a new tab or window, a download)
 * or another button belongs to the browser, so a link that works in place lets it follow its href.
 */
export function isPlainClick(
  event: Pick<
    MouseEvent,
    | "button"
    | "metaKey"
    | "ctrlKey"
    | "shiftKey"
    | "altKey"
    | "defaultPrevented"
  >,
): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}
