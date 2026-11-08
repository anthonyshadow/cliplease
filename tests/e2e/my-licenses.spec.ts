import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { REQUEST_EMAIL_COPY } from "../../src/emails/request-copy";
import { APP_NAME } from "../../src/lib/app-name";
import { LICENSE_RECORD_COPY } from "../../src/lib/licensing/license-record";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { maskEmail } from "../../src/lib/sign-in";
import {
  licensePath,
  myLicenseDownloadPath,
  myLicensePath,
  myLicensesPath,
} from "../../src/lib/urls";
import { readLatestEmail, readSignInCode } from "../helpers/read-latest-email";
import { collectConsoleErrors } from "./helpers/console";
import {
  approveInInbox,
  buyerKey,
  buyLicense,
  LICENSE_CODE,
  publishDemoVideo,
} from "./helpers/flows";
import { expectNoBareDollar, TIERS, viewportWidth } from "./helpers/layout";
import {
  downloadCount,
  fact,
  licenseRows,
  ORGANIC_30_WORLDWIDE,
} from "./helpers/licenses";
import { pressLocator } from "./helpers/press";
import { signInWithEmail } from "./helpers/sign-in";
import { cleanCreatedVideos } from "./helpers/videos";

// My licenses (P20b; 01 J13.5–J13.7, J1.2, G.5; 04 §9.30, §9.37; 05 §4.9, §4.10, WF-16; 07 D126; owner answers
// Q-192–Q-194) on chromium-desktop and webkit-iphone. A creator publishes Demo post 01; a logged-out buyer at 390 × 844
// pays for Organic social repost · 30 days · Worldwide as Buyer.<run>@Example.com and the creator approves. The buyer
// opens /l from license-approved (whose text links /licenses), taps Manage in My licenses, reads the buyer sign-in, signs
// in with the lowercase address and lands on the license: Valid, Standard, Paid CA$…, both files through the session
// routes (the PDF's headers read from the tap's own response: WebKit opens it in place). Back to My licenses: one row,
// the private headers from a document response, and the creator's Licenses reads Downloaded 2 times. The buyer NavBar
// (wordmark → /licenses, My licenses current, a Menu of My licenses and Sign out), signing out and back in at /sign-in
// lands on /licenses; a second buyer lands on /onboarding, sees the empty state and gets 404s for the first license;
// the creator lands on /dashboard and finds My licenses in the Menu (from lg) or the MoreSheet; the /r and /l links
// still open signed out.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const ORIGINAL_NAME = new RegExp(
  `^${APP_NAME}-${LICENSE_CODE.source}-original\\.mp4$`,
);
const BUYER = LICENSE_RECORD_COPY.buyer;
const MINE = LICENSE_RECORD_COPY.myLicenses;
const VALID = LICENSE_RECORD_COPY.status.valid;
const UUID = /[0-9a-f-]{36}/;

/** The block under the detail's h1: the status pill and «Exclusive» or "Standard" (the facts repeat the status). */
const detailHeader = (page: Page): Locator =>
  page.locator("main h1").locator("xpath=..");

/** The buyer NavBar's own link to My licenses (the detail's back link reads the same). */
const navLink = (page: Page): Locator =>
  page.getByRole("banner").getByRole("link", { name: MINE.title, exact: true });

/** Opens the account Menu and checks it holds exactly `items`, in order; leaves it open. */
async function expectAccountMenu(page: Page, items: string[]) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(items);
}

