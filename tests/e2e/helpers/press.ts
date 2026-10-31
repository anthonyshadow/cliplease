import type { Locator, Page, Request } from "@playwright/test";

/** Focuses the control and presses Enter: on the iPhone a click near the bottom can land on the fixed TabBar. */
export async function pressLocator(control: Locator) {
  await control.focus();
  await control.press("Enter");
}

const pressControl = (page: Page, role: "button" | "link", name: string) =>
  pressLocator(page.getByRole(role, { name, exact: true }));

export const pressButton = (page: Page, name: string) =>
  pressControl(page, "button", name);

export const pressLink = (page: Page, name: string) =>
  pressControl(page, "link", name);

/** A Server Action call: a POST with the next-action header. */
export const isServerAction = (request: Request) =>
  request.method() === "POST" && request.headers()["next-action"] !== undefined;

/**
 * router.refresh()'s fetch (AutoRefresh's focus and 30 s refreshes): an RSC GET with no prefetch header, as a client
 * navigation's is. A test lets it end before it leaves the page: WebKit cancels the old page's fetches once a navigation
 * starts, and Next answers a failed one by loading the page itself, which interrupts the test's goto.
 */
export const isRouterRefresh = (request: Request) =>
  request.method() === "GET" &&
  request.headers().rsc === "1" &&
  request.headers()["next-router-prefetch"] === undefined;

/** Settles once the first request from now on that `match` takes has ended either way: finished, or failed. */
export function requestEnded(
  page: Page,
  match: (request: Request) => boolean,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const onEnd = (request: Request) => {
      if (!match(request)) return;
      page.off("requestfinished", onEnd);
      page.off("requestfailed", onEnd);
      resolve();
    };
    page.on("requestfinished", onEnd);
    page.on("requestfailed", onEnd);
  });
}

/**
 * pressButton, then waits until its server action's request has closed. The action's value comes first and the
 * re-rendered page streams after it, so a toast can show while the response is still open, and a navigation then
 * cancels it (WebKit logs "TypeError: Load failed"). Chromium sometimes closes the stream itself once the page has
 * what it needs, which Playwright reports as a failed request, so either end counts.
 */
export async function pressAndSettle(page: Page, name: string) {
  const closed = requestEnded(page, isServerAction);
  await pressButton(page, name);
  await closed;
}

/** pressAndSettle for the button named `name` inside `scope`: Settings has a Save in Profile and one in Requests. */
export async function pressAndSettleIn(
  page: Page,
  scope: Locator,
  name: string,
) {
  const closed = requestEnded(page, isServerAction);
  await pressLocator(scope.getByRole("button", { name, exact: true }));
  await closed;
}

/** A bounded wait inside the page, for "nothing more happens" checks. */
export const waitInPage = (page: Page, ms: number) =>
  page.evaluate(
    (delay) => new Promise<void>((resolve) => setTimeout(resolve, delay)),
    ms,
  );

declare global {
  interface Window {
    __countPress?: () => void;
  }
}

/** Reports each real press to the test: a pointer down, or Enter or Space pressed. */
function listenForPresses() {
  const count = (event: Event) => {
    if (event.isTrusted) window.__countPress?.();
  };
  window.addEventListener("pointerdown", count, true);
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" || event.key === " ") count(event);
    },
    true,
  );
}

/**
 * Counts the presses the test makes on the page from now on, in this document and every one it loads (S10's taps).
 * File choosers set by the test (setInputFiles) aren't presses, so the caller adds those.
 */
export async function countPresses(page: Page): Promise<() => number> {
  let presses = 0;
  await page.exposeFunction("__countPress", () => {
    presses += 1;
  });
  await page.addInitScript(listenForPresses);
  await page.evaluate(listenForPresses);
  return () => presses;
}
