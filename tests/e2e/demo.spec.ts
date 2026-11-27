import { stat } from "node:fs/promises";
import {
  type Browser,
  type BrowserContextOptions,
  expect,
  test,
} from "@playwright/test";
import {
  ADMIN_COPY,
  DISABLE_COPY,
  MONEY_COPY,
  REVOKE_COPY,
} from "../../src/lib/admin/copy";
import { transferLabel } from "../../src/lib/admin/labels";
import { ADMIN_TAB_LABELS } from "../../src/lib/admin/tabs";
import { APP_NAME } from "../../src/lib/app-name";
import { formatLicenseDate, formatMoney } from "../../src/lib/format";
import { CHECKOUT_COPY } from "../../src/lib/licensing/checkout-copy";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import { LICENSE_PAGE_COPY } from "../../src/lib/licensing/license-page";
import { LICENSE_RECORD_COPY } from "../../src/lib/licensing/license-record";
import { PAYOUT_LINE_COPY } from "../../src/lib/licensing/payout-line";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { POSTINGS_COPY, sourceRowTitle } from "../../src/lib/postings/copy";
import {
  licenseDownloadPath,
  licensePath,
  verifyPath,
  videoUrl,
} from "../../src/lib/urls";
import { BADGE_COPY } from "../../src/lib/videos/ownership";
import { VIDEO_DISABLED_REASON_LABELS } from "../../src/lib/videos/review";
import { sourcePageHref, videoStepHref } from "../../src/lib/videos/steps";
import { VIDEO_PRICE_COPY } from "../../src/lib/videos/video-price";
import { cad } from "../helpers/money";
import { pageBody, pdfPages, squash } from "../helpers/pdf-text";
import { readLatestEmail, readSignInCode } from "../helpers/read-latest-email";
import { adminRows, openAdminTab } from "./helpers/admin";
import {
  BUYER_PHONE,
  buyerStatusUrl,
  chooseDemoSelection,
  E2E_LICENSEE,
  FAKE_CHECKOUT_URL,
  fillDetails,
  hydrated,
  optionTile,
  payButton,
  requestButton,
} from "./helpers/buyer";
import {
  accountCard,
  DEMO,
  DEMO_ACCOUNT,
  linkDemoAccount,
  SYNC_LINE,
} from "./helpers/connections";
import { collectConsoleErrors } from "./helpers/console";
import {
  completeProfileStep,
  setUpPayouts,
  uniqueHandle,
} from "./helpers/creator";
import {
  DEMO_TIMEOUT_MS,
  DemoRecording,
  type DemoRole,
} from "./helpers/demo-video";
import { buyerKey, issuedCode, publish, publishedView } from "./helpers/flows";
import { expectLeftOf, expectNoBareDollar } from "./helpers/layout";
import {
  findLeaks,
  MOCK_TOKEN,
  type WatchedBodies,
  watchBodies,
} from "./helpers/leaks";
import {
  OWN_DEMO_LINK,
  POST_01,
  searchParam,
  tileCaption,
  tileLink,
  tilePostId,
  tiles,
  waitForLibrary,
} from "./helpers/library";
import {
  expectMovementSucceeded,
  fact,
  LICENSE_DATE,
  licenseRows,
  storedLicense,
  storedMovement,
} from "./helpers/licenses";
import { trackExternalRequests } from "./helpers/network";
import {
  isServerAction,
  pressAndSettle,
  pressAndSettleIn,
  pressLink,
  pressLocator,
  requestEnded,
  toast,
} from "./helpers/press";
import { pickCombination, previewLine, quoteLine } from "./helpers/pricing";
import { ADMIN_STATE, MAYA_FILMS } from "./helpers/run";
import { uniqueEmail } from "./helpers/sign-in";
import { basePriceRadio } from "./helpers/video-price";
import {
  answerRights,
  attachSample,
  cleanCreatedVideos,
  continueButton,
  continueToPostings,
  continueToReview,
  continueToRights,
  makeLicensable,
  SAMPLE_MP4,
  sameVideoBlock,
  sameVideoTick,
  showLinkSwitch,
  sourceRow,
  stepColumn,
} from "./helpers/videos";

