import type { Page, Request } from "@playwright/test";
import { isServerAction } from "./press";

// What the page asks the network for, for the "nothing leaves the browser" checks (07 D42, D67: images come through our
// proxy, and a pasted link is parsed, never fetched) and the "nothing is sent" ones (07 D13: opening the Library syncs
// nothing; a step's Continue sends nothing while the browser can still refuse it).

/** The e2e server's own hosts. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** An http(s) request to a host other than the e2e server. */
const isExternal = (request: Request) => {
  const url = new URL(request.url());
  return url.protocol.startsWith("http") && !LOCAL_HOSTS.has(url.hostname);
};

/** Every http(s) request the page sends from now on to a host other than the e2e server, by URL. */
export function trackExternalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on("request", (request) => {
    if (isExternal(request)) external.push(request.url());
  });
  return external;
}

/** Every Server Action the page sends from now on, by URL. */
export function trackServerActions(page: Page): string[] {
  const actions: string[] = [];
  page.on("request", (request) => {
    if (isServerAction(request)) actions.push(request.url());
  });
  return actions;
}

/**
 * A router RSC fetch: a GET whose query carries `_rsc` (a next/link prefetch, or the data behind a client navigation).
 * The production build prefetches every link in view, so these come and go on their own and are never the page's code.
 */
const isRouterRsc = (request: Request) =>
  request.method() === "GET" && new URL(request.url()).searchParams.has("_rsc");

/**
 * Every fetch or XHR the page's own code sends from now on (a Server Action among them), as "METHOD path"; the router's
 * RSC prefetches are left out (isRouterRsc).
 */
export function trackPageFetches(page: Page): string[] {
  const fetches: string[] = [];
  page.on("request", (request) => {
    const type = request.resourceType();
    if ((type === "fetch" || type === "xhr") && !isRouterRsc(request)) {
      fetches.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  return fetches;
}
