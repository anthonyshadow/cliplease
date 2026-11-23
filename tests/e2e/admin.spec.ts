import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { focusAnchorSelector } from "../../src/app/admin/_components/focus-anchor";
import {
  ADMIN_COLUMNS,
  ADMIN_COPY,
  DISABLE_COPY,
  ENABLE_COPY,
  MONEY_COPY,
  RETRY_COPY,
  REVOKE_COPY,
} from "../../src/lib/admin/copy";
import {
  type AdminStatusCell,
  adminRequestStatus,
  auditActorLabel,
  MONEY_MOVEMENT_KIND_LABELS,
  transferLabel,
} from "../../src/lib/admin/labels";
import {
  ADMIN_TAB_LABELS,
  ADMIN_TABS,
  type AdminTab,
  adminTabHref,
} from "../../src/lib/admin/tabs";
import { APP_NAME } from "../../src/lib/app-name";
import { formatLicenseDate, formatMoney } from "../../src/lib/format";
import { LICENSE_PAGE_COPY } from "../../src/lib/licensing/license-page";
import { LICENSE_RECORD_COPY } from "../../src/lib/licensing/license-record";
import { MY_LICENSES_COPY } from "../../src/lib/licensing/my-licenses-copy";
import { PAYOUT_LINE_COPY } from "../../src/lib/licensing/payout-line";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import {
  POSTINGS_COPY,
  postingActionLabel,
  postingResultCopy,
  sourceRowTitle,
} from "../../src/lib/postings/copy";
import { postingPlatformLabel } from "../../src/lib/postings/labels";
import {
  licenseDownloadPath,
  licensePath,
  verifyPath,
} from "../../src/lib/urls";
import {
  disabledLine,
  editRowLabel,
  REVIEW_COPY,
  VIDEO_DISABLED_REASON_LABELS,
} from "../../src/lib/videos/review";
import { videoHref, videoStepHref } from "../../src/lib/videos/steps";
import { VIDEO_PAGE_COPY } from "../../src/lib/videos/video-page";
import { E2E_LICENSEE } from "./helpers/buyer";
import { collectConsoleErrors, visit } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  buyLicense,
  licenseVideo,
  publishDemoVideo,
  videoPage,
} from "./helpers/flows";
import {
  atEveryWidth,
  boxOf,
  expectAbove,
  expectNoBareDollar,
  expectPageFrame,
  expectSheetForm,
  expectTouchTarget,
  TIERS,
  viewportWidth,
} from "./helpers/layout";
import { POST_01 } from "./helpers/library";
import {
  fact,
  factLabel,
  forceTakeBackFailed,
  licenseRows,
  MANUAL_TEST_ERROR,
  ORGANIC_30_WORLDWIDE,
  storedLicense,
  storedMovement,
} from "./helpers/licenses";
import { ageCheckedAt } from "./helpers/postings";
import {
  pressAndSettle,
  pressAndSettleIn,
  pressButton,
  pressLink,
  pressLocator,
  toast,
} from "./helpers/press";
import {
  e2eAdminEmail,
  expectRefreshWhenDue,
  signInWithEmail,
} from "./helpers/sign-in";
import { cleanCreatedVideos, sameVideoTick, sourceRow } from "./helpers/videos";

// The admin view (P21, P21b; 01 A.1–A.6, A.8, G.6, J8.10, J9.6, J9.8, J10.3; 05 §7; 07 D28, D66, D86, D88, D154;
// design/P21-admin-view.md §4.14; owner answers Q-207–Q-209) on chromium-desktop and webkit-iphone. A signed-in creator
// gets the 404 on /admin. The e2e admin's one test per project (07 D154: two OTP sign-ins of one address can overwrite
// each other's code) holds every admin step: P04's sign-in checks (moved from sign-in.spec.ts), a published Library video
// of a creator in a context of its own with one approved license and one waiting request, the six tabs with this run's
// rows (found by the run's @handle, a buyer's address or the code: every demo video shares a title), then Disable (reason
// Other, a note only admins see): the license page's 404, the waiting request's /r "Not approved", the creator's Banner
// without the note, the old /l still Verified on Demo; Enable: «Off», Where posted's released source row, Check again
// (its 30 s cooldown aged in the test database, no sleep), the same-video tick again and Turn on. Then A.5: two more
// licenses on the video, each Licenses row reading its transfer sent (a reload until it does: a revoke before that is
// refused or cancels the payout); the Revoke sheet's money sentence with the stored amounts, Payment reversed's, and
// Issued in error's revoke; Events' license.revoked; the Money cell's refund and take-back; /verify Revoked with no
// amount, /l's refund line with no download and both routes 404; the creator's «Revoked · refunded» and Taken back.
// A.8: the take-back failed in the test database shows in Events and the Money cell, and Retry runs its next attempt.
// Then the G.6 sweep of each ?tab= (atEveryWidth: every width on chromium-desktop, both themes at the iPhone's own 402
// px), after the last lookup of this run's Videos row; on Licenses, the license left valid: its Money value, and its
// Revoke sheet opened and closed with Esc once per width. Events is read right after each action, filtered by the video
// or the code, so other specs' rows can't push this run's out of the newest 50. The session refresh runs last: it
// installs a clock two days ahead.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** The waiting request's licensee, apart from the approved license's E2E_LICENSEE. */
const WAITING_LICENSEE = "Northwind Brands Inc.";
/** The mock provider's account every e2e creator links (07 D53), and its platform's name. */
const DEMO_ACCOUNT = "@demo.creator";
const DEMO = postingPlatformLabel("mock", null);
/** The widest phone the sweep runs (the iPhone 17's 402 px): there the six tabs never fit their row. */
const WIDEST_PHONE = 402;
/** A.5's licensees: the license the admin revokes, and the one left valid for the sweep. */
const REVOKED_LICENSEE = "Fabrikam Studio LLC";
const VALID_LICENSEE = "Contoso Media Ltd.";
const LICENSE_COLUMN = ADMIN_COLUMNS.licenses;
/** The Money column's place in the Licenses table: ADMIN_COLUMNS lists each table's headers in its columns' order. */
const MONEY_COLUMN = Object.keys(LICENSE_COLUMN).indexOf("money");