test("J13.5–J13.7: the buyer goes from /l to My licenses through the sign-in, downloads through the session, and only that email's session sees the license", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  const { shareUrl, email: creatorEmail } = await publishDemoVideo(page);
  const creatorErrors = collectConsoleErrors(page);

  // 1. The buyer pays as Buyer.<run>@Example.com; the creator approves.
  const run = randomUUID().slice(0, 8);
  const typed = `Buyer.${run}@Example.com`;
  const lower = typed.toLowerCase();
  const since = Date.now();
  const { requestId, statusUrl, context } = await buyLicense(
    browser,
    shareUrl,
    { ...ORGANIC_30_WORLDWIDE, email: typed },
  );
  const [buyer] = context.pages();
  if (!buyer) throw new Error("no buyer page");
  await buyer.goto("about:blank");
  const buyerErrors = collectConsoleErrors(buyer);
  const token = buyerKey(statusUrl);
  const code = await approveInInbox(page);

  // 2. license-approved links /l and My licenses (Q-194); Manage in My licenses goes through the buyer sign-in (Q-193).
  const approved = await readLatestEmail({
    to: lower,
    template: "license-approved",
    since,
  });
  // The email's own origin, read from its /l link: the e2e APP_URL is the env's, not baseURL's.
  const origin = /(https?:\/\/[^\s/[\]]+)\/l\/[A-Za-z0-9_-]{43}/.exec(
    approved.text,
  )?.[1];
  if (!origin) throw new Error("no /l link in license-approved");
  const seeAll = `${REQUEST_EMAIL_COPY.seeAllLicenses} ${origin}${myLicensesPath}`;
  const at = approved.text.indexOf(seeAll);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(approved.text.slice(at + seeAll.length)).toMatch(/^(\s|$)/);
  await buyer.goto(licensePath(token));
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
    `${BUYER.headline.lead} ${BUYER.headline.rest}`,
  );
  const manage = buyer
    .locator("main")
    .getByRole("link", { name: MINE.manage, exact: true });
  const manageHref = (await manage.getAttribute("href")) ?? "";
  const licenseId = UUID.exec(manageHref)?.[0];
  if (!licenseId) throw new Error(`no license id in ${manageHref}`);
  expect(manageHref).toBe(
    `/sign-in?next=${encodeURIComponent(myLicensePath(licenseId))}`,
  );
  await pressLocator(manage);
  await expect(buyer).toHaveURL(manageHref);
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
    MINE.signIn.heading,
  );
  await expect(
    buyer.getByText(MINE.signIn.line, { exact: true }),
  ).toBeVisible();

  // 3. The lowercase address signs in on that page and lands on the license.
  await buyer.getByLabel("Email", { exact: true }).fill(lower);
  const codeSince = Date.now();
  await buyer.getByRole("button", { name: "Email me a code" }).click();
  await expect(
    buyer.getByRole("heading", { name: "Check your email." }),
  ).toBeVisible();
  await buyer
    .getByLabel("Code", { exact: true })
    .fill(await readSignInCode(lower, codeSince));
  await buyer.waitForURL((url) => url.pathname === myLicensePath(licenseId));
  const main = buyer.locator("main");
  await expect(
    detailHeader(buyer).getByText(VALID, { exact: true }),
  ).toBeVisible();
  await expect(
    detailHeader(buyer).getByText(MINE.standard, { exact: true }),
  ).toBeVisible();
  await expect(main).toContainText(code);
  await expect(fact(main, BUYER.facts.paid)).toHaveText(/^CA\$\d/);
  await expectNoBareDollar(buyer);

  const original = main.locator(
    `a[href="${myLicenseDownloadPath(licenseId, "original")}"]`,
  );
  await expect(original).toHaveAccessibleName(/^Download original · MP4 · \d/);
  const download = buyer.waitForEvent("download");
  await pressLocator(original);
  expect((await download).suggestedFilename()).toMatch(ORIGINAL_NAME);

  const pdfPath = myLicenseDownloadPath(licenseId, "pdf");
  const pdf = main.locator(`a[href="${pdfPath}"]`);
  await expect(pdf).toHaveAccessibleName(BUYER.downloadPdf);
  const pdfAnswer = buyer.waitForResponse(
    (response) => new URL(response.url()).pathname === pdfPath,
  );
  await pressLocator(pdf);
  const answer = await pdfAnswer;
  expect(answer.status()).toBe(200);
  expect(answer.headers()["content-type"]).toBe("application/pdf");
  expect(answer.headers()["cache-control"]).toBe("no-store");
  expect(await downloadCount(requestId)).toBe(2);

  // 4. Back to My licenses (WebKit shows the PDF in place, so the license page first): its private headers, no storage
  // key in the served HTML (the client islands' props included); then one row and the list's headers.
  const detail = await buyer.goto(myLicensePath(licenseId));
  expect(detail?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(detail?.headers()["referrer-policy"]).toBe("no-referrer");
  const detailHtml = (await detail?.text()) ?? "";
  expect(detailHtml).toContain(code);
  expect(detailHtml).not.toContain("originals/");
  expect(detailHtml).not.toContain("/api/dev/storage/");
  await pressLocator(main.getByRole("link", { name: MINE.back, exact: true }));
  await expect(buyer).toHaveURL(myLicensesPath);
  const rows = main.getByRole("listitem");
  await expect(rows).toHaveCount(1);
  await expect(
    rows.getByRole("link", { name: new RegExp(`, ${code}, ${VALID}$`) }),
  ).toHaveAttribute("href", myLicensePath(licenseId));
  await expect(rows).toContainText(MINE.standard);
  await expect(rows).toContainText("(UTC)");
  await expect(buyer.locator('meta[name="referrer"]')).toHaveAttribute(
    "content",
    "no-referrer",
  );
  await expectNoBareDollar(buyer);
  const document = await buyer.goto(myLicensesPath);
  expect(document?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(document?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(await downloadCount(requestId)).toBe(2);

  await page.goto("/dashboard/licenses");
  const sold = licenseRows(page);
  await expect(sold).toHaveCount(1);
  await expect(sold).toContainText(code);
  await expect(
    sold.getByText("Downloaded 2 times", { exact: true }),
  ).toBeVisible();
  await page.goto("about:blank");

  // 5. The buyer NavBar, the same at every tier: no TabBar, one Menu, no other Sign out.
  const banner = buyer.getByRole("banner");
  await expect(
    banner.getByRole("link", { name: APP_NAME, exact: true }),
  ).toHaveAttribute("href", myLicensesPath);
  await expect(navLink(buyer)).toHaveAttribute("aria-current", "page");
  await expect(buyer.locator("[data-tabbar]")).toHaveCount(0);
  await expect(banner.getByText("Sign out")).toHaveCount(0);
  await expectAccountMenu(buyer, [MINE.title, "Sign out"]);
  await expect(
    buyer.getByRole("menuitem", { name: MINE.title }),
  ).toHaveAttribute("href", myLicensesPath);
  await buyer.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(buyer).toHaveURL("/sign-in");
  await buyer.goto(myLicensesPath);
  await expect(buyer).toHaveURL(
    `/sign-in?next=${encodeURIComponent(myLicensesPath)}`,
  );
  await signInWithEmail(buyer, lower, null);
  await expect(buyer).toHaveURL(myLicensesPath);
  await context.close();

  // 6. A second buyer, who bought nothing: /onboarding with the link, the empty state, 404 for the first license.
  const second = await browser.newContext({ baseURL });
  const other = await second.newPage();
  const otherErrors = collectConsoleErrors(other, [
    { status: 404, pathname: myLicensePath(licenseId) },
  ]);
  const otherEmail = `buyer+${run}-2@example.com`;
  await signInWithEmail(other, otherEmail, null);
  await expect(other).toHaveURL("/onboarding?step=profile");
  const onboardingLink = other.getByRole("link", {
    name: MINE.onboardingLink,
    exact: true,
  });
  await expect(onboardingLink).toHaveAttribute("href", myLicensesPath);
  await pressLocator(onboardingLink);
  await expect(other).toHaveURL(myLicensesPath);
  await expect(other.getByRole("heading", { level: 1 })).toHaveText(
    `${MINE.empty.lead} ${MINE.empty.rest}`,
  );
  await expect(other.locator("main")).toContainText(
    MINE.emptyBody(maskEmail(otherEmail)),
  );
  await expect(other.locator("main").getByRole("listitem")).toHaveCount(0);
  await expect(
    other
      .getByRole("banner")
      .getByRole("link", { name: APP_NAME, exact: true }),
  ).toHaveAttribute("href", myLicensesPath);
  const notMine = await other.goto(myLicensePath(licenseId));
  expect(notMine?.status()).toBe(404);
  await expect(
    other.getByRole("heading", { level: 1, name: "Page not found." }),
  ).toBeVisible();
  for (const kind of ["original", "pdf"] as const) {
    const route = await second.request.get(
      myLicenseDownloadPath(licenseId, kind),
      { maxRedirects: 0 },
    );
    expect(route.status()).toBe(404);
  }
  expect(await downloadCount(requestId)).toBe(2);
  await second.close();

  // 7. The creator still lands on /dashboard; My licenses is in the Menu from lg, in the MoreSheet below (WF-16).
  const creatorContext = await browser.newContext({ baseURL });
  const creator = await creatorContext.newPage();
  const signedInErrors = collectConsoleErrors(creator);
  await signInWithEmail(creator, creatorEmail, null);
  await expect(creator).toHaveURL("/dashboard");
  if (viewportWidth(creator) >= TIERS.desktop) {
    await expectAccountMenu(creator, [MINE.title, "Settings", "Sign out"]);
    await expect(
      creator.getByRole("menuitem", { name: MINE.title }),
    ).toHaveAttribute("href", myLicensesPath);
    await creator.keyboard.press("Escape");
  } else {
    await pressLocator(
      creator
        .locator("[data-tabbar]")
        .getByRole("button", { name: "More", exact: true }),
    );
    const sheet = creator.getByRole("dialog", { name: "More" });
    await expect(
      sheet.getByRole("link", { name: MINE.title, exact: true }),
    ).toHaveAttribute("href", myLicensesPath);
    await creator.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
  await creator.goto(myLicensesPath);
  await expect(
    creator
      .getByRole("banner")
      .getByRole("link", { name: APP_NAME, exact: true }),
  ).toHaveAttribute("href", "/dashboard");
  await expect(navLink(creator)).toHaveAttribute("aria-current", "page");
  await expect(creator.locator("[data-tabbar]")).toHaveCount(0);
  await creatorContext.close();

  // 8. Signed out, the buyer's private links still open (J13.7).
  const visitorContext = await browser.newContext({ baseURL });
  const visitor = await visitorContext.newPage();
  const visitorErrors = collectConsoleErrors(visitor);
  await visitor.goto(statusUrl);
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
    REQUEST_STATUS_COPY.approvedTitle,
  );
  const opened = await visitor.goto(licensePath(token));
  expect(opened?.status()).toBe(200);
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
    `${BUYER.headline.lead} ${BUYER.headline.rest}`,
  );
  await visitorContext.close();

  expect(buyerErrors).toEqual([]);
  expect(otherErrors).toEqual([]);
  expect(signedInErrors).toEqual([]);
  expect(visitorErrors).toEqual([]);
  expect(creatorErrors).toEqual([]);
});

test("G.5: signed out, /licenses and a license's page redirect to the sign-in with next; the session routes too", async ({
  request,
}) => {
  const id = "00000000-0000-4000-8000-000000000000";
  for (const path of [
    myLicensesPath,
    myLicensePath(id),
    myLicenseDownloadPath(id, "original"),
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const api = path.startsWith("/api/");
    expect(response.headers().location).toMatch(
      new RegExp(
        `/sign-in\\?next=${encodeURIComponent(api ? myLicensePath(id) : path)}$`,
      ),
    );
    // Next builds this redirect itself, so only next.config's /api/my row gives it the private headers.
    if (api) {
      expect(response.headers()["referrer-policy"]).toBe("no-referrer");
      expect(response.headers()["x-robots-tag"]).toBe("noindex");
      expect(response.headers()["cache-control"]).toContain("no-store");
    }
  }
});
