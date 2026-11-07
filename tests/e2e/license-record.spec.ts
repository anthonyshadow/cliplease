import { randomBytes } from "node:crypto";
import { type APIResponse, expect, type Page, test } from "@playwright/test";
import { APP_NAME } from "../../src/lib/app-name";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import {
  LICENSE_RECORD_COPY,
  verifyTitle,
} from "../../src/lib/licensing/license-record";
import { USE_OPTIONS } from "../../src/lib/licensing/options";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import {
  licenseDownloadPath,
  licensePath,
  verifyPath,
} from "../../src/lib/urls";
import { E2E_LICENSEE } from "./helpers/buyer";
import { collectConsoleErrors, visit } from "./helpers/console";
import { licenseVideo, publishDemoVideo } from "./helpers/flows";
import {
  downloadCount,
  fact,
  forceLicenseExclusive,
  forceLicenseExpired,
  forceLicenseRevoked,
  LICENSE_DATE,
  licenseRows,
  ORGANIC_30_WORLDWIDE,
  REVOKED_NOTE,
} from "./helpers/licenses";
import { cleanCreatedVideos } from "./helpers/videos";

// A license's record in each state and its HTTP contract (P20; 01 J9.4, J9.6, J9.8, J9.9, J10.1–J10.5, G.4; 04 §10.2;
// 05 §4.4, §4.5, §6.10; 07 D16, D61, D101, D113; owner answers Q-184–Q-186, Q-188) on chromium-desktop and
// webkit-iphone, against the production build. The first test approves three licenses on one Demo video, then the
// guarded test-database helpers revoke one, end one and make one exclusive (Q-188): revoked, /l says when and that it
// allows no use, with no download, and /verify says Revoked with no reason or admin note; expired, /l keeps only the PDF
// (the primary) and /verify reads Expired with /l's end date; exclusive, /l and /verify read "Exclusive until {end}" and
// /verify the 07 D113 sentence with that date, and /dashboard/licenses tags only that row «Exclusive». The second test
// checks the answers themselves with Playwright's request: /l and /api/licenses send no-referrer and noindex, a key that
// opens nothing is the "Buyer link dead" 404, the /l HTML holds no storage key or signed URL, HEAD is a 405 that logs no
// download while each GET logs one, a failed download's ?download=failed lands on its line, once; /verify sends no-store
// and noindex, redirects any other spelling of a code with a 308, and answers 404 with the code for an unknown canonical
// code and the malformed line, never the input, for anything else.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const COPY = LICENSE_RECORD_COPY;
const BUYER = COPY.buyer;
const NOINDEX = "noindex, nofollow";
const REVOKED_LICENSEE = "Northwind Brands Inc.";
const EXPIRED_LICENSEE = "Fabrikam Studio LLC";

/** /l's download links: plain links to the two routes (owner answer Q-185). */
const downloadLinks = (page: Page) =>
  page.locator('main a[href^="/api/licenses/"]');

/** The part of `text` `pattern`'s first group takes, or a throw naming what was read. */
function captured(pattern: RegExp, text: string | null): string {
  const value = pattern.exec(text ?? "")?.[1];
  if (!value) throw new Error(`no match for ${pattern} in ${text}`);
  return value;
}

/** A buyer-token page's or route's headers (07 D61; 02 §9.5): no referrer leaves it, and nothing indexes it. */
function expectBuyerTokenHeaders(response: APIResponse) {
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["x-robots-tag"]).toBe(NOINDEX);
}

/** What a download route answers besides its body: never cached (07 D61), plus the buyer-token headers. */
function expectDownloadHeaders(response: APIResponse) {
  expectBuyerTokenHeaders(response);
  expect(response.headers()["cache-control"]).toContain("no-store");
}