/** A released source row's result (07 D66): its words and its one action, Check again. */
const RELEASED = postingResultCopy(
  {
    platform: "mock",
    label: DEMO,
    url: "https://demo.invalid/post",
    verification: "unverified",
    unverifiedReason: "released",
    verifiedUsername: DEMO_ACCOUNT,
    accountStatus: "connected",
  },
  {
    appName: APP_NAME,
    providerEnabled: true,
    hasConnectedAccount: true,
    onlyNeedsReconnect: false,
  },
);

/** A status cell's words: its pill's label, or the raw value. */
const statusText = (cell: AdminStatusCell) =>
  cell.kind === "pill" ? cell.label : cell.text;

/** The video page's status pill (Off, Live) by its words. */
const statusPill = (page: Page, label: string) =>
  page.locator("[data-video-aside]").getByText(label, { exact: true });

/** The tab row: a <nav> of six links. */
const tabRow = (page: Page) =>
  page.getByRole("navigation", { name: ADMIN_COPY.tabsLabel, exact: true });

/** The name of a tab's table (its stacked list's label, the table's caption): Events' first list is Latest events. */
const tableName = (tab: AdminTab) =>
  tab === "events" ? ADMIN_COPY.latestEventsHeading : ADMIN_TAB_LABELS[tab];

/** A table's rows in the form the tier shows (DataTable renders both; the other is display: none), by its name. */
const adminRows = (page: Page, name: string) => {
  const main = page.locator("main");
  return main
    .getByRole("list", { name, exact: true })
    .locator(":scope > li")
    .or(main.getByRole("table", { name, exact: true }).locator("tbody > tr"));
};

/** Latest events' rows with audit action `action` about video `videoId`: its own, and its postings' `{ videoId }`. */
const videoEvents = (page: Page, videoId: string, action: string) =>
  adminRows(page, ADMIN_COPY.latestEventsHeading)
    .filter({ hasText: videoId })
    .filter({ has: page.getByText(action, { exact: true }) });

/** Where the focus lands in a Licenses row once its Revoke or Retry is gone: its code. */
const rowAnchor = (row: Locator) => row.locator(focusAnchorSelector("row"));

/** A Licenses row's Money label in its stacked form (below lg). */
const moneyLabel = (row: Locator) => factLabel(row, LICENSE_COLUMN.money);

/** A Licenses row's Money value in the form `width` shows: the <dd> under its label below lg, its column's <td> from lg. */
const moneyValue = (row: Locator, width: number) =>
  width < TIERS.desktop
    ? fact(row, LICENSE_COLUMN.money)
    : row.locator(":scope > td").nth(MONEY_COLUMN);

/** A license as A.5 arranged it, with its stored amounts formatted as the admin view prints them. */
type A5License = Awaited<ReturnType<typeof licenseVideo>> & {
  /** formatMoney of amount_total_cents. */
  total: string;
  /** formatMoney of license_price_cents: the transfer, and its take-back. */
  price: string;
  /** Its Money cell while its creator transfer is sent and it isn't revoked: "Transfer {price} sent". */
  sent: string;
};

/** Reads `license`'s stored amounts (the test database) and formats them as the admin view does. */
async function withAmounts(
  license: Awaited<ReturnType<typeof licenseVideo>>,
): Promise<A5License> {
  const stored = await storedLicense(license.requestId);
  const sent = transferLabel({
    status: "succeeded",
    amountCents: stored.priceCents,
    currency: stored.currency,
    lastError: null,
  });
  if (sent === null) throw new Error("withAmounts: no transfer words");
  return {
    ...license,
    total: formatMoney(stored.totalCents, stored.currency),
    price: formatMoney(stored.priceCents, stored.currency),
    sent,
  };
}

