import { expect, type Page } from "@playwright/test";

/**
 * A failed response the page is expected to log, e.g. a document 404 or the 400 from a wrong sign-in code; or, with
 * `abortedUnder`, the requests under that path a test cut off with route.abort('failed') (Chromium logs each one;
 * WebKit logs none); or, with `offline`, the router's RSC fetches that a test's context.setOffline(true) cut short.
 */
export type ExpectedFailure =
  | { status: number; pathname: string }
  | { abortedUnder: string }
  | { offline: true };

// How every failed load's console error starts. Next prefetches the NavBar's links in the background after a page loads;
// a test that goes offline right then cuts them, and each browser logs its own network error with no status (Chromium
// "net::ERR_INTERNET_DISCONNECTED", WebKit "WebKit encountered an internal error"). Seen in 2 of 8 runs of Q-47.
const FAILED_LOAD = "Failed to load resource: ";
const FAILED_RESOURCE = /^Failed to load resource: .*status of (\d{3})\b/;
const ROUTE_ABORTED = `${FAILED_LOAD}net::ERR_FAILED`;
// WebKit reports a fetch that a navigation cancels as a page error ("<url> due to access control checks."). Next's
// background RSC prefetches hit it whenever a test leaves a page right after loading it (seen in 14 of 40 probe runs);
// Chromium stays quiet. For a router RSC fetch it is not an app error.
const CANCELLED_FETCH = /(\S+) due to access control checks\.$/;
// WebKit also logs the same cancelled prefetch as a console error "TypeError: Load failed" from Next's chunk, e.g. a page
// with a loading.tsx (the Library, P09) still prefetching when the test leaves. One such entry is dropped for each
// router RSC fetch the browser reports cancelled; any other failed fetch still counts.
const LOAD_FAILED = "TypeError: Load failed";

// WebKit logs a blob: load the page cut short on purpose as a failed resource: the File step detaches its hidden
// <video> and revokes the file's object URL once the metadata is read (P10b), and the read may still be under way.
const CANCELLED_BLOB_LOAD = "(WebKitBlobResource error 1.)";

/**
 * The router's own RSC fetches (a prefetch, or the dynamic data Next loads behind it): their URL's query carries
 * `_rsc`. WebKit's page error can name the URL without its scheme ("/localhost:3100/?_rsc=…"), so it is matched as text.
 */
const isRouterRscUrl = (u: string) => /[?&]_rsc=/.test(u);

/**
 * The page's console errors and uncaught errors from now on. A browser logs every failed response as "Failed to load
 * resource: … status of 404 …"; only the failures listed in `expected`, WebKit's cancelled RSC fetches and its
 * cancelled blob: loads are left out.
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
    // Never an action's POST.
    if (
      request.method() === "GET" &&
      isRouterRscUrl(request.url()) &&
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
    const pathname = URL.canParse(url) ? new URL(url).pathname : null;
    const isExpected =
      (pathname !== null &&
        expected.some((failure) => {
          if ("abortedUnder" in failure) {
            return (
              text === ROUTE_ABORTED &&
              pathname.startsWith(failure.abortedUnder)
            );
          }
          if ("offline" in failure) {
            return (
              text.startsWith(FAILED_LOAD) &&
              status === undefined &&
              isRouterRscUrl(url)
            );
          }
          return (
            String(failure.status) === status && pathname === failure.pathname
          );
        })) ||
      (url.startsWith("blob:") && text.endsWith(CANCELLED_BLOB_LOAD));
    if (!isExpected) errors.push(text);
    if (text === LOAD_FAILED && url.includes("/_next/static/chunks/")) {
      dropCancelledPrefetches();
    }
  });
  page.on("pageerror", (error) => {
    const url = CANCELLED_FETCH.exec(error.message)?.[1] ?? "";
    if (!isRouterRscUrl(url)) errors.push(error.message);
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