test("J9.6, J10.1, J10.3, 07 D113: a revoked license allows no download and /verify gives no reason, an expired one keeps only the PDF, an exclusive one reads Exclusive until its end on /l, /verify and Licenses", async ({
  page,
  browser,
  baseURL,
  request,
}) => {
  test.setTimeout(480_000);
  const { shareUrl } = await publishDemoVideo(page);
  const revoked = await licenseVideo(page, browser, shareUrl, {
    ...ORGANIC_30_WORLDWIDE,
    licensee: REVOKED_LICENSEE,
  });
  const expired = await licenseVideo(page, browser, shareUrl, {
    ...ORGANIC_30_WORLDWIDE,
    licensee: EXPIRED_LICENSEE,
  });
  const exclusive = await licenseVideo(
    page,
    browser,
    shareUrl,
    ORGANIC_30_WORLDWIDE,
  );
  await forceLicenseRevoked(revoked.requestId);
  await forceLicenseExpired(expired.requestId);
  await forceLicenseExclusive(exclusive.requestId);

  const context = await browser.newContext({ baseURL });
  const visitor = await context.newPage();
  const errors = collectConsoleErrors(visitor);
  const main = visitor.locator("main");
  const heading = visitor.getByRole("heading", { level: 1 });
  const card = main.locator("section").first();
  const status = fact(card, BUYER.facts.status);

  // Revoked /l (05 §4.4 callout 12; Q-186): the date in UTC and the line, no download; both routes 404 (01 J9.6).
  await visitor.goto(licensePath(revoked.token));
  await expect(status).toHaveText(COPY.status.revoked);
  const revokedLine = main.getByText(
    new RegExp(`^Revoked on ${LICENSE_DATE}\\.$`),
  );
  await expect(revokedLine).toBeVisible();
  const revokedOn = captured(
    /^Revoked on (.+)\.$/,
    await revokedLine.textContent(),
  );
  await expect(main.getByText(BUYER.revoked, { exact: true })).toBeVisible();
  await expect(downloadLinks(visitor)).toHaveCount(0);
  for (const kind of ["original", "pdf"] as const) {
    const answer = await request.get(licenseDownloadPath(revoked.token, kind), {
      maxRedirects: 0,
    });
    expect(answer.status()).toBe(404);
  }

  // Revoked /verify (01 J10.2, J10.3): the heading, when, and no reason or note.
  await visitor.goto(verifyPath(revoked.code));
  await expect(heading).toHaveText(COPY.verify.heading.revoked);
  await expect(visitor).toHaveTitle(
    `${verifyTitle("revoked", revoked.code)} · ${APP_NAME}`,
  );
  await expect(main).toContainText(COPY.verify.revoked(revokedOn));
  const revokedRecord = await visitor.locator("body").innerText();
  expect(revokedRecord).not.toContain(REVOKED_NOTE);
  expect(revokedRecord).not.toMatch(/payment[ _]reversed/i);

  // Expired /l (07 D16): Expired, only the PDF, now the primary; the original route 404s and the PDF still answers.
  await visitor.goto(licensePath(expired.token));
  await expect(status).toHaveText(COPY.status.expired);
  await expect(main.getByText(BUYER.expired, { exact: true })).toBeVisible();
  const links = downloadLinks(visitor);
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute(
    "href",
    licenseDownloadPath(expired.token, "pdf"),
  );
  await expect(links).toHaveAccessibleName(BUYER.downloadPdf);
  await expect(links).toHaveAttribute("data-variant", "primary");
  const term = await fact(card, BUYER.facts.term).textContent();
  const endedOn = captured(
    new RegExp(`^30 days · ${LICENSE_DATE} to (${LICENSE_DATE})$`),
    term,
  );
  const expiredOriginal = await request.get(
    licenseDownloadPath(expired.token, "original"),
    { maxRedirects: 0 },
  );
  expect(expiredOriginal.status()).toBe(404);
  const expiredPdf = await request.get(
    licenseDownloadPath(expired.token, "pdf"),
  );
  expect(expiredPdf.status()).toBe(200);
  expect(expiredPdf.headers()["content-type"]).toBe("application/pdf");

  // Expired /verify: the heading and the end /l printed.
  await visitor.goto(verifyPath(expired.code));
  await expect(heading).toHaveText(COPY.verify.heading.expired);
  await expect(visitor).toHaveTitle(
    `${verifyTitle("expired", expired.code)} · ${APP_NAME}`,
  );
  await expect(main).toContainText(COPY.verify.ended(endedOn));

  // Exclusive /l (07 D113): the Rights row from the snapshot, still Valid with both downloads.
  await visitor.goto(licensePath(exclusive.token));
  await expect(status).toHaveText(COPY.status.valid);
  const rights = fact(card, COPY.rights.label);
  await expect(rights).toHaveText(
    new RegExp(`^Exclusive until ${LICENSE_DATE}$`),
  );
  const until = captured(/^Exclusive until (.+)$/, await rights.textContent());
  await expect(downloadLinks(visitor)).toHaveCount(2);

  // Exclusive /verify: the same row, the D113 sentence with that date, and still no amount.
  await visitor.goto(verifyPath(exclusive.code));
  await expect(heading).toHaveText(COPY.verify.heading.valid);
  await expect(fact(main, COPY.rights.label)).toHaveText(
    COPY.rights.exclusiveUntil(until),
  );
  await expect(main).toContainText(
    COPY.verify.activeExclusive(
      E2E_LICENSEE,
      USE_OPTIONS.organic_social.label,
      "any country",
      until,
    ),
  );
  expect(await visitor.locator("body").innerText()).not.toMatch(
    /CA\$|Canadian dollars/,
  );
  await context.close();
  expect(errors).toEqual([]);

  // The creator's Licenses (01 J9.8): each row's computed status, «Exclusive» on the exclusive row only.
  const creatorErrors = collectConsoleErrors(page);
  await page.goto("/dashboard/licenses");
  const rows = licenseRows(page);
  await expect(rows).toHaveCount(3);
  const rowOf = (licensee: string) => rows.filter({ hasText: licensee });
  const expectRow = async (
    licensee: string,
    pill: string,
    exclusiveTags: number,
  ) => {
    const row = rowOf(licensee);
    await expect(row.getByText(pill, { exact: true })).toBeVisible();
    await expect(
      row.getByText(INBOX_COPY.exclusiveTag, { exact: true }),
    ).toHaveCount(exclusiveTags);
  };
  await expectRow(REVOKED_LICENSEE, COPY.status.revoked, 0);
  await expectRow(EXPIRED_LICENSEE, COPY.status.expired, 0);
  await expectRow(E2E_LICENSEE, COPY.status.valid, 1);
  expect(creatorErrors).toEqual([]);
});

