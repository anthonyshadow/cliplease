import type { Page } from "@playwright/test";

/** A failed response the page is expected to log, e.g. a document 404 or the 400 from a wrong sign-in code. */
export type ExpectedFailure = { status: number; pathname: string };

const FAILED_RESOURCE = /^Failed to load resource: .*status of (\d{3})\b/;
// WebKit reports a fetch that a navigation cancels as a page error ("…/x?_rsc=… due to access control checks."). Next's
// background RSC prefetches hit it whenever a test leaves a page right after loading it (seen in 14 of 40 probe runs);
// Chromium stays quiet. It is not an app error.
const CANCELLED_RSC_FETCH = /\?_rsc=\S+ due to access control checks\.$/;

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
  });
  page.on("pageerror", (error) => {
    if (!CANCELLED_RSC_FETCH.test(error.message)) errors.push(error.message);
  });
  return errors;
}
