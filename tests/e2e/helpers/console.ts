import { expect, type Page } from "@playwright/test";

/** A failed response the page is expected to log, e.g. a document 404 or the 400 from a wrong sign-in code. */
export type ExpectedFailure = { status: number; pathname: string };

const FAILED_RESOURCE = /^Failed to load resource: .*status of (\d{3})\b/;
// WebKit reports a fetch that a navigation cancels as a page error ("…/x?_rsc=… due to access control checks."). Next's
// background RSC prefetches hit it whenever a test leaves a page right after loading it (seen in 14 of 40 probe runs);
// Chromium stays quiet. It is not an app error.
const CANCELLED_RSC_FETCH = /\?_rsc=\S+ due to access control checks\.$/;
// WebKit also logs the same cancelled prefetch as a console error "TypeError: Load failed" from Next's chunk, e.g. a page
// with a loading.tsx (the Library, P09) still prefetching when the test leaves. One such entry is dropped for each
// router RSC fetch the browser reports cancelled; any other failed fetch still counts.
const LOAD_FAILED = "TypeError: Load failed";

/**
 * The page's console errors and uncaught errors from now on. A browser logs every failed response as "Failed to load
 * resource: … status of 404 …"; only the failures listed in `expected`, and WebKit's cancelled RSC fetches, are left
 * out.
 */
export function collectConsoleErrors(
  page: Page,
  expected: ExpectedFailure[] = [],
): string[] {
  const errors: string[] = [];
  let cancelledPrefetches = 0;
  const dropCancelledPrefetches = () => {
    while (cancelledPrefetches > 0) {
      const at = errors.indexOf(LOAD_FAILED);
      if (at === -1) return;
      errors.splice(at, 1);
      cancelledPrefetches -= 1;
    }
  };
  page.on("requestfailed", (request) => {
    // The router's own RSC fetches only (a prefetch, or the dynamic data Next loads behind it), never an action's POST.
    if (
      request.method() === "GET" &&
      request.url().includes("_rsc=") &&
      request.failure()?.errorText === "cancelled"
    ) {
      cancelledPrefetches += 1;
      dropCancelledPrefetches();
    }
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const status = FAILED_RESOURCE.exec(text)?.[1];
    const url = message.location().url;
    const isExpected =
      status !== undefined &&
      URL.canParse(url) &&
      expected.some(
        (failure) =>
          String(failure.status) === status &&
          new URL(url).pathname === failure.pathname,
      );
    if (!isExpected) errors.push(text);
    if (text === LOAD_FAILED && url.includes("/_next/static/chunks/")) {
      dropCancelledPrefetches();
    }
  });
  page.on("pageerror", (error) => {
    if (!CANCELLED_RSC_FETCH.test(error.message)) errors.push(error.message);
  });
  return errors;
}

/**
 * Opens `path` with the console collector attached first, checks the response status and returns the collected errors.
 * A 404 page's browser logs the document's own 404; only that entry is ignored, and only when a 404 is expected.
 */
export async function visit(page: Page, path: string, status = 200) {
  const errors = collectConsoleErrors(
    page,
    status === 404 ? [{ status, pathname: path }] : [],
  );
  const response = await page.goto(path);
  expect(response?.status()).toBe(status);
  return errors;
}
