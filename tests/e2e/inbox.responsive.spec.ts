import { expect, type Locator, type Page, test } from "@playwright/test";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { readLatestEmail } from "../helpers/read-latest-email";
import { collectConsoleErrors } from "./helpers/console";
import { buyLicense, publishDemoVideo } from "./helpers/flows";
import {
  atEveryWidth,
  boxOf,
  expectCreatorFrame,
  expectInside,
  expectInsideColumn,
  expectReadingPage,
  expectSettingsColumn,
  TIERS,
} from "./helpers/layout";
import { pressLocator } from "./helpers/press";
import { cleanCreatedVideos } from "./helpers/videos";

// G.6 for the Inbox, the request page and /r (P17, P18; 05 §1.6 S03, S14, S15; 04 §9.11, §10.2; 07 D144–D146, D149,
// D154) on all four projects: a creator publishes Demo post 01 and two buyers pay (buyLicense); the creator approves the
// second on its request page (the toast above the TabBar below 1024, and the buyer's license-approved email). The Inbox
// fills the max-w-app column and its row stacks below 768 (the countdown under the Licensed-to name, Approve in the
// row's right half) and is wide from 768 (the countdown on the name's line at the row's right edge, Approve the
// rightmost control); History keeps the approved row's pill and code inside it; the request page is one 640 px column
// left-aligned with its heading; /r, opened in a fresh logged-out context at the project's own viewport, is one
// centered 640 px column, the approved one with its 40 px seal. Each page's clock is paused after it loads, so the 30 s
// refresh can't fire mid-sweep.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const LICENSE_CODE = /CL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/;
const APPROVED_TOAST = INBOX_COPY.approvedToast("CA$1,575.00");

/** The rightmost edge of the controls `row` shows at this width (the other tier's copy is hidden). */
const rightmostControl = (row: Locator) =>
  row.evaluate((el) =>
    Math.max(
      ...[...el.querySelectorAll("button, a")]
        .filter((c) => c.getClientRects().length > 0)
        .map((c) => c.getBoundingClientRect().right),
    ),
  );

/** Opens `path` on a paused clock: time stands still from load, so no 30 s refresh fires during the sweep. */
async function openPaused(page: Page, path: string) {
  await page.clock.install();
  await page.goto(path);
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
}