// S1, the 5-minute demo (P22; 01 §7 steps 1–23 and 28–29, step 24 is Gate B's; 01 §6 S5, S7; 07 D20, D54, D69, D74,
// D86, D98; design/P22-demo-gate-a.md §2–§3; owner answers Q-212–Q-214) on chromium-desktop and webkit-iphone, against
// the production build on the mock, fake, local and console drivers. One test; each test.step carries its 01 §7 number
// and job id. Three windows, made in one place (demoContexts), never a file-level storageState: the creator signs up
// from nothing at the project's own device, the buyer is logged out with no cookies at 390 × 844, and the admin is the
// setup project's session for steps 28–29. The run-unique creator is this spec's own, so its Inbox is safe to open.
// Expected results as the app renders them (design §2): Set up payouts returns to Settings and the creator taps Library
// next (Q-214); the Source page's provenance has no "· Verified" (the File step's has); the locked source row is three
// parts; Where posted keeps Continue and refuses it without the tick; the publish view's button is Copy → Copied with
// "Link copied" in its live region; Paid out once the transfer is stored, exactly one creator_transfer of the license
// price; the disabled video's license page is the 404 with its message; Revoke only after the transfer was sent. The
// File step reads a frame on Chromium (0:14 · 720 × 1280) and takes "Choose an image" with poster.jpg on WebKit (Q4,
// recorded as an annotation). On every page the visible text carries no bare $ (07 D98). The creator's and the buyer's
// pages are opened through their body watches, which read every page, JSON and RSC body for S5 (no mock token) and S7
// (no storage key or signed URL in the buyer's), none left unread (helpers/leaks.ts: on Chromium a fetch Next's router
// cancels is read up to where it stopped and counted apart). Controls are pressed with the keyboard where a click near the bottom could land on the iPhone's fixed bars. With DEMO_VIDEO=1 on
// chromium-desktop (`bun run demo:video`; owner answer Q-215) the run is slowed and the three windows are recorded
// (helpers/demo-video.ts); otherwise nothing of that runs.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** 01 §7's demo video: post 01's title (its caption without the hashtags) and slug. */
const TITLE = "He saw snow for the first time and lost it";
const SLUG = "he-saw-snow-for-the-first-time-and-lost-it";
const DISPLAY_NAME = "Maya R.";
const SCOPE = "Paid social ads · 1 year · Worldwide";
const BADGE = "Verified · @demo.creator (demo account)";
/** 07 D79's golden at the CA$150 rate card: Paid social ads · 1 year · Worldwide. */
const PRICE_CENTS = 157_500;
const PRICE = cad(PRICE_CENTS);
const FEE = cad(15_750);
const TOTAL = cad(173_250);
const CAD_FACT =
  "You'll get paid in Canadian dollars (CAD) to a Canadian bank account.";
const FILE_NOTICE =
  "Demo doesn't share original files with apps. Upload the original from your phone or camera, the version without the Demo watermark.";
const MISSING_TICK = "Confirm these posts show this same video";
const ANY_WARNING = /Make sure it's the same video\.$/;
/** 72 h after the authorization, rounded down (formatCountdown). */
const COUNTDOWN = /^Expires in 2 d 23 h$/;
/** S7: a storage key's prefix, a signed URL's signature, the local driver's signed route. */
const STORAGE_LEAKS = ["originals/", "X-Amz-Signature", "/api/dev/storage/"];

/**
 * 01 §7's three windows, created in one place: the creator, signed out, at the project's own device, with the
 * clipboard granted on Chromium (WebKit has no such permission); the buyer, logged out with no cookies, at 390 × 844;
 * the admin, the setup project's session (.auth/admin.json). While the demo video records, each also records its
 * pages at its own viewport size; otherwise the options are exactly these.
 */
async function demoContexts(
  browser: Browser,
  browserName: string,
  recording: DemoRecording | null,
) {
  const open = (role: DemoRole, options: BrowserContextOptions) =>
    recording
      ? recording.newContext(browser, role, options)
      : browser.newContext(options);
  const [creator, buyer, admin] = await Promise.all([
    open(
      "creator",
      browserName === "chromium"
        ? { permissions: ["clipboard-read", "clipboard-write"] }
        : {},
    ),
    open("buyer", { viewport: BUYER_PHONE }),
    open("admin", { storageState: ADMIN_STATE }),
  ]);
  return { creator, buyer, admin };
}

