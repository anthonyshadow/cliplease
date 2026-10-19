import type { Page, Request } from "@playwright/test";

/** Focuses the control and presses Enter: on the iPhone a click near the bottom can land on the fixed TabBar. */
async function pressControl(page: Page, role: "button" | "link", name: string) {
  const control = page.getByRole(role, { name, exact: true });
  await control.focus();
  await control.press("Enter");
}

export const pressButton = (page: Page, name: string) =>
  pressControl(page, "button", name);

export const pressLink = (page: Page, name: string) =>
  pressControl(page, "link", name);

/** A Server Action call: a POST with the next-action header. */
export const isServerAction = (request: Request) =>
  request.method() === "POST" && request.headers()["next-action"] !== undefined;

/**
 * pressButton, then waits until its server action's request has closed. The action's value comes first and the
 * re-rendered page streams after it, so a toast can show while the response is still open, and a navigation then
 * cancels it (WebKit logs "TypeError: Load failed"). Chromium sometimes closes the stream itself once the page has
 * what it needs, which Playwright reports as a failed request, so either end counts.
 */
export async function pressAndSettle(page: Page, name: string) {
  const closed = new Promise<void>((resolve) => {
    const onEnd = (request: Request) => {
      if (!isServerAction(request)) return;
      page.off("requestfinished", onEnd);
      page.off("requestfailed", onEnd);
      resolve();
    };
    page.on("requestfinished", onEnd);
    page.on("requestfailed", onEnd);
  });
  await pressButton(page, name);
  await closed;
}
