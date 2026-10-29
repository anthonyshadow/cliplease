import { expect, type Page, test } from "@playwright/test";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { collectConsoleErrors } from "./helpers/console";
import { buyLicense, publishDemoVideo } from "./helpers/flows";
import {
  atEveryWidth,
  boxOf,
  expectCreatorFrame,
  expectInsideColumn,
  expectReadingPage,
  expectSettingsColumn,
  TIERS,
} from "./helpers/layout";
import { cleanCreatedVideos } from "./helpers/videos";

// G.6 for the Inbox, the request page and /r (P17; 05 §1.6 S03, S14, S15; 04 §9.11; 07 D144–D146, D149, D154) on all four
// projects: a creator publishes Demo post 01 and one buyer pays (buyLicense). The Inbox fills the max-w-app column and its
// row stacks below 768 (the countdown under the Licensed-to name) and is wide from 768 (the countdown on the name's line at
// the row's right edge); the request page is one 640 px column left-aligned with its heading; /r, opened in a fresh
// logged-out context at the project's own viewport, is one centered 640 px column. Each page's clock is paused after it
// loads, so the 30 s refresh can't fire mid-sweep.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

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
  test.setTimeout(600_000);
  const { shareUrl, handle } = await publishDemoVideo(page);
  const { requestId, statusUrl, context } = await buyLicense(
    browser,
    shareUrl,
    { use: "paid_social", term: "y1", territory: "worldwide" },
  );
  await context.close();

  // The Inbox, one waiting request.
  const errors = collectConsoleErrors(page);
  await openPaused(page, "/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${INBOX_COPY.title} ${INBOX_COPY.waitingForYou(1)}`,
  );
  const row = page.locator("[data-inbox-row]");
  const name = row.locator("[data-licensee]");
  const chip = row.locator("time").locator("..");
  await expect(row.locator("time")).toHaveText(/^Expires in /);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    const [nameBox, chipBox, rowBox] = await Promise.all([
      boxOf(name),
      boxOf(chip),
      boxOf(row),
    ]);
    if (width < TIERS.tablet) {
      expect(chipBox.top).toBeGreaterThanOrEqual(nameBox.bottom - 1);
    } else {
      expect(chipBox.top).toBeLessThan(nameBox.bottom);
      expect(chipBox.bottom).toBeGreaterThan(nameBox.top);
      expect(Math.abs(chipBox.right - rowBox.right)).toBeLessThanOrEqual(1);
    }
  });

  // The request page.
  await openPaused(page, `/dashboard/requests/${requestId}`);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/ wants to license /);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectSettingsColumn(page, width);
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
  await buyerContext.close();
  expect(buyerErrors).toEqual([]);
});