test("S1: the 5-minute demo, 01 §7 steps 1–23 and 28–29, with the S5 and S7 body checks", async ({
  browser,
  browserName,
  baseURL,
  request,
}, testInfo) => {
  const recording = DemoRecording.start(testInfo);
  test.setTimeout(recording ? DEMO_TIMEOUT_MS : 900_000);
  if (!baseURL) throw new Error("the demo needs the config's baseURL");
  const contexts = await demoContexts(browser, browserName, recording);
  const creatorBodies = watchBodies(contexts.creator);
  const buyerBodies = watchBodies(contexts.buyer);
  const creator = await creatorBodies.newPage();
  const creatorErrors = collectConsoleErrors(creator);
  const buyer = await buyerBodies.newPage();
  const buyerErrors = collectConsoleErrors(buyer);
  // J7.20: what the buyer's page asks of any other host, from its first request.
  const buyerExternal = trackExternalRequests(buyer);
  const admin = await contexts.admin.newPage();
  const adminErrors = collectConsoleErrors(admin);
  const creatorMain = creator.locator("main");
  const buyerMain = buyer.locator("main");
  const email = uniqueEmail(testInfo, "maya");
  const handle = uniqueHandle(testInfo, "maya");
  const samEmail = uniqueEmail(testInfo, "sam");

  await test.step("01 · J1 Open / and tap Sign in", async () => {
    await creator.goto("/");
    await expectNoBareDollar(creator, "body");
    await pressLocator(
      creator.getByRole("banner").getByRole("link", { name: "Sign in" }),
    );
    await creator.waitForURL("/sign-in");
    await expect(
      creator.getByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeVisible();
    // One email field.
    await expect(creatorMain.getByRole("textbox")).toHaveCount(1);
    await expect(creator.getByLabel("Email", { exact: true })).toBeVisible();
    await expectNoBareDollar(creator, "body");
  });

  const code =
    await test.step("02 · J1 Email me a code: Check your email. and a 6-digit code", async () => {
      await creator.getByLabel("Email", { exact: true }).fill(email);
      const since = Date.now();
      await creator.getByRole("button", { name: "Email me a code" }).click();
      await expect(
        creator.getByRole("heading", { name: "Check your email." }),
      ).toBeVisible();
      await expectNoBareDollar(creator, "body");
      const sent = await readSignInCode(email, since);
      expect(sent).toMatch(/^\d{6}$/);
      return sent;
    });

  await test.step("03 · J1 The code signs in and opens onboarding", async () => {
    await creator.getByLabel("Code", { exact: true }).fill(code);
    await creator.waitForURL((url) => url.pathname !== "/sign-in");
    await expect(creator).toHaveURL("/onboarding?step=profile");
  });

  await test.step("04 · J1 Handle, Maya R. and I'm 18 or older: @handle is yours, then the connect step", async () => {
    // No date of birth (J1.7, 07 D93): the required tick only.
    await expect(creator.getByLabel(/birth/i)).toHaveCount(0);
    await expect(
      creator.getByLabel("I'm 18 or older", { exact: true }),
    ).toHaveAttribute("required");
    await expectNoBareDollar(creator, "body");
    // Fills "Maya R.", the handle (waiting for "@{handle} is yours"), ticks 18+ and continues.
    await completeProfileStep(creator, handle);
    await expect(creator).toHaveURL("/onboarding?step=connect");
    await expect(
      creator.getByRole("heading", { level: 1, name: "Connect your accounts" }),
    ).toBeVisible();
  });

  await test.step("05 · J1 /@handle in a new tab: Maya R., @handle and No videos yet.", async () => {
    const tab = await creatorBodies.newPage();
    const tabErrors = collectConsoleErrors(tab);
    const response = await tab.goto(`/@${handle}`);
    expect(response?.status()).toBe(200);
    // The h1 is the name; the handle is its own line (design §2).
    await expect(
      tab.getByRole("heading", { level: 1, name: DISPLAY_NAME }),
    ).toBeVisible();
    await expect(tab.getByText(`@${handle}`, { exact: true })).toBeVisible();
    await expect(tab.getByText("No videos yet.")).toBeVisible();
    await expectNoBareDollar(tab, "body");
    await tab.close();
    expect(tabErrors).toEqual([]);
  });

  await test.step("06 · J2 Connect Demo: back on the connect step with the connected card", async () => {
    // Waits for the return with ?connected= and the "Demo connected. …" toast.
    await linkDemoAccount(creator, "/onboarding?step=connect");
    await expect(creator).toHaveURL("/onboarding?step=connect");
    const card = accountCard(creator, DEMO_ACCOUNT);
    await expect(card.getByText("Connected", { exact: true })).toBeVisible();
    await expect(card.getByText(SYNC_LINE)).toBeVisible();
    const avatar = card.getByRole("img", { name: "Demo Creator" });
    await expect
      .poll(() => avatar.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expectNoBareDollar(creator, "body");
  });

  await test.step("06b · J11 Set up payouts (fake): Payouts on in Settings, then Library from the menu", async () => {
    await creator.getByRole("link", { name: "Continue" }).click();
    await creator.waitForURL("/onboarding?step=payouts");
    await expect(creator.getByText(CAD_FACT, { exact: true })).toBeVisible();
    // No country or currency choice (07 D94, D99).
    await expect(creator.getByRole("combobox")).toHaveCount(0);
    await expect(creator.getByLabel(/country|currency/i)).toHaveCount(0);
    // The fake driver's instant setup returns to Settings with "Payouts on" (owner answer Q-214).
    await setUpPayouts(creator);
    await expectNoBareDollar(creator, "body");
    await pressLink(creator, "Library");
    await waitForLibrary(creator);
  });

  const postId =
    await test.step("07 · J3 Library filter and search", async () => {
      // 24 Demo posts, newest first.
      await expect(tiles(creator)).toHaveCount(24);
      await expect(tileCaption(tiles(creator).first())).toHaveText(POST_01);
      await pressLink(creator, "Demo 24");
      await expect.poll(() => searchParam(creator, "platform")).toBe("mock");
      await expect(tiles(creator)).toHaveCount(24);
      const field = creator.getByRole("searchbox", { name: "Search captions" });
      await field.fill("snow");
      await expect.poll(() => searchParam(creator, "q")).toBe("snow");
      expect(searchParam(creator, "platform")).toBe("mock");
      await expect(tiles(creator)).toHaveCount(1);
      await expect(tileCaption(tiles(creator).first())).toHaveText(POST_01);
      await expectNoBareDollar(creator, "body");
      return tilePostId(tiles(creator).first());
    });

  await test.step("08 · J5 Post 01's Source page: 0:14, 14.8M views, View on Demo ↗, the provenance, Make licensable", async () => {
    await pressLocator(tileLink(tiles(creator).first()));
    await creator.waitForURL(sourcePageHref(postId));
    await expect(
      creatorMain.getByText("Demo · 1 Oct 2026 · 0:14", { exact: true }),
    ).toBeVisible();
    await expect(creatorMain.getByText(/^14\.8M views\b/)).toBeVisible();
    await expect(
      creatorMain.getByRole("link", {
        name: "View on Demo (opens in a new tab)",
        exact: true,
      }),
    ).toHaveText("View on Demo ↗");
    // Nothing is verified yet: the Source page's line has no "· Verified" (05 over 01; design §2).
    await expect(
      creatorMain.getByText("From Demo · @demo.creator · posted 1 Oct 2026", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      creatorMain.getByRole("button", { name: "Make licensable", exact: true }),
    ).toBeVisible();
    await expectNoBareDollar(creator, "body");
  });

  const videoId =
    await test.step("09 · J5 Make licensable opens the File step: the verified provenance and Demo's notice", async () => {
      const id = await makeLicensable(creator, postId);
      await expect(creator).toHaveURL(videoStepHref(id, "file"));
      await expect(
        creatorMain.getByText(
          "From Demo · @demo.creator · posted 1 Oct 2026 · Verified",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        creatorMain.getByText(FILE_NOTICE, { exact: true }),
      ).toBeVisible();
      await expectNoBareDollar(creator, "body");
      return id;
    });

  await test.step("10 · J5 The original attached with its cover, then Where posted", async () => {
    const cover = await attachSample(creator);
    // Q4 (design §2): Chromium reads a frame of sample.mp4, WebKit takes "Choose an image" with poster.jpg.
    testInfo.annotations.push({ type: "Q4 cover", description: cover });
    console.log(`Q4 [${testInfo.project.name}]: ${cover}`);
    const attached = creatorMain.getByText(/^Original attached/).first();
    if (browserName === "chromium") {
      await expect(attached).toHaveText(
        "Original attached · 0:14 · 720 × 1280",
      );
    } else {
      await expect(attached).toContainText("Original attached · 0:14");
    }
    await expectNoBareDollar(creator, "body");
    await continueToPostings(creator, videoId);
  });

  await test.step("10b · J5 Where posted: the locked source row, the post beside the cover, Continue only after the tick", async () => {
    // The locked row in its three parts (04 §9.33; design §2): the title, the Verified pill, "· From your Library".
    const source = sourceRow(creator);
    await expect(source).toHaveCount(1);
    await expect(
      source.getByText(sourceRowTitle(DEMO_ACCOUNT, DEMO), { exact: true }),
    ).toBeVisible();
    await expect(
      source.getByText(POSTINGS_COPY.verified, { exact: true }),
    ).toBeVisible();
    await expect(
      source.getByText(`· ${POSTINGS_COPY.fromLibrary}`, { exact: true }),
    ).toBeVisible();
    // The post's picture beside the cover, both loaded; no duration warning (post 01 is 14 s, as the file is).
    const block = sameVideoBlock(creator);
    await expect(block.locator("figcaption")).toHaveText([
      "Cover image",
      "Post",
    ]);
    for (const img of await block.locator("img").all()) {
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
        .toBeGreaterThan(0);
    }
    const figures = block.locator("figure");
    await expectLeftOf(figures.nth(0), figures.nth(1));
    await expect(creatorMain.getByText(ANY_WARNING)).toHaveCount(0);
    // Continue stays on the step without the tick (07 D69; owner answer Q-75 a), then moves on with it.
    const tick = sameVideoTick(creator);
    await expect(tick).not.toBeChecked();
    await pressAndSettle(creator, "Continue");
    await expect(creator).toHaveURL(videoStepHref(videoId, "postings"));
    await expect(tick).toHaveAccessibleDescription(MISSING_TICK);
    await tick.focus();
    await tick.press("Space");
    await expect(tick).toBeChecked();
    await expectNoBareDollar(creator, "body");
    await continueToRights(creator, videoId);
  });

  await test.step("11 · J5 Rights: both boxes, Music No, People No; Continue only after the four answers", async () => {
    await expect(continueButton(creator)).toBeDisabled();
    await answerRights(creator, { music: "No", people: "No" });
    await expect(continueButton(creator)).toBeEnabled();
    await expectNoBareDollar(creator, "body");
    await continueToReview(creator, videoId);
  });

  await test.step("12 · J4 Review: the title, slug and rate card; the PricePreview for Paid social ads · 1 year · Worldwide", async () => {
    const step = stepColumn(creator, "review");
    await expect(creator.getByRole("heading", { level: 1 })).toHaveText(TITLE);
    await expect(
      step.getByText(videoUrl(handle, SLUG), { exact: true }),
    ).toBeVisible();
    await expect(basePriceRadio(creator, "rate_card")).toBeChecked();
    await expect(optionTile(creator, "basePrice", "rate_card")).toHaveText(
      VIDEO_PRICE_COPY.useRateCard(
        formatMoney(15_000, "cad", { wholeDollars: true }),
      ),
    );
    await pickCombination(creator, "Paid social ads", "1 year", "Worldwide");
    await expect(previewLine(creator)).toHaveText(quoteLine(PRICE, TOTAL, FEE));
    // No publish blockers, and no platform-link Switch here (it is per posting on Where posted, J5.17).
    await expect(creator.locator("[data-publish-blockers]")).toHaveCount(0);
    await expect(showLinkSwitch(step)).toHaveCount(0);
    await expectNoBareDollar(creator, "body");
  });

  const shareUrl =
    await test.step("14 · J5 Publish: Your video is live., the link and the Verified label", async () => {
      const published = await publish(creator);
      expect(published.slug).toBe(SLUG);
      expect(published.shareUrl).toBe(
        new URL(videoUrl(handle, SLUG), baseURL).href,
      );
      await expect(
        publishedView(creator).getByText(BADGE, { exact: true }),
      ).toBeVisible();
      await expectNoBareDollar(creator, "body");
      return published.shareUrl;
    });

  const link =
    await test.step("15 · J6 Copy the link: Copied, and Link copied", async () => {
      const view = publishedView(creator);
      await view.getByRole("button", { name: "Copy", exact: true }).click();
      // The button's "Copied" and the live region's "Link copied" last 2 s (use-copy-link.ts): one assertion on the view's
      // text reads both, so a loaded worker (or the recording's slowMo) can't spend the window between two.
      await expect(view).toContainText(/Copied.*Link copied/);
      const field = (await view.locator("bdi").textContent()) ?? "";
      expect(field).toBe(shareUrl);
      if (browserName !== "chromium") return field;
      const copied = await creator.evaluate(() =>
        navigator.clipboard.readText(),
      );
      expect(copied).toBe(field);
      return copied;
    });

  await test.step("16 · J6 The license page logged out at 390 × 844: poster, title, @handle, the badge, Where it was posted", async () => {
    const response = await buyer.goto(link);
    expect(response?.status()).toBe(200);
    await hydrated(buyer);
    await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(TITLE);
    const poster = buyer.locator("img");
    await expect(poster).toHaveCount(1);
    await expect(poster).toHaveAttribute(
      "src",
      new RegExp(`^/api/media/posters/${videoId}\\?v=[0-9a-f]{8}$`),
    );
    await expect
      .poll(() => poster.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(
      buyer.getByRole("link", { name: `@${handle}`, exact: true }),
    ).toHaveAttribute("href", `/@${handle}`);
    await expect(buyer.getByText(BADGE, { exact: true })).toBeVisible();
    await expect(
      buyer.getByRole("button", { name: BADGE_COPY.explainerLink }),
    ).toBeVisible();
    const row = buyer
      .getByRole("region", { name: "Where it was posted" })
      .locator("[data-posting-row]");
    await expect(row).toHaveCount(1);
    await expect(
      row.getByText(sourceRowTitle(DEMO_ACCOUNT, DEMO), { exact: true }),
    ).toBeVisible();
    await expect(
      row.getByText(POSTINGS_COPY.verified, { exact: true }),
    ).toBeVisible();
    const viewPost = row.getByRole("link", {
      name: "View post on Demo (opens in a new tab)",
      exact: true,
    });
    await expect(viewPost).toHaveText("View post ↗");
    await expect(viewPost).toHaveAttribute("href", OWN_DEMO_LINK);
    // No sign-in and no cookie banner; J7.20: no cookie set, nothing asked of another host.
    await expect(buyer.getByRole("link", { name: "Sign in" })).toHaveCount(0);
    await expect(buyer.getByText(/cookie/i)).toHaveCount(0);
    expect(await contexts.buyer.cookies()).toEqual([]);
    expect(buyerExternal).toEqual([]);
    await expectNoBareDollar(buyer, "body");
  });

  await test.step("17 · J7 Paid social ads · 1 year · Worldwide: the sticky bar, the currency line and the summary", async () => {
    await chooseDemoSelection(buyer);
    const bar = buyer.locator("[data-pricebar]");
    await expect(bar.locator("[data-price-lines]")).toHaveText(
      `${LICENSE_PAGE_COPY.license(PRICE)} · ${LICENSE_PAGE_COPY.serviceFee(FEE)}`,
    );
    await expect(bar.locator("[data-price-total]")).toContainText(
      LICENSE_PAGE_COPY.total(TOTAL),
    );
    await expect(
      buyerMain.getByText("Prices in Canadian dollars (CAD).", { exact: true }),
    ).toBeVisible();
    await expect(
      buyer.getByRole("heading", {
        name: `License summary · ${SCOPE}`,
        exact: true,
      }),
    ).toBeVisible();
    await expectNoBareDollar(buyer, "body");
  });

  const requestId =
    await test.step("18 · J7 Your details and the terms, then the fake checkout's two lines and Pay CA$1,732.50", async () => {
      await fillDetails(buyer, { email: samEmail, licensee: E2E_LICENSEE });
      const terms = buyer.getByRole("checkbox");
      await terms.focus();
      await terms.press("Space");
      await expect(terms).toBeChecked();
      await expect(requestButton(buyer)).toHaveAccessibleName(
        LICENSE_PAGE_COPY.request(TOTAL),
      );
      // J7.20 up to checkout: still no cookie, and every request went to the app.
      expect(await contexts.buyer.cookies()).toEqual([]);
      expect(buyerExternal).toEqual([]);
      await pressLocator(requestButton(buyer));
      await buyer.waitForURL(FAKE_CHECKOUT_URL);
      await expect(buyerMain.locator("dl > div")).toHaveText([
        `${CHECKOUT_COPY.license}${PRICE}`,
        `${CHECKOUT_COPY.serviceFee}${FEE}`,
        `${CHECKOUT_COPY.total}${TOTAL}`,
      ]);
      await expect(payButton(buyer)).toHaveText(CHECKOUT_COPY.pay(TOTAL));
      await expectNoBareDollar(buyer, "body");
      return buyer.url().split("/").at(-1) ?? "";
    });

  const statusUrl =
    await test.step("19 · J7 Pay: /r reads Waiting for @handle with its 72 h countdown; Request sent", async () => {
      const since = Date.now();
      const paid = requestEnded(buyer, isServerAction);
      await pressLocator(payButton(buyer));
      await paid;
      await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
        REQUEST_STATUS_COPY.waitingTitle(handle),
      );
      await expect(buyer).toHaveURL(new RegExp(`/r/${requestId}\\?t=`));
      await expect(buyerMain.locator("time")).toHaveText(COUNTDOWN);
      await expect(
        buyerMain.getByText(
          new RegExp(`@${handle} has until .+ to approve\\.`),
        ),
      ).toBeVisible();
      await expectNoBareDollar(buyer, "body");
      const sent = await readLatestEmail({
        to: samEmail,
        template: "request-received",
        since,
      });
      expect(sent.subject).toBe(`Request sent to @${handle}`);
      const url = buyerStatusUrl(buyer);
      // Off /r before its first 30 s refresh: the buyer reloads it at step 22.
      await buyer.goto("about:blank");
      return url;
    });

  const inboxRow = creator.locator("[data-inbox-row]");
  await test.step("20 · J7 The Inbox: the request, its scope, You get CA$1,575.00 and Expires in 2 d 23 h", async () => {
    await creator.goto("/dashboard");
    await expect(inboxRow).toHaveCount(1);
    await expect(inboxRow.locator("[data-licensee]")).toHaveText(E2E_LICENSEE);
    await expect(inboxRow).toContainText(SCOPE);
    await expect(inboxRow).toContainText(INBOX_COPY.youGet(PRICE));
    await expect(inboxRow.locator("time")).toHaveText(COUNTDOWN);
    await expectNoBareDollar(creator, "body");
  });

  const licenseCode =
    await test.step("21 · J8 Approve: on its way to your Stripe balance, the code, then Paid out (J11 via the fake driver)", async () => {
      await pressAndSettleIn(creator, inboxRow, INBOX_COPY.approve);
      await expect(
        toast(
          creator,
          `Approved. ${PRICE} is on its way to your Stripe balance.`,
        ),
      ).toBeVisible();
      // A code as issued (07 D101), or a throw.
      const code = await issuedCode(inboxRow);
      await expectNoBareDollar(creator, "body");
      // Off the Inbox before its next refresh (WebKit cancels a refresh in flight).
      await creator.goto("about:blank");
      // The transfer runs after the approval's response (07 D74, D75): stored, of the license price, then History.
      const transfer = await expectMovementSucceeded(
        requestId,
        "creator_transfer",
      );
      expect(transfer.amountCents).toBe(PRICE_CENTS);
      await creator.goto("/dashboard?view=history");
      const row = inboxRow.filter({
        has: creator.locator("[data-licensee]", { hasText: E2E_LICENSEE }),
      });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(PRICE);
      await expect(
        row.getByText(PAYOUT_LINE_COPY.paidOut, { exact: true }),
      ).toBeVisible();
      await expectNoBareDollar(creator, "body");
      await creator.goto("about:blank");
      return code;
    });

  const token = buyerKey(statusUrl);
  await test.step("22 · J9 /r Approved, Get file and license: the original and the PDF; Downloaded 2 times", async () => {
    await buyer.goto(statusUrl);
    await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
      REQUEST_STATUS_COPY.approvedTitle,
    );
    await expectNoBareDollar(buyer, "body");
    const getFile = buyer.getByRole("link", {
      name: REQUEST_STATUS_COPY.getFileAndLicense,
      exact: true,
    });
    await expect(getFile).toHaveAttribute("href", licensePath(token));
    await pressLocator(getFile);
    await expect(buyer).toHaveURL(new RegExp(`/l/${token}$`));
    const card = buyerMain.locator("section").first();
    await expect(
      fact(card, LICENSE_RECORD_COPY.buyer.facts.license),
    ).toContainText(licenseCode);
    await expect(
      card.getByText("Amounts in Canadian dollars (CAD).", { exact: true }),
    ).toBeVisible();
    await expectNoBareDollar(buyer, "body");

    // Download original: the file under its name, with the sample's bytes (14 s).
    const original = buyerMain.locator(
      `a[href="${licenseDownloadPath(token, "original")}"]`,
    );
    const download = buyer.waitForEvent("download");
    await pressLocator(original);
    const saved = await download;
    expect(saved.suggestedFilename()).toBe(
      `${APP_NAME}-${licenseCode}-original.mp4`,
    );
    expect((await stat(await saved.path())).size).toBe(
      (await stat(SAMPLE_MP4)).size,
    );

    // Download license PDF: the route's answer, with the code and the verify URL printed in it.
    const pdfPath = licenseDownloadPath(token, "pdf");
    await expect(
      buyerMain.locator(`a[href="${pdfPath}"]`),
    ).toHaveAccessibleName(LICENSE_RECORD_COPY.buyer.downloadPdf);
    const pdf = await buyer.request.get(pdfPath);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect(pdf.headers()["content-disposition"]).toContain(
      `${APP_NAME}-${licenseCode}-license.pdf`,
    );
    const bytes = await pdf.body();
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const printed = squash(pdfPages(bytes).map(pageBody).join(""));
    expect(printed).toContain(squash(licenseCode));
    expect(printed).toContain(squash(verifyPath(licenseCode)));

    // The creator's Licenses: one row per answered download, in the form this width shows.
    await creator.goto("/dashboard/licenses");
    const row = licenseRows(creator).filter({ hasText: licenseCode });
    await expect(row).toHaveCount(1);
    await expect(
      row.getByText("Downloaded 2 times", { exact: true }),
    ).toBeVisible();
    await expectNoBareDollar(creator, "body");
    // The creator's last page: parked, so none of its link prefetches is still loading when S5 closes the window
    // (WebKit leaves such a body unread).
    await creator.goto("about:blank");
  });

  await test.step("23 · J10 /verify: Valid license, the licensee, Maya R. (@handle), the scope, UTC dates, the badge; no amount", async () => {
    const verified = await buyer.goto(verifyPath(licenseCode));
    expect(verified?.status()).toBe(200);
    await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
      LICENSE_RECORD_COPY.verify.heading.valid,
    );
    const facts = LICENSE_RECORD_COPY.buyer.facts;
    const own = LICENSE_RECORD_COPY.verify.facts;
    await expect(fact(buyerMain, facts.licensedTo)).toHaveText(E2E_LICENSEE);
    await expect(fact(buyerMain, own.licensedBy)).toHaveText(
      `${DISPLAY_NAME} (@${handle})`,
    );
    await expect(fact(buyerMain, facts.use)).toHaveText("Paid social ads");
    await expect(fact(buyerMain, facts.term)).toHaveText("1 year");
    await expect(fact(buyerMain, facts.territory)).toHaveText("Worldwide");
    for (const label of [own.starts, own.ends]) {
      await expect(fact(buyerMain, label)).toHaveText(
        new RegExp(`^${LICENSE_DATE}$`),
      );
    }
    await expect(fact(buyerMain, own.ownership)).toContainText(BADGE);
    await expect(
      buyer.getByRole("region", { name: "Where it was posted" }),
    ).toBeVisible();
    // No amount at all, so no "$" either (CA$ included).
    expect(await buyer.locator("body").innerText()).not.toContain("$");
  });

  // Steps 28–29 read the buyer's pages in a page of their own: a disabled video's license page and poster answer 404.
  const sharePath = new URL(link).pathname;
  const after = await buyerBodies.newPage();
  const afterErrors = collectConsoleErrors(after, [
    { status: 404, pathname: sharePath },
    { status: 404, pathname: `/api/media/posters/${videoId}` },
  ]);

  await test.step("28 · ADMIN Disable the video (reason Other): its posting released; the step-15 link is the 404", async () => {
    // Minutes after step 09 made it, other specs' videos could push this one out of the tab's newest 50: moved first.
    await openAdminTab(admin, "videos", [videoId]);
    const row = adminRows(admin, ADMIN_TAB_LABELS.videos).filter({
      hasText: `@${handle}`,
    });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("Live", { exact: true })).toBeVisible();
    await expectNoBareDollar(admin, "body");
    await pressLocator(
      row.getByRole("button", {
        name: DISABLE_COPY.actionLabel(TITLE),
        exact: true,
      }),
    );
    const sheet = admin.getByRole("alertdialog", {
      name: DISABLE_COPY.title(TITLE),
      exact: true,
    });
    // No request waits on the video (the step-21 one is approved).
    await expect(sheet).toHaveAccessibleDescription(DISABLE_COPY.body(0));
    await sheet
      .getByRole("combobox", { name: DISABLE_COPY.reason, exact: true })
      .selectOption("other");
    await pressAndSettleIn(admin, sheet, DISABLE_COPY.confirm);
    await expect(toast(admin, DISABLE_COPY.toast)).toBeVisible();
    await expect(sheet).toHaveCount(0);
    await expect(row).toContainText(VIDEO_DISABLED_REASON_LABELS.other);
    await expect(row).toContainText(ADMIN_COPY.postings(1, 0));

    const gone = await after.goto(sharePath);
    expect(gone?.status()).toBe(404);
    await expect(
      after.getByRole("heading", {
        level: 1,
        name: "This video isn't available for licensing right now.",
      }),
    ).toBeVisible();
    await expectNoBareDollar(after, "body");
  });

  await test.step("29 · ADMIN Revoke the license (Issued in error) once its transfer was sent: refunded and taken back", async () => {
    // As step 28's video: the license is minutes old, and each open below follows a wait.
    await openAdminTab(admin, "licenses", [requestId]);
    const row = adminRows(admin, ADMIN_TAB_LABELS.licenses).filter({
      hasText: licenseCode,
    });
    await expect(row).toHaveCount(1);
    // Sent (step 21 waited for it), so the revoke takes it back rather than canceling it.
    const sent = transferLabel({
      status: "succeeded",
      amountCents: PRICE_CENTS,
      currency: "cad",
      lastError: null,
    });
    if (sent === null) throw new Error("step 29: no transfer words");
    await expect(row).toContainText(sent);
    await expectNoBareDollar(admin, "body");
    await pressLocator(
      row.getByRole("button", {
        name: REVOKE_COPY.actionLabel(licenseCode),
        exact: true,
      }),
    );
    const sheet = admin.getByRole("alertdialog", {
      name: REVOKE_COPY.title(licenseCode),
      exact: true,
    });
    await sheet
      .getByRole("combobox", { name: DISABLE_COPY.reason, exact: true })
      .selectOption("issued_in_error");
    await expect(sheet).toHaveAccessibleDescription(
      REVOKE_COPY.takeBackBody(TOTAL, PRICE, handle),
    );
    await pressAndSettleIn(admin, sheet, REVOKE_COPY.confirm);
    await expect(toast(admin, REVOKE_COPY.toast)).toBeVisible();
    await expect(sheet).toHaveCount(0);

    // The refund and the take-back run after the revoke's response: both stored, then the tab.
    for (const kind of ["buyer_refund", "transfer_reversal"] as const) {
      await expectMovementSucceeded(requestId, kind);
    }
    expect((await storedMovement(requestId, "creator_transfer")).status).toBe(
      "succeeded",
    );
    await openAdminTab(admin, "licenses", [requestId]);
    await expect(row).toContainText(
      [MONEY_COPY.refunded(TOTAL), MONEY_COPY.takenBack(PRICE)].join(
        MONEY_COPY.separator,
      ),
    );
    await expectNoBareDollar(admin, "body");

    // The buyer's /l: the refund line and no download; both routes 404. /verify: Revoked.
    const { revokedAt } = await storedLicense(requestId);
    if (revokedAt === null)
      throw new Error("step 29: the license isn't revoked");
    await after.goto(licensePath(token));
    await expect(
      after
        .locator("main")
        .getByText(
          `Revoked on ${formatLicenseDate(revokedAt)}. You were refunded ${TOTAL}.`,
          { exact: true },
        ),
    ).toBeVisible();
    await expect(after.locator('main a[href^="/api/licenses/"]')).toHaveCount(
      0,
    );
    await expectNoBareDollar(after, "body");
    for (const kind of ["original", "pdf"] as const) {
      const answer = await request.get(licenseDownloadPath(token, kind), {
        maxRedirects: 0,
      });
      expect(answer.status()).toBe(404);
    }
    await after.goto(verifyPath(licenseCode));
    await expect(after.getByRole("heading", { level: 1 })).toHaveText(
      LICENSE_RECORD_COPY.verify.heading.revoked,
    );
    await expectNoBareDollar(after, "body");
  });

  await test.step("07 D20 · /@maya.films through the rewrite: 200, the address stays", async () => {
    const response = await after.goto(`/@${MAYA_FILMS}`);
    expect(response?.status()).toBe(200);
    expect(response?.request().redirectedFrom()).toBeNull();
    await expect(after).toHaveURL(`/@${MAYA_FILMS}`);
    await expect(
      after.getByText(`@${MAYA_FILMS}`, { exact: true }),
    ).toBeVisible();
    await expectNoBareDollar(after, "body");
  });

  await test.step("S5 · S7 No mock token in any page body, no storage key or signed URL in the buyer's; a bad download token is the 404", async () => {
    for (const kind of ["original", "pdf"] as const) {
      const answer = await request.get(`/api/licenses/not-a-token/${kind}`, {
        maxRedirects: 0,
      });
      expect(answer.status()).toBe(404);
    }
    // A body still open settles only once its context closes. One after another, as the green runs closed them.
    await contexts.creator.close();
    await contexts.buyer.close();
    await contexts.admin.close();
    const creatorSeen = await creatorBodies.settled();
    const buyerSeen = await buyerBodies.settled();
    const count = ({ bodies, failed, unread }: WatchedBodies) =>
      `${bodies.length} read, ${unread.length} unread, ${failed.length} cancelled or failed`;
    const scanned = `creator ${count(creatorSeen)}; buyer ${count(buyerSeen)}`;
    testInfo.annotations.push({ type: "S5/S7 bodies", description: scanned });
    console.log(`S5/S7 [${testInfo.project.name}]: ${scanned}`);
    expect(creatorSeen.bodies.length).toBeGreaterThan(0);
    expect(buyerSeen.bodies.length).toBeGreaterThan(0);
    // Every body read. A load cancelled or failed after its response began (Next's router cancels prefetches cut at their
    // static stage, superseded RSC navigations and redirected server actions; Chromium reports them) counts apart.
    expect(creatorSeen.unread).toEqual([]);
    expect(buyerSeen.unread).toEqual([]);
    expect(
      findLeaks([...creatorSeen.bodies, ...buyerSeen.bodies], [MOCK_TOKEN]),
    ).toEqual([]);
    expect(findLeaks(buyerSeen.bodies, STORAGE_LEAKS)).toEqual([]);
  });

  expect(creatorErrors).toEqual([]);
  expect(buyerErrors).toEqual([]);
  expect(afterErrors).toEqual([]);
  expect(adminErrors).toEqual([]);
  await recording?.finish(testInfo);
});
