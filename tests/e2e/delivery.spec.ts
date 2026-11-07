import { stat } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import { LICENSE_RECORD_COPY } from "../../src/lib/licensing/license-record";
import { USE_OPTIONS } from "../../src/lib/licensing/options";
import { PAYOUT_LINE_COPY } from "../../src/lib/licensing/payout-line";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import {
  licenseDownloadPath,
  licensePath,
  verifyPath,
} from "../../src/lib/urls";
import { BARE_DOLLAR } from "../helpers/money";
import { readLatestEmail } from "../helpers/read-latest-email";
import { E2E_LICENSEE } from "./helpers/buyer";
import { collectConsoleErrors } from "./helpers/console";
import {
  buyerKey,
  buyLicense,
  LICENSE_CODE,
  publishDemoVideo,
} from "./helpers/flows";
import { expectNoBareDollar } from "./helpers/layout";
import {
  fact,
  LICENSE_DATE,
  licenseRows,
  ORGANIC_30_WORLDWIDE,
} from "./helpers/licenses";
import { pressAndSettleIn, pressLocator } from "./helpers/press";
import { cleanCreatedVideos, SAMPLE_MP4 } from "./helpers/videos";

// The buyer's delivery and the public record (P20; 01 J9.3–J9.5, J10.1, J10.2; 04 §10.2; 05 §4.3, §4.4, §4.5, §6.10;
// 07 D16, D61, D98; owner answers Q-141 a, Q-185) on chromium-desktop and webkit-iphone: a creator publishes Demo post
// 01, a logged-out buyer at 390 × 844 pays for Organic social repost · 30 days · Worldwide on the fake checkout, and the
// creator taps Approve once in the Inbox: "View license" follows the issued line, and the toast's View license opens
// /dashboard/licenses, the row Valid with no download count yet. The buyer opens /l from license-approved: "Cleared. Yours to post." takes the
// focus (a license issued in the last 24 h), the card says Valid and Non-exclusive with the CA$ total. Download original
// (a plain link, "Preparing…" while pressed) saves `ClipLease-CL-XXXX-XXXX-original.mp4` with the sample's bytes, and
// Download license PDF answers application/pdf (Chromium downloads it, WebKit opens it in place). History's View
// license brings the creator back to /dashboard/licenses, which reads "Downloaded 2 times" (one row per tap; only the
// visible form of the list, both are in the DOM) with the payout line and View public record; /verify/{code} reads Valid license with the sentence /l's dates give and no amount,
// currency, email or contact name; /r approved offers Get file and license to the same /l.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const ORIGINAL_NAME = new RegExp(
  `^ClipLease-${LICENSE_CODE.source}-original\\.mp4$`,
);
const BUYER = LICENSE_RECORD_COPY.buyer;
const LICENSES = "/dashboard/licenses";

