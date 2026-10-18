import type { Page, Request } from "@playwright/test";

const isServerAction = (request: Request) =>
  request.method() === "POST" && request.headers()["next-action"] !== undefined;

/**
 * Presses the button `name` with the keyboard (on the iPhone a click near the bottom can land on the fixed TabBar)
 * and waits until its server action's request has closed. The action's value comes first and the re-rendered page
 * streams after it, so a toast can show while the response is still open, and a navigation then cancels it (WebKit
 * logs "TypeError: Load failed"). Chromium sometimes closes the stream itself once the page has what it needs, which
 * Playwright reports as a failed request, so either end counts.
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
  const control = page.getByRole("button", { name, exact: true });
  await control.focus();
  await control.press("Enter");
  await closed;
}