/** Opens `tab` and waits for its segment to be the current one. */
async function openTab(page: Page, tab: AdminTab) {
  await page.goto(adminTabHref(tab));
  await expect(tabRow(page).locator('[aria-current="page"]')).toHaveText(
    ADMIN_TAB_LABELS[tab],
  );
}

/**
 * A.6, right after the admin's action: Events lists exactly one row of each of `actions` about video `videoId`, each
 * by `admin`.
 */
async function expectVideoEvents(
  page: Page,
  videoId: string,
  admin: string,
  actions: readonly string[],
) {
  await openTab(page, "events");
  const actor = auditActorLabel({
    actorType: "admin",
    actorEmail: admin,
    actorSource: null,
  });
  for (const action of actions) {
    const rows = videoEvents(page, videoId, action);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(actor);
  }
}

/** The tab row's facts at any width (design §4.11): the six links, `tab` the one current page. */
async function expectTabLinks(page: Page, tab: AdminTab) {
  const nav = tabRow(page);
  await expect(nav.getByRole("link")).toHaveText(
    ADMIN_TABS.map((t) => ADMIN_TAB_LABELS[t]),
  );
  const current = nav.locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(ADMIN_TAB_LABELS[tab]);
  await expect(current).toHaveAttribute("href", adminTabHref(tab));
}

/**
 * The tab row at `width` (design §4.11): the current one a 44 px target; below md it scrolls sideways inside its own box
 * and never fits a phone, from md the six fit as equal segments.
 */
async function expectTabRow(page: Page, width: number) {
  const nav = tabRow(page);
  await expectTouchTarget(nav.locator('[aria-current="page"]'));
  const box = await nav.evaluate((el) => ({
    overflow: el.scrollWidth - el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
  }));
  if (width < TIERS.tablet) {
    expect(box.overflowX).toBe("auto");
    if (width <= WIDEST_PHONE) expect(box.overflow).toBeGreaterThan(0);
  } else {
    expect(box.overflow).toBeLessThanOrEqual(0);
  }
}

/**
 * `tab`'s table at `width` (04 §9.31): stacked rows below 1024 with no table showing, a visible <table> from 1024 with
 * no stacked list showing. The Requests table is wider than its card at 1024 and scrolls inside its own wrapper.
 */
async function expectTableForm(page: Page, tab: AdminTab, width: number) {
  const main = page.locator("main");
  const name = tableName(tab);
  const shown = (selector: string) =>
    main.locator(selector).filter({ visible: true });
  if (width < TIERS.desktop) {
    await expect(main.getByRole("list", { name, exact: true })).toBeVisible();
    await expect(shown("[data-table-wide]")).toHaveCount(0);
    return;
  }
  await expect(main.getByRole("table", { name, exact: true })).toBeVisible();
  await expect(shown("[data-table-stacked]")).toHaveCount(0);
  if (tab === "requests" && width === TIERS.desktop) {
    const wrapper = await shown("[data-table-wide]").evaluate((el) => ({
      overflow: el.scrollWidth - el.clientWidth,
      overflowX: getComputedStyle(el).overflowX,
    }));
    expect(wrapper.overflowX).toBe("auto");
    expect(wrapper.overflow).toBeGreaterThan(0);
  }
}

/**
 * The Licenses tab at `width` with `license`, which isn't revoked (07 D146, D149; 04 §9.22): its Money value under its
 * label below lg, in the Money column's own cell from lg with the table scrolling inside its wrapper (never the page:
 * expectPageFrame). With `sheet`, its Revoke sheet opens in the tier's form with Keep license focused, and Esc closes it
 * with the focus back on Revoke. Nothing is revoked.
 */