test("G.6, 07 D146: the Inbox row stacks below 768 and is wide from 768; the request page and /r keep their columns, at every tier", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(900_000);
  const { shareUrl, handle } = await publishDemoVideo(page);
  const choice = {
    use: "paid_social",
    term: "y1",
    territory: "worldwide",
  } as const;
  const { requestId, statusUrl, context } = await buyLicense(
    browser,
    shareUrl,
    choice,
  );
  await context.close();
  const approved = await buyLicense(browser, shareUrl, choice);
  await approved.context.close();

  // Approve the second on its request page, before any clock is paused: the toast, the line, the email.
  const errors = collectConsoleErrors(page);
  const since = Date.now();
  await page.goto(`/dashboard/requests/${approved.requestId}`);
  await pressLocator(page.getByRole("button", { name: INBOX_COPY.approve }));
  const toast = page.locator("li", { hasText: APPROVED_TOAST });
  await expect(toast).toBeVisible();
  await expect(toast.locator("svg")).toHaveAttribute("width", "16");
  const tabBar = page.locator("[data-tabbar]");
  if (await tabBar.isVisible()) {
    const [toastBox, barBox] = await Promise.all([boxOf(toast), boxOf(tabBar)]);
    expect(toastBox.bottom).toBeLessThanOrEqual(barBox.top + 1);
  }
  await expect(page.getByText(/^License CL-.* issued$/)).toHaveText(
    new RegExp(`^License ${LICENSE_CODE.source} issued$`),
  );
  await expect(
    page.getByRole("button", { name: INBOX_COPY.approve }),
  ).toHaveCount(0);
  const email = await readLatestEmail({
    to: approved.email,
    template: "license-approved",
    since,
  });
  expect(email.subject).toMatch(
    new RegExp(`^Approved: your license ${LICENSE_CODE.source} is ready$`),
  );
  expect(email.text).toMatch(/\/l\/[A-Za-z0-9_-]{43}/);
  expect(email.text).toMatch(new RegExp(`/verify/${LICENSE_CODE.source}`));
  expect(email.text).toContain("Amounts in Canadian dollars (CAD).");
  expect(email.text).toContain("CA$1,732.50");
  expect(email.text).not.toMatch(/(^|[^A-Z])\$\d/);

  // The Inbox, one waiting request.
  await openPaused(page, "/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${INBOX_COPY.title} ${INBOX_COPY.waitingForYou(1)}`,
  );
  const row = page.locator("[data-inbox-row]");
  const name = row.locator("[data-licensee]");
  const chip = row.locator("time").locator("..");
  const approve = row.getByRole("button", { name: INBOX_COPY.approve });
  await expect(row.locator("time")).toHaveText(/^Expires in /);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    const [nameBox, chipBox, rowBox, approveBox] = await Promise.all([
      boxOf(name),
      boxOf(chip),
      boxOf(row),
      boxOf(approve),
    ]);
    if (width < TIERS.tablet) {
      expect(chipBox.top).toBeGreaterThanOrEqual(nameBox.bottom - 1);
      // Approve in the row's right half (P19's Decline takes the left).
      expect(approveBox.left).toBeGreaterThanOrEqual(
        (rowBox.left + rowBox.right) / 2 - 1,
      );
    } else {
      expect(chipBox.top).toBeLessThan(nameBox.bottom);
      expect(chipBox.bottom).toBeGreaterThan(nameBox.top);
      expect(Math.abs(chipBox.right - rowBox.right)).toBeLessThanOrEqual(1);
      expect(approveBox.right).toBeGreaterThanOrEqual(
        (await rightmostControl(row)) - 1,
      );
    }
    expect(approveBox.right).toBeLessThanOrEqual(rowBox.right + 1);
  });

  // History: the approved row keeps its pill and code inside it.
  await openPaused(page, "/dashboard?view=history");
  const done = page.locator("[data-inbox-row]");
  await expect(done).toHaveCount(1);
  const pill = done.getByText("Approved", { exact: true });
  const code = done.getByText(LICENSE_CODE);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectInside(pill, done);
    await expectInside(code, done);
  });

  // The request page.
  await openPaused(page, `/dashboard/requests/${requestId}`);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/ wants to license /);
  const detailApprove = page.getByRole("button", { name: INBOX_COPY.approve });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectSettingsColumn(page, width);
    // The lg button at its own width, in the left-aligned column (07 D149).
    await expectInsideColumn(detailApprove);
  });
  expect(errors).toEqual([]);

  // /r, logged out, at the project's own viewport.
  const buyerContext = await browser.newContext({ baseURL });
  const buyer = await buyerContext.newPage();
  const buyerErrors = collectConsoleErrors(buyer);
  await openPaused(buyer, statusUrl);
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
    REQUEST_STATUS_COPY.waitingTitle(handle),
  );
  const summary = buyer.locator("main section");
  await atEveryWidth(buyer, testInfo, async ({ width }) => {
    await expectReadingPage(buyer, width);
    await expectInsideColumn(summary);
  });

  // The approved request's /r: its ending and the 40 px seal, in the same column.
  await openPaused(buyer, approved.statusUrl);
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
    REQUEST_STATUS_COPY.approvedTitle,
  );
  const seal = buyer.locator("main svg[aria-hidden='true'][width='40']");
  await expect(seal).toHaveCount(1);
  await atEveryWidth(buyer, testInfo, async ({ width }) => {
    await expectReadingPage(buyer, width);
    await expectInsideColumn(summary);
    await expectInsideColumn(seal);
  });
  await buyerContext.close();
  expect(buyerErrors).toEqual([]);

  // Approve from the Inbox row (01 J8.2; 02 §4.4 rule 2): the row stays in Waiting with its outcome while the counts drop
  // at once, the focus on its status; the next focus refresh moves it to History.
  await page.clock.resume();
  await page.goto("/dashboard");
  await pressLocator(approve);
  await expect(page.locator("li", { hasText: APPROVED_TOAST })).toBeVisible();
  await expect(row.getByText(/^License CL-.* issued$/)).toBeVisible();
  await expect(row.getByText("Approved", { exact: true })).toBeVisible();
  await expect(row.locator("[data-row-status]")).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${INBOX_COPY.title} ${INBOX_COPY.caughtUp}`,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("[data-inbox-row]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
