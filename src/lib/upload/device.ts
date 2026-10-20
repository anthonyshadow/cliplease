// Device checks for the File step's iPhone hint (04 §9.26). A device check, never a layout rule (07 D152). Pure.

/** iPhone, iPad or iPod in the user agent, or iPadOS's desktop user agent ("Macintosh") with a touch screen. */
export function isIosDevice(
  userAgent: string,
  maxTouchPoints: number,
): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}