test("J9.9, J10.3–J10.5, G.4, owner answers Q-184, Q-185: /l and /api/licenses send no-referrer and noindex and log one download per GET and none per HEAD; /verify sends no-store, 308s other spellings and 404s unknown and malformed codes with their own line", async ({
  page,
  browser,
  baseURL,
  request,
}) => {
  test.setTimeout(300_000);
  const { shareUrl } = await publishDemoVideo(page);
  const { requestId, token, code } = await licenseVideo(
    page,
    browser,
    shareUrl,
    ORGANIC_30_WORLDWIDE,
  );
  const unknownKey = randomBytes(32).toString("base64url");

  // /l (G.4; 07 D61): the buyer-token headers, and nothing in the HTML that opens the original.
  const page200 = await request.get(licensePath(token));
  expect(page200.status()).toBe(200);
  expectBuyerTokenHeaders(page200);
  const html = await page200.text();
  expect(html).toContain(code);
  expect(html).not.toContain("originals/");
  expect(html).not.toContain("/api/dev/storage/");
  for (const path of [licensePath(unknownKey), "/l/not-a-key"]) {
    const dead = await request.get(path);
    expect(dead.status()).toBe(404);
    expectBuyerTokenHeaders(dead);
  }

  // The routes: HEAD is a 405 that runs nothing (Next would answer it with GET); each GET logs one row (01 J9.5).
  expect(await downloadCount(requestId)).toBe(0);
  for (const kind of ["original", "pdf"] as const) {
    const head = await request.head(licenseDownloadPath(token, kind));
    expect(head.status()).toBe(405);
    expect(head.headers().allow).toBe("GET");
    expectDownloadHeaders(head);
  }
  expect(await downloadCount(requestId)).toBe(0);
  const original = await request.get(licenseDownloadPath(token, "original"), {
    maxRedirects: 0,
  });
  expect(original.status()).toBe(302);
  expectDownloadHeaders(original);
  expect(original.headers().location).toBeTruthy();
  const pdf = await request.get(licenseDownloadPath(token, "pdf"));
  expect(pdf.status()).toBe(200);
  expectDownloadHeaders(pdf);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdf.headers()["content-disposition"]).toContain(
    `${APP_NAME}-${code}-license.pdf`,
  );
  expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(await downloadCount(requestId)).toBe(2);
  for (const kind of ["original", "pdf"] as const) {
    const unknown = await request.get(licenseDownloadPath(unknownKey, kind), {
      maxRedirects: 0,
    });
    expect(unknown.status()).toBe(404);
    expectDownloadHeaders(unknown);
  }

  // /verify (01 J10.4, J10.5): no-store and noindex on the record; other spellings are a 308 to the canonical path.
  const record = await request.get(verifyPath(code));
  expect(record.status()).toBe(200);
  expect(record.headers()["cache-control"]).toContain("no-store");
  expect(record.headers()["x-robots-tag"]).toBe(NOINDEX);
  for (const spelling of [
    code.toLowerCase(),
    code.toLowerCase().replaceAll("-", ""),
  ]) {
    const moved = await request.get(verifyPath(spelling), { maxRedirects: 0 });
    expect(moved.status()).toBe(308);
    expect(moved.headers().location).toMatch(
      new RegExp(`${verifyPath(code)}$`),
    );
    expect(moved.headers()["x-robots-tag"]).toBe(NOINDEX);
  }
  for (const path of [
    verifyPath("CL-0000-0000"),
    verifyPath("CLR-7K3M-9QXA"),
  ]) {
    const missing = await request.get(path);
    expect(missing.status()).toBe(404);
    expect(missing.headers()["x-robots-tag"]).toBe(NOINDEX);
  }

  // The pages, logged out: the dead link's copy, the failed download's line, the record's 404s (Q-184).
  const context = await browser.newContext({ baseURL });
  const visitor = await context.newPage();
  const heading = visitor.getByRole("heading", { level: 1 });
  const main = visitor.locator("main");
  const deadErrors = await visit(visitor, licensePath(unknownKey), 404);
  await expect(heading).toHaveText(REQUEST_STATUS_COPY.deadLink);
  expect(deadErrors).toEqual([]);

  // The failed download's line is where the page lands, and its query is a one-shot: a reload shows no line (Q-185).
  const failedErrors = await visit(
    visitor,
    `${licensePath(token)}?download=failed`,
  );
  const failedLine = main.getByText(BUYER.downloadFailed);
  await expect(failedLine).toBeFocused();
  await expect(failedLine).toBeInViewport();
  await expect(visitor).toHaveURL(new RegExp(`${licensePath(token)}$`));
  await visitor.reload();
  await expect(heading).toBeVisible();
  await expect(failedLine).toHaveCount(0);
  expect(failedErrors).toEqual([]);

  const unknownErrors = await visit(visitor, verifyPath("CL-0000-0000"), 404);
  await expect(heading).toHaveText(COPY.verify.notFoundHeading);
  await expect(visitor).toHaveTitle(
    `${COPY.verify.notFoundHeading} · ${APP_NAME}`,
  );
  await expect(main).toContainText(COPY.verify.notFound("CL-0000-0000"));
  expect(unknownErrors).toEqual([]);

  const malformedErrors = await visit(
    visitor,
    verifyPath("CLR-7K3M-9QXA"),
    404,
  );
  await expect(heading).toHaveText(COPY.verify.notFoundHeading);
  await expect(main).toContainText(COPY.verify.malformed);
  expect(await main.innerText()).not.toContain("CLR-7K3M-9QXA");
  expect(malformedErrors).toEqual([]);

  const validErrors = await visit(visitor, verifyPath(code));
  await expect(heading).toHaveText(COPY.verify.heading.valid);
  await expect(visitor).toHaveTitle(
    `${verifyTitle("valid", code)} · ${APP_NAME}`,
  );
  await context.close();
  expect(validErrors).toEqual([]);
});
