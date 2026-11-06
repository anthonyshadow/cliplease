import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { CHECKOUT_COPY } from "../../../src/lib/licensing/checkout-copy";
import { REQUEST_STATUS_COPY } from "../../../src/lib/licensing/request-status";
import { checkTestDatabaseFiles } from "../../helpers/test-database";
import { isRouterRefresh, requestEnded } from "./press";

// The unpaid hold on the fake checkout (owner answers Q-170, Q-175, Q-176; AD-74, AD-76). The last minute is ten minutes
// away, and page.clock moves only the browser while Extend asks the server, so a spec moves the row's times on the
// database's clock. Plain Node, like read-latest-email.ts: the runner has no app environment, so it reaches the database
// through the guard and the URL playwright.config.ts uses, and .env.local can't be reached.

async function withTestDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: checkTestDatabaseFiles(".").DATABASE_URL_UNPOOLED,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * Moves an unpaid request's hold, and its session when given, to that many seconds from the database's now: a negative
 * number is in the past. A page already open learns of it from resyncCheckout.
 */
export async function setCheckoutTimes(
  requestId: string,
  {
    holdInSeconds,
    sessionInSeconds,
  }: { holdInSeconds: number; sessionInSeconds?: number },
): Promise<void> {
  const { rowCount } = await withTestDb((client) =>
    client.query(
      `update license_request
       set checkout_hold_until = now() + make_interval(secs => $2::double precision),
           checkout_expires_at = coalesce(now() + make_interval(secs => $3::double precision), checkout_expires_at)
       where id = $1 and status = 'checkout_pending'`,
      [requestId, holdInSeconds, sessionInSeconds ?? null],
    ),
  );
  if (rowCount !== 1) {
    throw new Error(`setCheckoutTimes: no unpaid request ${requestId}`);
  }
}

export type CheckoutTimes = {
  /** The stored value as text, for an exact comparison. */
  holdUntil: string;
  holdSecondsLeft: number;
  sessionSecondsLeft: number;
};

/** The request's hold and session, read on the database's clock. */
export async function checkoutTimes(requestId: string): Promise<CheckoutTimes> {
  const { rows } = await withTestDb((client) =>
    client.query<CheckoutTimes>(
      `select checkout_hold_until::text as "holdUntil",
              extract(epoch from checkout_hold_until - now())::float8 as "holdSecondsLeft",
              extract(epoch from checkout_expires_at - now())::float8 as "sessionSecondsLeft"
       from license_request
       where id = $1`,
      [requestId],
    ),
  );
  const [times] = rows;
  if (!times) throw new Error(`checkoutTimes: no request ${requestId}`);
  return times;
}

export const holdClock = (page: Page) => page.getByRole("timer");

export const extendButton = (page: Page) =>
  page.getByRole("button", { name: CHECKOUT_COPY.holdExtend, exact: true });

export const backToLicense = (page: Page) =>
  page.getByRole("link", {
    name: REQUEST_STATUS_COPY.backToLicense,
    exact: true,
  });

/** The clock's visible line: after a move the live region beside it holds the same words. */
export const holdLine = (page: Page, text: string) =>
  page.locator("p:not([data-hold-live])", { hasText: text });

/**
 * The clock's listeners are attached. Extend is onClick, unlike Pay's form action, which React replays, so a press before
 * this is lost; hydrated() needs an input this page doesn't have.
 */
export const holdReady = (page: Page) =>
  expect(page.locator("[data-hold-ready]")).toHaveCount(1);

/** Makes an open page read the row again, as a return to its tab does (AD-74 c), and waits for that read to end. */
export async function resyncCheckout(page: Page): Promise<void> {
  await holdReady(page);
  const ended = requestEnded(page, isRouterRefresh);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await ended;
}

/**
 * The tab in the background for `ms`, as switching to a banking app does: visibilitychange to hidden, and no pagehide.
 * Playwright can't hide a tab, so this shadows the document's own value and removes it again.
 */
export const hideTabFor = (page: Page, ms: number) =>
  page.evaluate(async (delay) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, delay));
    Reflect.deleteProperty(document, "visibilityState");
  }, ms);

/** Leaves the page as closing it does. Never page.close(): only a navigation fires pagehide reliably. */
export async function leaveCheckout(page: Page): Promise<void> {
  await holdReady(page);
  await page.goto("about:blank");
}
