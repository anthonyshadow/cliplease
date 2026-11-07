import { expect, test } from "@playwright/test";
import { LICENSE_RECORD_COPY } from "../../src/lib/licensing/license-record";
import {
  licenseDownloadPath,
  licensePath,
  verifyPath,
} from "../../src/lib/urls";
import { collectConsoleErrors } from "./helpers/console";
import { licenseVideo, publishDemoVideo } from "./helpers/flows";
import {
  atEveryWidth,
  expectCreatorFrame,
  expectInside,
  expectInsideColumn,
  expectReadingPage,
  expectTouchTarget,
  expectWithinCap,
  TIERS,
} from "./helpers/layout";
import { ORGANIC_30_WORLDWIDE } from "./helpers/licenses";
import { cleanCreatedVideos } from "./helpers/videos";

// G.6 for a license's three pages (P20; 05 §1.6 S04, S05, S22; 04 §9.31, §10.2; 07 D144–D146, D154) on all four
// projects, from one license a creator approved in the Inbox (publishDemoVideo, then a logged-out buyer pays and the
// creator taps Approve): /dashboard/licenses in the creator frame, its list stacked rows below 1024 and a visible
// <table> from 1024 (DataTable renders both, the other one display: none), View public record a 44 px target; then,
// logged out in a fresh context at each project's own viewport (never buyLicense's 390 × 844 one), /l and /verify each
// one centered column of at most 640 px with the card, the downloads and the facts inside it. No page-level sideways
// scroll at any width, no console error.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const COPY = LICENSE_RECORD_COPY;

test("G.6: /dashboard/licenses stacks its rows below 1024 and shows a table from 1024; /l and /verify are one centered 640 px column at every tier", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(600_000);
  const { shareUrl } = await publishDemoVideo(page);
  const { token, code } = await licenseVideo(
    page,
    browser,
    shareUrl,
    ORGANIC_30_WORLDWIDE,
  );

  // The creator's Licenses: one form of the list per tier.
  const errors = collectConsoleErrors(page);
  await page.goto("/dashboard/licenses");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${COPY.dashboard.heading.lead} ${COPY.dashboard.heading.rest}`,
  );
  const main = page.locator("main");
  const stacked = main.locator("[data-table-stacked]");
  const wide = main.locator("[data-table-wide]");
  const publicRecord = main.getByRole("link", {
    name: COPY.dashboard.viewPublicRecord,
  });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    if (width < TIERS.desktop) {
      await expect(stacked).toBeVisible();
      await expect(wide).toBeHidden();
      await expect(stacked.locator(":scope > li")).toHaveCount(1);
      await expect(stacked.getByText(code, { exact: true })).toBeVisible();
      await expectInside(stacked, main);
    } else {
      await expect(stacked).toBeHidden();
      await expect(wide.locator("table")).toBeVisible();
      await expect(wide.locator("tbody > tr")).toHaveCount(1);
      await expect(wide.getByText(code, { exact: true })).toBeVisible();
      await expectInside(wide, main);
    }
    await expect(publicRecord).toHaveCount(1);
    await expect(publicRecord).toHaveAttribute("href", verifyPath(code));
    await expectTouchTarget(publicRecord);
  });
  expect(errors).toEqual([]);

  // Logged out, at the project's own viewport.
  const context = await browser.newContext({ baseURL });
  const visitor = await context.newPage();
  const visitorErrors = collectConsoleErrors(visitor);
  const column = visitor.locator("main .max-w-reading").first();

  // /l (S04): the card, both downloads and the verify link inside the one column.
  await visitor.goto(licensePath(token));
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
    `${COPY.buyer.headline.lead} ${COPY.buyer.headline.rest}`,
  );
  const card = column.locator("section").first();
  const downloads = [
    column.locator(`a[href="${licenseDownloadPath(token, "original")}"]`),
    column.locator(`a[href="${licenseDownloadPath(token, "pdf")}"]`),
  ];
  const copyCode = column.getByRole("button", {
    name: `Copy ${COPY.buyer.copyNames.code}`,
  });
  await atEveryWidth(visitor, testInfo, async ({ width }) => {
    await expectReadingPage(visitor, width);
    await expectWithinCap(column, 640);
    await expectInsideColumn(card);
    for (const download of downloads) {
      await expect(download).toBeVisible();
      await expectInsideColumn(download);
      await expectTouchTarget(download);
    }
    await expectTouchTarget(copyCode);
  });

  // /verify (S05): the status row, the facts and the footer inside the one column.
  await visitor.goto(verifyPath(code));
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
    COPY.verify.heading.valid,
  );
  const facts = column.locator("dl").first();
  const footer = column.locator("footer");
  await atEveryWidth(visitor, testInfo, async ({ width }) => {
    await expectReadingPage(visitor, width);
    await expectWithinCap(column, 640);
    await expectInsideColumn(facts);
    await expectInsideColumn(footer);
    await expect(column.getByText(code, { exact: true })).toBeVisible();
  });
  await context.close();
  expect(visitorErrors).toEqual([]);
});