test("J9.3–J9.5, J10.1, J10.2: the buyer opens /l from the email, downloads the original and the PDF once each, the creator's Licenses says Downloaded 2 times, and /verify reads Valid license with no amount", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const { shareUrl } = await publishDemoVideo(page);
  const creatorErrors = collectConsoleErrors(page);

  // The buyer pays and waits; off /r before its first 30 s refresh, which WebKit would cancel mid-goto.
  const since = Date.now();
  const { statusUrl, context, email } = await buyLicense(
    browser,
    shareUrl,
    ORGANIC_30_WORLDWIDE,
  );
  const [buyer] = context.pages();
  if (!buyer) throw new Error("no buyer page");
  await buyer.goto("about:blank");
  const buyerErrors = collectConsoleErrors(buyer);
  const token = buyerKey(statusUrl);

  // One tap on the Inbox row (01 J8.2); View license after its issued line and in the toast (04 §10.3, §11.5).
  await page.goto("/dashboard");
  const inboxRow = page.locator("[data-inbox-row]");
  await expect(inboxRow).toHaveCount(1);
  await pressAndSettleIn(page, inboxRow, INBOX_COPY.approve);
  const issued = inboxRow.getByText(/^License CL-.+ issued$/);
  await expect(issued).toBeVisible();
  const code = LICENSE_CODE.exec((await issued.textContent()) ?? "")?.[0];
  if (!code) throw new Error("no license code on the row");
  await expect(
    inboxRow.getByRole("link", { name: INBOX_COPY.viewLicense, exact: true }),
  ).toHaveAttribute("href", LICENSES);
  await pressLocator(
    page
      .locator("ol > li")
      .getByRole("button", { name: INBOX_COPY.viewLicense, exact: true }),
  );
  await expect(page).toHaveURL(new RegExp(`${LICENSES}$`));
  const row = licenseRows(page);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(code);
  await expect(
    row.getByText(LICENSE_RECORD_COPY.status.valid, { exact: true }),
  ).toBeVisible();
  await expect(row).not.toContainText("Downloaded");
  await page.goto("about:blank");

  // license-approved links /l with the buyer's key (01 J9.3).
  const approved = await readLatestEmail({
    to: email,
    template: "license-approved",
    since,
  });
  const link = /\/l\/[A-Za-z0-9_-]{43}/.exec(approved.text)?.[0];
  expect(link).toBe(licensePath(token));
  expect(approved.text).toContain(verifyPath(code));

  // /l (05 §4.4 Fresh): the headline takes the focus; the card is the snapshot's, Valid and Non-exclusive.
  const opened = await buyer.goto(link ?? "");
  expect(opened?.status()).toBe(200);
  const main = buyer.locator("main");
  const headline = buyer.getByRole("heading", { level: 1 });
  await expect(headline).toHaveText(
    `${BUYER.headline.lead} ${BUYER.headline.rest}`,
  );
  await expect(headline).toBeFocused();
  const card = main.locator("section").first();
  await expect(fact(card, BUYER.facts.license)).toContainText(code);
  await expect(fact(card, BUYER.facts.status)).toHaveText(
    LICENSE_RECORD_COPY.status.valid,
  );
  await expect(fact(card, BUYER.facts.use)).toHaveText(
    USE_OPTIONS.organic_social.label,
  );
  await expect(fact(card, LICENSE_RECORD_COPY.rights.label)).toHaveText(
    LICENSE_RECORD_COPY.rights.nonExclusive,
  );
  await expect(fact(card, BUYER.facts.licensedTo)).toHaveText(E2E_LICENSEE);
  await expect(fact(card, BUYER.facts.paid)).toHaveText(/^CA\$\d/);
  await expect(
    card.getByText("Amounts in Canadian dollars (CAD).", { exact: true }),
  ).toBeVisible();
  const term = (await fact(card, BUYER.facts.term).textContent()) ?? "";
  const end = new RegExp(
    `^30 days · ${LICENSE_DATE} to (${LICENSE_DATE})$`,
  ).exec(term)?.[1];
  if (!end) throw new Error(`unexpected Term: ${term}`);
  await expectNoBareDollar(buyer);

  // Download original: a plain link to the route (Q-185), "Preparing…" while pressed, the file as the sample's bytes.
  const original = main.locator(
    `a[href="${licenseDownloadPath(token, "original")}"]`,
  );
  await expect(original).toHaveAccessibleName(/^Download original · MP4 · \d/);
  const download = buyer.waitForEvent("download");
  await pressLocator(original);
  await expect(original).toHaveAttribute("aria-busy", "true");
  await expect(original).toHaveAccessibleName(BUYER.preparing);
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(ORIGINAL_NAME);
  const file = await saved.path();
  expect((await stat(file)).size).toBe((await stat(SAMPLE_MP4)).size);

  // Download license PDF: the route answers the PDF itself.
  const pdfPath = licenseDownloadPath(token, "pdf");
  const pdf = main.locator(`a[href="${pdfPath}"]`);
  await expect(pdf).toHaveAccessibleName(BUYER.downloadPdf);
  const pdfAnswer = buyer.waitForResponse(
    (response) => new URL(response.url()).pathname === pdfPath,
  );
  await pressLocator(pdf);
  const answer = await pdfAnswer;
  expect(answer.status()).toBe(200);
  expect(answer.headers()["content-type"]).toBe("application/pdf");

  // The creator's Licenses through History's View license (05 §6.3 callout 12; 01 J9.5, J9.8): one row per tap, the
  // payout line (the transfer runs after the approval's response, so either word), in the form this width shows.
  await page.goto("/dashboard?view=history");
  await pressLocator(
    page
      .locator("[data-inbox-row]")
      .getByRole("link", { name: INBOX_COPY.viewLicense, exact: true }),
  );
  await expect(page).toHaveURL(new RegExp(`${LICENSES}$`));
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(code);
  await expect(row).toContainText(E2E_LICENSEE);
  await expect(
    row.getByText("Downloaded 2 times", { exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText(
      new RegExp(`^(${PAYOUT_LINE_COPY.paidOut}|${PAYOUT_LINE_COPY.pending})$`),
    ),
  ).toBeVisible();
  await expect(
    row.getByRole("link", {
      name: LICENSE_RECORD_COPY.dashboard.viewPublicRecord,
    }),
  ).toHaveAttribute("href", verifyPath(code));
  await expectNoBareDollar(page);

  // /verify, logged out (01 J10.1, J10.2): Valid license, the §6.4 sentence with /l's end date, no amount or contact.
  const verified = await buyer.goto(verifyPath(code));
  expect(verified?.status()).toBe(200);
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
    LICENSE_RECORD_COPY.verify.heading.valid,
  );
  await expect(main).toContainText(
    LICENSE_RECORD_COPY.verify.active(
      E2E_LICENSEE,
      USE_OPTIONS.organic_social.label,
      "any country",
      `until ${end}`,
    ),
  );
  await expect(fact(main, LICENSE_RECORD_COPY.rights.label)).toHaveText(
    LICENSE_RECORD_COPY.rights.nonExclusive,
  );
  const record = await buyer.locator("body").innerText();
  expect(record).not.toMatch(/CA\$|Canadian dollars/);
  expect(record).not.toMatch(BARE_DOLLAR);
  expect(record.toLowerCase()).not.toContain(email.toLowerCase());
  expect(record).not.toContain("Sam Lee");

  // /r approved (05 §4.3 callout 7; Q-141 a): Get file and license opens the same /l.
  await buyer.goto(statusUrl);
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
    REQUEST_STATUS_COPY.approvedTitle,
  );
  await expect(
    buyer.getByRole("link", {
      name: REQUEST_STATUS_COPY.getFileAndLicense,
      exact: true,
    }),
  ).toHaveAttribute("href", licensePath(token));
  await context.close();
  expect(buyerErrors).toEqual([]);
  expect(creatorErrors).toEqual([]);
});
