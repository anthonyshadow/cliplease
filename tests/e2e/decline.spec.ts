import { expect, test } from "@playwright/test";
import { CHECKOUT_COPY } from "../../src/lib/licensing/checkout-copy";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { cad } from "../helpers/money";
import { readLatestEmail } from "../helpers/read-latest-email";
import {
  adminRequestRow,
  adminRequestStatusText,
  openAdminTab,
} from "./helpers/admin";
import {
  BUYER_PHONE,
  buyerStatusUrl,
  type LicenseChoice,
  payButton,
  requestLicense,
} from "./helpers/buyer";
import { collectConsoleErrors } from "./helpers/console";
import { declineRequest, publishFromLibrary } from "./helpers/flows";
import {
  isServerAction,
  pressLocator,
  requestEnded,
  toast,
} from "./helpers/press";
import { ADMIN_STATE, CREATOR_STATE, setupCreatorTile } from "./helpers/run";
import { uniqueEmail } from "./helpers/sign-in";
import { cleanCreatedVideos } from "./helpers/videos";

// A declined request is never charged (P22; 01 §7 steps 25–27, J8.4; 07 D35; design/P22-demo-gate-a.md §3) on
// chromium-desktop and webkit-iphone. The setup creator (.auth/creator.json, in a context of its own) publishes a
// Library tile of its own per project (run.ts), so no two tests share a post; a logged-out buyer at 390 × 844 pays
// for Organic social repost · 30 days · One country (United States) at CA$165.00; the creator taps Decline once on the
// request's own page (never the Inbox: its lazy sweep would settle the other specs' requests of this shared creator).
// Then the admin's Requests row, moved to the tab's top in the test DB and found by its fake PaymentIntent id, reads
// Declined with reason creator; the buyer's /r reads Not approved with the released hold, and request-declined went to
// the buyer.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** 01 §7 step 25's choice: Organic social repost · 30 days · One country → United States. */
const ORGANIC_30_US = {
  use: "organic_social",
  term: "d30",
  territory: "country",
  country: "US",
} as const satisfies LicenseChoice;
/** At the CA$150 rate card: the base, and the CA$15.00 service fee. */
const TOTAL = cad(16_500);

test("25–27 · J8.4: the creator declines a paid request with one tap; the buyer's /r reads Not approved, request-declined goes out, and the admin row reads Declined by the creator", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const creatorContext = await browser.newContext({
    storageState: CREATOR_STATE,
  });
  const page = await creatorContext.newPage();
  const errors = collectConsoleErrors(page);
  const { url, handle } = await publishFromLibrary(
    page,
    setupCreatorTile(testInfo, "decline"),
  );

  // The buyer, logged out at 390 × 844: the choice, the checkout's total, Pay.
  const email = uniqueEmail(testInfo, "sam");
  const since = Date.now();
  const buyerContext = await browser.newContext({ viewport: BUYER_PHONE });
  const buyer = await buyerContext.newPage();
  const buyerErrors = collectConsoleErrors(buyer);
  const requestId = await requestLicense(buyer, url, {
    ...ORGANIC_30_US,
    email,
  });
  const main = buyer.locator("main");
  await expect(
    main.getByText("Organic social repost · 30 days · United States", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(main.locator("dl > div").last()).toHaveText(
    `${CHECKOUT_COPY.total}${TOTAL}`,
  );
  await expect(payButton(buyer)).toHaveText(CHECKOUT_COPY.pay(TOTAL));
  const paid = requestEnded(buyer, isServerAction);
  await pressLocator(payButton(buyer));
  await paid;
  const heading = buyer.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(REQUEST_STATUS_COPY.waitingTitle(handle));
  const statusUrl = buyerStatusUrl(buyer);
  // Off /r before its first 30 s refresh; it is opened again once the creator has answered.
  await buyer.goto("about:blank");

  // One tap on the request's page (01 J8.4): the line in the page and the toast.
  await declineRequest(page, requestId);
  await expect(toast(page, INBOX_COPY.declinedLine)).toBeVisible();

  // The admin's row by its PaymentIntent, moved to the tab's top first (the newest 50): Declined, reason creator.
  const adminContext = await browser.newContext({ storageState: ADMIN_STATE });
  const admin = await adminContext.newPage();
  const adminErrors = collectConsoleErrors(admin);
  await openAdminTab(admin, "requests", [requestId]);
  const row = adminRequestRow(admin, requestId);
  await expect(row).toHaveCount(1);
  await expect(
    row.getByText(adminRequestStatusText("declined"), { exact: true }),
  ).toBeVisible();
  await expect(row.getByText("creator", { exact: true })).toBeVisible();
  await adminContext.close();

  // The buyer's /r: Not approved, the hold released; the request-declined email to the buyer's address.
  await buyer.goto(statusUrl);
  await expect(heading).toHaveText(REQUEST_STATUS_COPY.declinedTitle);
  await expect(
    main.getByText(REQUEST_STATUS_COPY.declinedBody(handle), { exact: true }),
  ).toBeVisible();
  // Found by the buyer's address and the template (it throws when there is none), never by counting files.
  await readLatestEmail({ to: email, template: "request-declined", since });
  await buyerContext.close();
  await creatorContext.close();
  expect(buyerErrors).toEqual([]);
  expect(adminErrors).toEqual([]);
  expect(errors).toEqual([]);
});
