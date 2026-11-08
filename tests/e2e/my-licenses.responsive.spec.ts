import { expect, type Page, test } from "@playwright/test";
import { APP_NAME } from "../../src/lib/app-name";
import { LICENSE_RECORD_COPY } from "../../src/lib/licensing/license-record";
import { signInPath } from "../../src/lib/sign-in";
import {
  myLicenseDownloadPath,
  myLicensePath,
  myLicensesPath,
} from "../../src/lib/urls";
import { collectConsoleErrors, visit } from "./helpers/console";
import { licenseVideo, publishDemoVideo } from "./helpers/flows";
import {
  atEveryWidth,
  expectInsideColumn,
  expectReadingPage,
  expectTouchTarget,
  TIERS,
  viewportWidth,
  type WidthCheck,
} from "./helpers/layout";
import {
  forceLicenseExpired,
  forceLicenseRevoked,
  ORGANIC_30_WORLDWIDE,
} from "./helpers/licenses";
import { pressLocator } from "./helpers/press";
import { requestCode, signInWithEmail, uniqueEmail } from "./helpers/sign-in";
import { cleanCreatedVideos } from "./helpers/videos";

// G.6 for My licenses (P20b; 04 §9.30, §9.37; 05 §1.3, §1.6, §4.9, §4.10, WF-16; 07 D144–D147, D154) on all four
// projects. The buyer sign-in (`next` under /licenses, both steps) and a fresh address's empty /licenses; then one
// license a creator approved in the Inbox, its buyer signed in on a fresh context at the project's own viewport (never
// buyLicense's 390 × 844 one): /licenses and /licenses/[licenseId] valid, expired and revoked (forced in the test
// database, Q-188). Each is a reading page on `canvas` (no data-app): <main> keeps the tier's gutter, the page is one
// centered column of at most 640 px, and the buyer NavBar (wordmark, My licenses, the avatar trigger, each a 44 px target)
// is the same at every tier with no TabBar. The creator finds My licenses in the MoreSheet below lg (Tablet included)
// and in the avatar Menu from lg. No page-level sideways scroll at any width, no console error.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const MINE = LICENSE_RECORD_COPY.myLicenses;
const BUYER = LICENSE_RECORD_COPY.buyer;
const STATUS = LICENSE_RECORD_COPY.status;

// --canvas (globals.css): buyer pages are not the app's canvas-alt pages (04 §3; 05 §1.3).
const CANVAS = { light: "rgb(255, 255, 255)", dark: "rgb(0, 0, 0)" } as const;

/** A buyer page at `width`: the reading frame on canvas, the 640 px column, the buyer NavBar's three 44 px targets. */
async function expectBuyerPage(page: Page, { width, theme }: WidthCheck) {
  await expectReadingPage(page, width);
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    CANVAS[theme],
  );
  const banner = page.getByRole("banner");
  for (const control of [
    banner.getByRole("link", { name: APP_NAME, exact: true }),
    banner.getByRole("link", { name: MINE.title, exact: true }),
    banner.getByRole("button", { name: "Account menu" }),
  ]) {
    await expect(control).toBeVisible();
    await expectTouchTarget(control);
  }
}

test("G.6: the buyer sign-in (both steps) and an empty /licenses fit every tier", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const errors = await visit(page, signInPath(myLicensesPath));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    MINE.signIn.heading,
  );
  const line = page.getByText(MINE.signIn.line, { exact: true });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectReadingPage(page, width);
    await expectInsideColumn(line);
  });

  // Step 2 reads the same for every address.
  const email = uniqueEmail(testInfo);
  const code = await requestCode(page, email, myLicensesPath);
  await atEveryWidth(page, testInfo, ({ width }) =>
    expectReadingPage(page, width),
  );
  await page.getByLabel("Code", { exact: true }).fill(code);
  await page.waitForURL((url) => url.pathname === myLicensesPath);

  // A fresh address bought nothing: the empty state stands for the page.
  const empty = page.getByRole("heading", { level: 1 });
  await expect(empty).toHaveText(`${MINE.empty.lead} ${MINE.empty.rest}`);
  await atEveryWidth(page, testInfo, async (at) => {
    await expectBuyerPage(page, at);
    await expectInsideColumn(empty);
  });
  expect(errors).toEqual([]);
});

