import { expect, test } from "@playwright/test";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { requestDetailPath } from "../../src/lib/urls";
import {
  adminRequestRow,
  adminRequestStatusText,
  openAdminTab,
} from "./helpers/admin";
import { BUYER_PHONE } from "./helpers/buyer";
import { collectConsoleErrors } from "./helpers/console";
import { buyLicense, publishFromLibrary } from "./helpers/flows";
import {
  forceRequestOverdue,
  ORGANIC_30_WORLDWIDE,
  storedRequestStatus,
} from "./helpers/licenses";
import { ADMIN_STATE, CREATOR_STATE, setupCreatorTile } from "./helpers/run";
import { uniqueEmail } from "./helpers/sign-in";
import { cleanCreatedVideos } from "./helpers/videos";

// An unanswered request expires on the cron, uncharged (P22; 01 J8.6; 02 §8.4; 07 D51, D57; design/P22-demo-gate-a.md
// §2–§3) on chromium-desktop and webkit-iphone. The setup creator (.auth/creator.json, in a context of its own)
// publishes a Library tile of its own per project (run.ts); a logged-out buyer pays and its page closes at once, so no /r read can
// expire the request lazily, and no creator page reads it either (never the Inbox: its lazy sweep would expire every
// overdue request of this shared creator). The dev clock moves the deadline into the past without calling the cron
// (--no-cron); the spec calls it: 401 without the bearer, 200 with it and the route's five counts (never how many it
// expired: the other project's run of this spec can sweep this row first). Admin loaders never expire anything, so the
// admin's Requests row, found by its fake PaymentIntent id, reads Expired before any buyer or creator page loads the
// request; only then /r reads No answer in time, and the creator's request page Expired with no Approve.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const CRON_PATH = "/api/cron/expire-requests";
const REQUEST_ID = /\/r\/([0-9a-f-]{36})\?/;

test("J8.6: an overdue request expires on the cron: 401 without the bearer, 200 with it; the admin row reads Expired before any page loads it, then /r No answer in time and the creator's Expired", async ({
  browser,
  request,
  baseURL,
}, testInfo) => {
  test.setTimeout(300_000);
  const creatorContext = await browser.newContext({
    storageState: CREATOR_STATE,
  });
  const page = await creatorContext.newPage();
  const errors = collectConsoleErrors(page);
  const { url } = await publishFromLibrary(
    page,
    setupCreatorTile(testInfo, "expiry"),
  );

  // Pay, take the id from /r, and close the buyer's page.
  const bought = await buyLicense(browser, url, {
    ...ORGANIC_30_WORLDWIDE,
    email: uniqueEmail(testInfo, "sam"),
  });
  const requestId = REQUEST_ID.exec(bought.statusUrl)?.[1] ?? "";
  expect(requestId).toBe(bought.requestId);
  await bought.context.close();

  // The dev clock without its cron call: the deadline already past.
  forceRequestOverdue(requestId);

  // The cron route: the API's 401 without the bearer, then the run's counts. The bearer goes through the worker's own
  // fetch, never `request`: a retained trace records a traced call's headers.
  const refused = await request.get(CRON_PATH);
  expect(refused.status()).toBe(401);
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET isn't set (.env.test)");
  if (!baseURL) throw new Error("the cron call needs the config's baseURL");
  const ran = await fetch(new URL(CRON_PATH, baseURL), {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(ran.status).toBe(200);
  expect(await ran.json()).toMatchObject({
    expired: expect.any(Number),
    reconciled: expect.any(Number),
    moneyMovements: expect.any(Number),
    autoApprovals: expect.any(Number),
    emailsSent: expect.any(Number),
  });
  // Expired by this run or by the other project's, whose claim may still be finishing when this one answers.
  await expect
    .poll(() => storedRequestStatus(requestId), { timeout: 30_000 })
    .toBe("expired");

  // The admin's row first, moved to the tab's top (the newest 50): its loader expires nothing.
  const adminContext = await browser.newContext({ storageState: ADMIN_STATE });
  const admin = await adminContext.newPage();
  const adminErrors = collectConsoleErrors(admin);
  await openAdminTab(admin, "requests", [requestId]);
  const row = adminRequestRow(admin, requestId);
  await expect(row).toHaveCount(1);
  await expect(
    row.getByText(adminRequestStatusText("expired"), { exact: true }),
  ).toBeVisible();
  await adminContext.close();

  // Only then the buyer's /r, in a fresh logged-out context.
  const buyerContext = await browser.newContext({ viewport: BUYER_PHONE });
  const buyer = await buyerContext.newPage();
  const buyerErrors = collectConsoleErrors(buyer);
  await buyer.goto(bought.statusUrl);
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
    REQUEST_STATUS_COPY.expiredTitle,
  );
  await buyerContext.close();

  // The creator's request page: «Expired», and nothing to approve.
  await page.goto(requestDetailPath(requestId));
  const main = page.locator("main");
  await expect(main.getByText("Expired", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("button", { name: INBOX_COPY.approve, exact: true }),
  ).toHaveCount(0);
  await creatorContext.close();
  expect(buyerErrors).toEqual([]);
  expect(adminErrors).toEqual([]);
  expect(errors).toEqual([]);
});