async function expectLicenseRowAt(
  page: Page,
  license: Pick<A5License, "code" | "sent">,
  width: number,
  sheet: boolean,
) {
  const row = adminRows(page, ADMIN_TAB_LABELS.licenses).filter({
    hasText: license.code,
  });
  const value = moneyValue(row, width);
  await expect(value).toHaveText(license.sent);
  if (width < TIERS.desktop) {
    await expectAbove(moneyLabel(row), value);
  } else {
    const table = page.locator("main").getByRole("table", {
      name: ADMIN_TAB_LABELS.licenses,
      exact: true,
    });
    await expect(table.locator("thead th").nth(MONEY_COLUMN)).toHaveText(
      LICENSE_COLUMN.money,
    );
    await expect(table.locator("xpath=..")).toHaveCSS("overflow-x", "auto");
  }
  if (!sheet) return;
  const trigger = row.getByRole("button", {
    name: REVOKE_COPY.actionLabel(license.code),
    exact: true,
  });
  await pressLocator(trigger);
  const dialog = page.getByRole("alertdialog", {
    name: REVOKE_COPY.title(license.code),
    exact: true,
  });
  await expectSheetForm(dialog, width);
  await expect(
    dialog.getByRole("button", { name: REVOKE_COPY.cancel, exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

test("A.1: a signed-in creator gets the 404 on /admin, with nothing of the admin view", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUpCreator(page, { payouts: false });
  const errors = await visit(page, "/admin", 404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found." }),
  ).toBeVisible();
  await expect(page).toHaveTitle(`Page not found · ${APP_NAME}`);
  await expect(tabRow(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("A.2–A.6, A.8, G.6: the e2e admin signs in to /admin, reads the six tabs at every tier, disables a video and enables it again, revokes a license with its refund and retries a failed take-back", async ({
  page,
  browser,
  request,
}, testInfo) => {
  const admin = e2eAdminEmail(testInfo);
  if (admin === null) {
    test.skip(
      true,
      "admin sign-in runs on chromium-desktop and webkit-iphone only (07 D88, D154)",
    );
    return;
  }
  test.setTimeout(600_000);
  const errors = collectConsoleErrors(page);
  const note = `ticket-${randomUUID().slice(0, 8)}`;

  await test.step("the OTP sign-in lands on /admin in the admin shell", async () => {
    await signInWithEmail(page, admin, "/admin");
    await expect(page).toHaveURL("/admin");
    await expect(page).toHaveTitle(`Admin · ${APP_NAME}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Admin" }),
    ).toBeAttached();
    await expect(page.getByRole("banner")).toContainText("Admin");
    await expect(tabRow(page).locator('[aria-current="page"]')).toHaveText(
      ADMIN_TAB_LABELS.creators,
    );
  });

  // The creator signs in apart from the admin, in a context of its own.
  const creatorContext = await browser.newContext();
  const creator = await creatorContext.newPage();
  const creatorErrors = collectConsoleErrors(creator);
  const arranged =
    await test.step("arrange: a published Library video, one approved license, one waiting request", async () => {
      const published = await publishDemoVideo(creator);
      await creator.goto(videoHref(published.videoId));
      const heading = videoPage(creator).getByRole("heading", { level: 1 });
      await expect(heading).toHaveText(POST_01);
      const title = (await heading.textContent()) ?? "";
      const license = await licenseVideo(
        creator,
        browser,
        published.shareUrl,
        ORGANIC_30_WORLDWIDE,
      );
      const waiting = await buyLicense(browser, published.shareUrl, {
        ...ORGANIC_30_WORLDWIDE,
        licensee: WAITING_LICENSEE,
      });
      // Off /r before its first 30 s refresh; the buyer comes back in a fresh context.
      await waiting.context.close();
      return { ...published, title, license, waiting };
    });
  const { handle, videoId, title, license, waiting } = arranged;
  const videoRow = adminRows(page, ADMIN_TAB_LABELS.videos).filter({
    hasText: `@${handle}`,
  });

  await test.step("A.2: the six tabs, each with this run's rows", async () => {
    // A tab it doesn't know is Creators.
    await page.goto("/admin?tab=nope");
    await expect(tabRow(page).locator('[aria-current="page"]')).toHaveText(
      ADMIN_TAB_LABELS.creators,
    );
    await expect(
      page.locator("main").getByText(ADMIN_COPY.caption, { exact: true }),
    ).toBeVisible();
    const creatorRow = adminRows(page, ADMIN_TAB_LABELS.creators).filter({
      hasText: `@${handle}`,
    });
    await expect(creatorRow).toHaveCount(1);
    await expect(creatorRow).toContainText(arranged.email);

    await openTab(page, "connections");
    const account = adminRows(page, ADMIN_TAB_LABELS.connections).filter({
      hasText: `@${handle}`,
    });
    await expect(account).toHaveCount(1);
    await expect(account).toContainText(DEMO);
    await expect(account).toContainText(DEMO_ACCOUNT);

    await openTab(page, "videos");
    await expect(videoRow).toHaveCount(1);
    await expect(videoRow).toContainText(title);
    await expect(videoRow).toContainText(ADMIN_COPY.verifiedOn(DEMO));
    await expect(videoRow).toContainText(ADMIN_COPY.postings(1, 1));
    await expect(videoRow.getByText("Live", { exact: true })).toBeVisible();
    await expect(
      videoRow.getByRole("button", {
        name: DISABLE_COPY.actionLabel(title),
        exact: true,
      }),
    ).toBeVisible();

    await openTab(page, "requests");
    const requests = adminRows(page, ADMIN_TAB_LABELS.requests);
    const approved = requests.filter({ hasText: license.email });
    await expect(approved).toHaveCount(1);
    await expect(approved).toContainText(E2E_LICENSEE);
    await expect(approved).toContainText(
      statusText(adminRequestStatus({ status: "approved", claimed: false })),
    );
    await expect(approved).toContainText(/CA\$\d/);
    const open = requests.filter({ hasText: waiting.email });
    await expect(open).toHaveCount(1);
    await expect(open).toContainText(WAITING_LICENSEE);
    await expect(open).toContainText(
      statusText(
        adminRequestStatus({ status: "awaiting_approval", claimed: false }),
      ),
    );
    await expectNoBareDollar(page);

    await openTab(page, "licenses");
    const issued = adminRows(page, ADMIN_TAB_LABELS.licenses).filter({
      hasText: license.code,
    });
    await expect(issued).toHaveCount(1);
    await expect(issued).toContainText(E2E_LICENSEE);
    await expect(issued).toContainText(LICENSE_RECORD_COPY.status.valid);
    await expect(issued).toContainText(MY_LICENSES_COPY.standard);

    await openTab(page, "events");
    for (const heading of [
      ADMIN_COPY.latestEventsHeading,
      ADMIN_COPY.failedEmailsHeading,
      ADMIN_COPY.stripeEventsHeading,
    ]) {
      await expect(
        page.getByRole("heading", { level: 2, name: heading, exact: true }),
      ).toBeVisible();
    }
    expect(
      await adminRows(page, ADMIN_COPY.latestEventsHeading).count(),
    ).toBeGreaterThan(0);
  });

  await test.step("A.4: Disable with reason Other and a note only admins see", async () => {
    await openTab(page, "videos");
    await pressLocator(
      videoRow.getByRole("button", {
        name: DISABLE_COPY.actionLabel(title),
        exact: true,
      }),
    );
    const sheet = page.getByRole("alertdialog", {
      name: DISABLE_COPY.title(title),
      exact: true,
    });
    await expectSheetForm(sheet, viewportWidth(page));
    await expect(sheet).toHaveAccessibleDescription(DISABLE_COPY.body(1));
    await sheet
      .getByRole("combobox", { name: DISABLE_COPY.reason, exact: true })
      .selectOption("other");
    await sheet
      .getByRole("textbox", { name: DISABLE_COPY.note, exact: true })
      .fill(note);
    await pressAndSettleIn(page, sheet, DISABLE_COPY.confirm);
    await expect(toast(page, DISABLE_COPY.toast)).toBeVisible();
    await expect(sheet).toHaveCount(0);
    // The row: Enable now, the reason with the note (admins only), its posting released.
    await expect(
      videoRow.getByRole("button", {
        name: ENABLE_COPY.actionLabel(title),
        exact: true,
      }),
    ).toBeVisible();
    await expect(videoRow).toContainText(VIDEO_DISABLED_REASON_LABELS.other);
    await expect(videoRow).toContainText(ADMIN_COPY.note(note));
    await expect(videoRow).toContainText(ADMIN_COPY.postings(1, 0));
    await expect(videoRow).toContainText(ADMIN_COPY.selfAttested);
  });

  await test.step("A.6: Events lists video.disabled and video_posting.released for this video", async () => {
    await expectVideoEvents(page, videoId, admin, [
      "video.disabled",
      "video_posting.released",
    ]);
    await expect(videoEvents(page, videoId, "video.disabled")).toContainText(
      note,
    );
  });

  await test.step("the license page is the 404, the waiting request is Not approved, the old /l still lists Demo as Verified", async () => {
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const sharePath = new URL(arranged.shareUrl).pathname;
    // A disabled video's poster is no one's but its creator's and the admins' (02 §6.2): signed out it is the 404, and
    // the record's PosterThumb, which loads the bare poster route, keeps its fill block.
    const posterPath = `/api/media/posters/${videoId}`;
    const visitorErrors = collectConsoleErrors(visitor, [
      { status: 404, pathname: sharePath },
      { status: 404, pathname: posterPath },
    ]);
    expect((await visitorContext.request.get(posterPath)).status()).toBe(404);
    const gone = await visitor.goto(sharePath);
    expect(gone?.status()).toBe(404);
    await expect(
      visitor.getByRole("heading", {
        level: 1,
        name: LICENSE_PAGE_COPY.unavailable,
      }),
    ).toBeVisible();

    await visitor.goto(waiting.statusUrl);
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
      REQUEST_STATUS_COPY.declinedTitle,
    );
    await expect(
      visitor.getByText(REQUEST_STATUS_COPY.videoDisabledBody, {
        exact: true,
      }),
    ).toBeVisible();

    // Licenses already sold don't change: the record is its snapshot's.
    const record = await visitor.goto(licensePath(license.token));
    expect(record?.status()).toBe(200);
    const posting = visitor
      .locator("[data-posting-row]")
      .filter({ hasText: DEMO_ACCOUNT });
    await expect(posting).toHaveCount(1);
    await expect(posting).toContainText(DEMO);
    await expect(
      posting.getByText(POSTINGS_COPY.verified, { exact: true }),
    ).toBeVisible();
    await visitorContext.close();
    expect(visitorErrors).toEqual([]);
  });

  await test.step("the creator sees the Banner with the reason and never the note", async () => {
    await creator.goto(videoHref(videoId));
    const sections = videoPage(creator).locator("[data-video-sections]");
    await expect(
      sections.getByText(disabledLine("other"), { exact: true }),
    ).toBeVisible();
    await expect(
      creator.getByRole("button", { name: VIDEO_PAGE_COPY.turnOn }),
    ).toHaveCount(0);
    expect(await creator.content()).not.toContain(note);
  });

  await test.step("Enable: back to Off", async () => {
    await openTab(page, "videos");
    await pressLocator(
      videoRow.getByRole("button", {
        name: ENABLE_COPY.actionLabel(title),
        exact: true,
      }),
    );
    const sheet = page.getByRole("alertdialog", {
      name: ENABLE_COPY.title(title),
      exact: true,
    });
    await expectSheetForm(sheet, viewportWidth(page));
    await expect(sheet).toHaveAccessibleDescription(ENABLE_COPY.body);
    await pressAndSettleIn(page, sheet, ENABLE_COPY.confirm);
    await expect(toast(page, ENABLE_COPY.toast)).toBeVisible();
    await expect(sheet).toHaveCount(0);
    await expect(videoRow.getByText("Off", { exact: true })).toBeVisible();
    await expect(
      videoRow.getByRole("button", {
        name: DISABLE_COPY.actionLabel(title),
        exact: true,
      }),
    ).toBeVisible();
    await expect(videoRow).not.toContainText(note);
    await expectVideoEvents(page, videoId, admin, ["video.enabled"]);
  });

  await test.step("the creator: «Off», Check again on the released source row, the tick again, Turn on", async () => {
    await creator.goto(videoHref(videoId));
    await expect(statusPill(creator, "Off")).toBeVisible();
    await expect(
      videoPage(creator).getByText(VIDEO_PAGE_COPY.off, { exact: true }),
    ).toBeVisible();
    await pressLink(creator, editRowLabel(REVIEW_COPY.wherePosted));
    await creator.waitForURL(videoStepHref(videoId, "postings"));
    const source = sourceRow(creator);
    await expect(source).toHaveCount(1);
    await expect(
      source.getByText(POSTINGS_COPY.notVerified, { exact: true }),
    ).toBeVisible();
    await expect(
      source.getByText(RELEASED.text, { exact: true }),
    ).toBeVisible();
    if (RELEASED.action === null) throw new Error("released: no action");
    const checkAgain = postingActionLabel(RELEASED.action, DEMO);

    // Past the 30 s cooldown without waiting it out: Check again asks the platform.
    await ageCheckedAt(videoId);
    await pressAndSettleIn(creator, source, checkAgain);
    await expect(
      source.getByText(sourceRowTitle(DEMO_ACCOUNT, DEMO), { exact: true }),
    ).toBeVisible();
    await expect(
      source.getByText(POSTINGS_COPY.verified, { exact: true }),
    ).toBeVisible();
    await expect(
      source.getByText(`· ${POSTINGS_COPY.fromLibrary}`, { exact: true }),
    ).toBeVisible();
    await expect(source.getByRole("button", { name: checkAgain })).toHaveCount(
      0,
    );

    // Verified again, the same-video tick is asked for again (07 D69); Continue goes back to the video's page.
    const tick = sameVideoTick(creator);
    await expect(tick).not.toBeChecked();
    await tick.focus();
    await tick.press("Space");
    await expect(tick).toBeChecked();
    await pressButton(creator, "Continue");
    await creator.waitForURL(videoHref(videoId));
    await pressAndSettle(creator, VIDEO_PAGE_COPY.turnOn);
    await expect(statusPill(creator, "Live")).toBeVisible();
  });

  await test.step("the admin's Videos row reads Live", async () => {
    await openTab(page, "videos");
    await expect(videoRow.getByText("Live", { exact: true })).toBeVisible();
    await expect(videoRow).toContainText(ADMIN_COPY.verifiedOn(DEMO));
  });

  // A.5's licenses, arranged after the last Videos-row lookup and just before the sweep, so other specs' licenses can't
  // push the valid one out of the newest 50 before the sweep's Licenses tab. The A.5 steps run at the project's own width.
  const projectWidth = viewportWidth(page);
  const licenses = adminRows(page, ADMIN_TAB_LABELS.licenses);
  const { revoked, valid } =
    await test.step("arrange A.5: two more approved licenses, each Licenses row reading its transfer sent", async () => {
      const licensee = (name: string) => ({
        ...ORGANIC_30_WORLDWIDE,
        licensee: name,
      });
      const shareUrl = arranged.shareUrl;
      const arrangedLicenses = {
        revoked: await withAmounts(
          await licenseVideo(
            creator,
            browser,
            shareUrl,
            licensee(REVOKED_LICENSEE),
          ),
        ),
        valid: await withAmounts(
          await licenseVideo(
            creator,
            browser,
            shareUrl,
            licensee(VALID_LICENSEE),
          ),
        ),
      };
      // The transfers go after the approvals' responses: a revoke while one is in flight is refused (Q-207), and one
      // before it is sent cancels the payout instead of taking it back. Each sent in the test database, then the tab.
      for (const l of Object.values(arrangedLicenses)) {
        await expect
          .poll(
            async () =>
              (await storedMovement(l.requestId, "creator_transfer")).status,
            { timeout: 60_000 },
          )
          .toBe("succeeded");
      }
      await openTab(page, "licenses");
      for (const l of Object.values(arrangedLicenses)) {
        await expect(
          moneyValue(licenses.filter({ hasText: l.code }), projectWidth),
        ).toHaveText(l.sent);
      }
      return arrangedLicenses;
    });
  const revokedRow = licenses.filter({ hasText: revoked.code });
  const refundedMoney = [
    MONEY_COPY.refunded(revoked.total),
    MONEY_COPY.takenBack(revoked.price),
  ].join(MONEY_COPY.separator);

  await test.step("A.5: Revoke asks first with the stored amounts, switches for Payment reversed, and Issued in error revokes", async () => {
    const trigger = revokedRow.getByRole("button", {
      name: REVOKE_COPY.actionLabel(revoked.code),
      exact: true,
    });
    await pressLocator(trigger);
    const sheet = page.getByRole("alertdialog", {
      name: REVOKE_COPY.title(revoked.code),
      exact: true,
    });
    await expectSheetForm(sheet, projectWidth);
    const takeBack = REVOKE_COPY.takeBackBody(
      revoked.total,
      revoked.price,
      handle,
    );
    await expect(sheet).toHaveAccessibleDescription(takeBack);
    await expect(
      sheet.getByRole("button", { name: REVOKE_COPY.cancel, exact: true }),
    ).toBeFocused();
    const confirm = (name: string) =>
      sheet.getByRole("button", { name, exact: true });
    await expect(confirm(REVOKE_COPY.confirm)).toBeVisible();

    const reason = sheet.getByRole("combobox", {
      name: DISABLE_COPY.reason,
      exact: true,
    });
    await reason.selectOption("payment_reversed");
    await expect(sheet).toHaveAccessibleDescription(
      REVOKE_COPY.paymentReversedBody,
    );
    await expect(confirm(REVOKE_COPY.confirmNoRefund)).toBeVisible();
    await expect(confirm(REVOKE_COPY.confirm)).toHaveCount(0);

    await reason.selectOption("issued_in_error");
    await expect(sheet).toHaveAccessibleDescription(takeBack);
    await pressAndSettleIn(page, sheet, REVOKE_COPY.confirm);
    await expect(toast(page, REVOKE_COPY.toast)).toBeVisible();
    await expect(sheet).toHaveCount(0);
    // The refreshed row has no Revoke: the focus lands on its code.
    await expect(trigger).toHaveCount(0);
    await expect(rowAnchor(revokedRow)).toBeFocused();
  });

  await test.step("A.6: Events lists license.revoked for that license, by the admin, with its reason and code", async () => {
    await openTab(page, "events");
    const rows = adminRows(page, ADMIN_COPY.latestEventsHeading)
      .filter({ hasText: revoked.code })
      .filter({ has: page.getByText("license.revoked", { exact: true }) });
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(
      auditActorLabel({
        actorType: "admin",
        actorEmail: admin,
        actorSource: null,
      }),
    );
    await expect(rows).toContainText("issued_in_error");
  });

  await test.step("A.5: the Money cell reads the refund and the take-back once both went through", async () => {
    // Both go after the revoke's response: each done in the test database, then the tab.
    for (const kind of ["buyer_refund", "transfer_reversal"] as const) {
      await expect
        .poll(
          async () => (await storedMovement(revoked.requestId, kind)).status,
          {
            timeout: 60_000,
          },
        )
        .toBe("succeeded");
    }
    await openTab(page, "licenses");
    await expect(moneyValue(revokedRow, projectWidth)).toHaveText(
      refundedMoney,
    );
    await expect(
      revokedRow.getByRole("button", {
        name: REVOKE_COPY.actionLabel(revoked.code),
        exact: true,
      }),
    ).toHaveCount(0);
  });

  await test.step("J10.3, J9.6: /verify reads Revoked with no amount; /l the refund and no download, both routes 404", async () => {
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const visitorErrors = collectConsoleErrors(visitor);
    await visitor.goto(verifyPath(revoked.code));
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
      LICENSE_RECORD_COPY.verify.heading.revoked,
    );
    const record = await visitor.locator("body").innerText();
    expect(record).not.toMatch(/\$\d/);
    expect(record).not.toMatch(/refund/i);

    const { revokedAt } = await storedLicense(revoked.requestId);
    if (revokedAt === null) throw new Error("A.5: the license isn't revoked");
    await visitor.goto(licensePath(revoked.token));
    await expect(
      visitor
        .locator("main")
        .getByText(
          LICENSE_RECORD_COPY.buyer.revokedRefunded(
            formatLicenseDate(revokedAt),
            revoked.total,
          ),
          { exact: true },
        ),
    ).toBeVisible();
    await expect(visitor.locator('main a[href^="/api/licenses/"]')).toHaveCount(
      0,
    );
    for (const kind of ["original", "pdf"] as const) {
      const answer = await request.get(
        licenseDownloadPath(revoked.token, kind),
        { maxRedirects: 0 },
      );
      expect(answer.status()).toBe(404);
    }
    await visitorContext.close();
    expect(visitorErrors).toEqual([]);
  });

  await test.step("J9.8: the creator's Licenses reads «Revoked · refunded» and Taken back", async () => {
    await creator.goto("/dashboard/licenses");
    const row = licenseRows(creator).filter({ hasText: revoked.code });
    await expect(row).toHaveCount(1);
    await expect(
      row.getByText(LICENSE_RECORD_COPY.dashboard.revokedRefunded, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      row.getByText(PAYOUT_LINE_COPY.takenBack, { exact: true }),
    ).toBeVisible();
  });

  await test.step("A.8: a failed take-back shows in Events and the Money cell, and Retry runs its next attempt", async () => {
    await forceTakeBackFailed(revoked.requestId);
    const failedOnce = await storedMovement(
      revoked.requestId,
      "transfer_reversal",
    );
    const words = RETRY_COPY.kind.transfer_reversal;
    const retryName = words.actionLabel(revoked.code);

    await openTab(page, "events");
    const movement = adminRows(page, ADMIN_COPY.failedMovementsHeading).filter({
      hasText: revoked.code,
    });
    await expect(movement).toHaveCount(1);
    await expect(movement).toContainText(
      MONEY_MOVEMENT_KIND_LABELS.transfer_reversal,
    );
    await expect(movement).toContainText(revoked.price);
    await expect(
      movement.getByText(MANUAL_TEST_ERROR, { exact: true }),
    ).toBeVisible();
    await expect(
      movement.getByRole("button", { name: retryName, exact: true }),
    ).toBeVisible();

    await openTab(page, "licenses");
    const money = moneyValue(revokedRow, projectWidth);
    await expect(money).toContainText(MONEY_COPY.refunded(revoked.total));
    const failed = money.getByText(MONEY_COPY.takeBackFailed, { exact: true });
    await expect(failed).toBeVisible();
    await expect(failed).toHaveClass(/\btext-danger-text\b/);
    await pressLocator(
      money.getByRole("button", { name: retryName, exact: true }),
    );
    const sheet = page.getByRole("alertdialog", {
      name: words.title,
      exact: true,
    });
    await expectSheetForm(sheet, projectWidth);
    await expect(sheet).toHaveAccessibleDescription(
      words.body(revoked.price, handle),
    );
    await pressAndSettleIn(page, sheet, RETRY_COPY.confirm);
    await expect(toast(page, RETRY_COPY.toast)).toBeVisible();
    await expect(sheet).toHaveCount(0);
    await expect(money).toHaveText(refundedMoney);
    // The take-back went through and took its Retry away: the focus lands on the row's code.
    await expect(rowAnchor(revokedRow)).toBeFocused();
    expect(
      await storedMovement(revoked.requestId, "transfer_reversal"),
    ).toEqual({
      status: "succeeded",
      attempt: failedOnce.attempt + 1,
      lastError: null,
    });
  });

  // After the last Videos-row lookup: the sweep is long, and other specs' publishes meanwhile could push this run's video
  // out of the newest 50. A bare dollar is read once per form, in light: the stacked rows at 375, the table at 1280, or
  // the project's own width where the sweep doesn't resize. Licenses' valid row opens its Revoke sheet once per width, in
  // light, and revokes nothing.
  const dollarWidths = new Set([375, 1280, projectWidth]);
  for (const tab of ADMIN_TABS) {
    await test.step(`G.6: ?tab=${tab} at every width`, async () => {
      await openTab(page, tab);
      await expectTabLinks(page, tab);
      // Once loaded, the current segment is scrolled into its row's view (the iPhone's row scrolls).
      const nav = tabRow(page);
      const current = nav.locator('[aria-current="page"]');
      await expect
        .poll(async () => {
          const [segment, row] = await Promise.all([
            boxOf(current),
            boxOf(nav),
          ]);
          return segment.left >= row.left - 1 && segment.right <= row.right + 1;
        })
        .toBe(true);
      await atEveryWidth(page, testInfo, async ({ width, theme }) => {
        await expectPageFrame(page, width, { banner: true });
        await expectTabRow(page, width);
        await expectTableForm(page, tab, width);
        if (tab === "licenses") {
          await expectLicenseRowAt(page, valid, width, theme === "light");
        }
        if (theme === "light" && dollarWidths.has(width)) {
          await expectNoBareDollar(page);
        }
        expect(errors).toEqual([]);
      });
    });
  }

  // The admin shell keeps the sign-in alive too. Last: it installs the page's clock two days ahead.
  await test.step("the admin shell asks for the session refresh once it is due", async () => {
    await expectRefreshWhenDue(page, "/admin");
  });
  await creatorContext.close();
  expect(creatorErrors).toEqual([]);
  expect(errors).toEqual([]);
});