test("G.6: My licenses and a license's page (valid, expired, revoked) are one centered 640 px column under the buyer NavBar at every tier; the creator's MoreSheet or Menu lists My licenses", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(600_000);
  const { shareUrl } = await publishDemoVideo(page);
  const { requestId, code, email } = await licenseVideo(
    page,
    browser,
    shareUrl,
    ORGANIC_30_WORLDWIDE,
  );

  // The creator's way to My licenses (WF-16): the MoreSheet below lg, Tablet included; the avatar Menu from lg.
  const creatorErrors = collectConsoleErrors(page);
  await page.goto("/dashboard");
  if (viewportWidth(page) >= TIERS.desktop) {
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(
      page.getByRole("menuitem", { name: MINE.title }),
    ).toHaveAttribute("href", myLicensesPath);
  } else {
    await pressLocator(
      page
        .locator("[data-tabbar]")
        .getByRole("button", { name: "More", exact: true }),
    );
    const myLicenses = page
      .getByRole("dialog", { name: "More" })
      .getByRole("link", { name: MINE.title, exact: true });
    await expect(myLicenses).toHaveAttribute("href", myLicensesPath);
    await expectTouchTarget(myLicenses);
  }
  await page.keyboard.press("Escape");
  await page.goto("about:blank");
  expect(creatorErrors).toEqual([]);

  // The buyer, signed in on a fresh context at the project's own viewport.
  const context = await browser.newContext({ baseURL });
  const buyer = await context.newPage();
  const errors = collectConsoleErrors(buyer);
  await signInWithEmail(buyer, email, myLicensesPath);
  await expect(buyer).toHaveURL(myLicensesPath);
  const main = buyer.locator("main");
  const row = main.getByRole("listitem");
  await expect(row).toHaveCount(1);
  const link = row.getByRole("link");
  await expect(link).toHaveAccessibleName(new RegExp(`, ${code}, `));
  const href = (await link.getAttribute("href")) ?? "";
  const licenseId = /^\/licenses\/([0-9a-f-]{36})$/.exec(href)?.[1];
  if (!licenseId) throw new Error(`unexpected row link: ${href}`);
  await atEveryWidth(buyer, testInfo, async (at) => {
    await expectBuyerPage(buyer, at);
    await expectInsideColumn(row);
    await expectTouchTarget(link);
  });

  // Valid: the back link, the facts card, both downloads and the verify link's Copy, inside the column.
  const back = main.getByRole("link", { name: MINE.back, exact: true });
  const facts = main.locator("dl").first();
  const original = main.locator(
    `a[href="${myLicenseDownloadPath(licenseId, "original")}"]`,
  );
  const pdf = main.locator(
    `a[href="${myLicenseDownloadPath(licenseId, "pdf")}"]`,
  );
  const copy = main.getByRole("button", { name: "Copy", exact: true });
  const header = main.locator("h1").locator("xpath=..");
  await buyer.goto(myLicensePath(licenseId));
  await expect(header.getByText(STATUS.valid, { exact: true })).toBeVisible();
  await atEveryWidth(buyer, testInfo, async (at) => {
    await expectBuyerPage(buyer, at);
    await expectInsideColumn(facts);
    for (const control of [back, original, pdf, copy]) {
      await expect(control).toBeVisible();
      await expectInsideColumn(control);
      await expectTouchTarget(control);
    }
  });

  // Expired: only the license PDF stays (07 D16).
  await forceLicenseExpired(requestId);
  await buyer.goto(myLicensePath(licenseId));
  await expect(header.getByText(STATUS.expired, { exact: true })).toBeVisible();
  await expect(original).toHaveCount(0);
  await atEveryWidth(buyer, testInfo, async (at) => {
    await expectBuyerPage(buyer, at);
    await expectInsideColumn(facts);
    await expect(pdf).toBeVisible();
    await expectInsideColumn(pdf);
    await expectTouchTarget(pdf);
  });

  // Revoked: why there are no files, instead of both (05 §4.4 callout 12).
  await forceLicenseRevoked(requestId);
  await buyer.goto(myLicensePath(licenseId));
  await expect(header.getByText(STATUS.revoked, { exact: true })).toBeVisible();
  const revoked = main.getByText(BUYER.revoked, { exact: true });
  await expect(main.locator('a[href^="/api/my/"]')).toHaveCount(0);
  await atEveryWidth(buyer, testInfo, async (at) => {
    await expectBuyerPage(buyer, at);
    await expectInsideColumn(facts);
    await expect(revoked).toBeVisible();
    await expectInsideColumn(revoked);
  });

  // The list reads the same state.
  await buyer.goto(myLicensesPath);
  await expect(
    row.getByRole("link", {
      name: new RegExp(`, ${code}, ${STATUS.revoked}$`),
    }),
  ).toBeVisible();
  await context.close();
  expect(errors).toEqual([]);
});
