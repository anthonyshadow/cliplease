import { expect, type Page, test } from "@playwright/test";
import { formatMoney } from "../../src/lib/format";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { readLatestEmail } from "../helpers/read-latest-email";
import { E2E_LICENSEE } from "./helpers/buyer";
import { collectConsoleErrors } from "./helpers/console";
import { buyLicense, publishDemoVideo } from "./helpers/flows";
import { pressLocator } from "./helpers/press";
import { cleanCreatedVideos } from "./helpers/videos";

// The J7 proof (P17; 01 J7.8, J7.17, J8.1, J8.12, J8.13; 05 §4.3, §6.3, §6.4, §8; 07 D47, D84, D98) on chromium-desktop
// and webkit-iphone: a creator publishes Demo post 01, a logged-out buyer pays on the fake checkout (buyLicense), /r
// waits with a neutral countdown, the creator finds the request in the Inbox and on its page, and the outbox has sent
// request-new to the creator and request-received to the buyer, whose link opens the same /r. The buyer's address is on
// no creator page, not even in the data the page carries, and every amount names its currency.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const cad = (cents: number) => formatMoney(cents, "cad");
/** A dollar amount with no currency before it (07 D98): "$1,732.50" but not "CA$1,732.50". */
const BARE_DOLLAR = /(^|[^A-Z])\$\d/;
const SCOPE = "Paid social ads · 1 year · Worldwide";

const mainText = (page: Page) => page.locator("main").innerText();

test("J7.8, J7.17, J8.1, J8.12, J8.13: a paid request waits on /r, reaches the creator's Inbox and request page, and both emails go out", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const since = Date.now();
  const {
    email: creatorEmail,
    handle,
    shareUrl,
  } = await publishDemoVideo(page);

  // Before any request (01 J8.12): all caught up, with Copy link for the live video; History has nothing decided.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${INBOX_COPY.title} ${INBOX_COPY.caughtUp}`,
  );
  await expect(page.getByText(INBOX_COPY.empty)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: INBOX_COPY.makeLicensable }),
  ).toHaveCount(0);
  await page.goto("/dashboard?view=history");
  await expect(
    page.getByRole("link", { name: INBOX_COPY.history }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(INBOX_COPY.historyEmpty)).toBeVisible();

  const bought = await buyLicense(browser, shareUrl, {
    use: "paid_social",
    term: "y1",
    territory: "worldwide",
  });
  const { requestId, context, email: buyerEmail } = bought;

  // Buyer, on /r after Pay: waiting, the hold, a neutral countdown, the summary card, no bare $.
  const [buyer] = context.pages();
  if (!buyer) throw new Error("no buyer page");
  const COPY = REQUEST_STATUS_COPY;
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
    COPY.waitingTitle(handle),
  );
  await expect(buyer.getByText(/^Your card has a hold of /)).toContainText(
    `Your card has a hold of ${cad(173250)}, not a charge.`,
  );
  const countdown = buyer.locator("main time");
  await expect(countdown).toHaveText(/^Expires in \d+ d \d+ h$/);
  await expect(countdown.locator("..")).toHaveClass(/bg-fill/);
  await expect(buyer.getByText(COPY.updatesItself)).toBeVisible();
  const summary = buyer.locator("main section");
  await expect(summary).toContainText(`@${handle}`);
  await expect(summary).toContainText(SCOPE);
  await expect(summary).toContainText(cad(173250));
  expect(await mainText(buyer)).not.toMatch(BARE_DOLLAR);

  // The two emails (05 §8): request-new to the creator, never naming the buyer; request-received to the buyer.
  const toCreator = await readLatestEmail({
    to: creatorEmail,
    template: "request-new",
    since,
  });
  expect(toCreator.subject).toMatch(
    new RegExp(`^New request: ${E2E_LICENSEE} wants to license “.+”$`),
  );
  expect(toCreator.text).toContain(
    `${SCOPE}. You get ${cad(157500)}. Answer by `,
  );
  expect(toCreator.text).toContain(`/dashboard/requests/${requestId}`);
  for (const part of [toCreator.subject, toCreator.text, toCreator.html]) {
    expect(part.toLowerCase()).not.toContain(buyerEmail.toLowerCase());
    expect(part).not.toMatch(BARE_DOLLAR);
  }
  const toBuyer = await readLatestEmail({
    to: buyerEmail,
    template: "request-received",
    since,
  });
  expect(toBuyer.subject).toBe(`Request sent to @${handle}`);
  expect(toBuyer.text).toContain(
    `Your card has a hold of ${cad(173250)}, not a charge. @${handle} has until `,
  );
  expect(toBuyer.text).not.toMatch(BARE_DOLLAR);
  const link = new RegExp(
    `(https?://[^\\s]+/r/${requestId}\\?t=[A-Za-z0-9_-]{43})`,
  ).exec(toBuyer.text)?.[1];
  expect(link).toBeDefined();

  // The email's link opens the same /r.
  const fromEmail = await context.newPage();
  const buyerErrors = collectConsoleErrors(fromEmail);
  await fromEmail.goto(link ?? "");
  await expect(fromEmail.getByRole("heading", { level: 1 })).toHaveText(
    COPY.waitingTitle(handle),
  );
  await expect(fromEmail.locator("main time")).toHaveText(
    /^Expires in \d+ d \d+ h$/,
  );
  await context.close();
  expect(buyerErrors).toEqual([]);

  // Creator: the Inbox lists the request with its countdown and "You get".
  const creatorErrors = collectConsoleErrors(page);
  // Still on History from before the request: a client navigation to Waiting (the layout doesn't re-render) brings
  // the count to the title, the segment and the NavBar or TabBar badge alike.
  await pressLocator(page.getByRole("link", { name: /^Waiting \d+$/ }));
  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${INBOX_COPY.title} ${INBOX_COPY.waitingForYou(1)}`,
  );
  await expect(
    page.locator('a[href="/dashboard"]:visible').filter({ hasText: "Inbox" }),
  ).toContainText("1");
  await expect(
    page.getByRole("link", { name: INBOX_COPY.waitingSegment(1) }),
  ).toHaveAttribute("aria-current", "page");
  const row = page.locator("[data-inbox-row]");
  await expect(row).toHaveCount(1);
  await expect(row.locator("[data-licensee]")).toHaveText(E2E_LICENSEE);
  await expect(row).toContainText(SCOPE);
  await expect(row).toContainText(`You get ${cad(157500)}`);
  await expect(row.locator("time")).toHaveText(/^Expires in \d+ d \d+ h$/);
  expect(await mainText(page)).not.toMatch(BARE_DOLLAR);

  // Details opens the facts; Open request shows them on the request's page.
  await pressLocator(row.getByRole("button", { name: INBOX_COPY.details }));
  await expect(row).toContainText(
    INBOX_COPY.youGetFact(cad(157500), cad(173250)),
  );
  await expect(row).toContainText(INBOX_COPY.paymentFact);
  await pressLocator(row.getByRole("link", { name: INBOX_COPY.openRequest }));
  await page.waitForURL(`/dashboard/requests/${requestId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    new RegExp(`^${E2E_LICENSEE} wants to license .+`),
  );
  const facts = page.locator("main dl");
  await expect(facts).toContainText(E2E_LICENSEE);
  await expect(facts).toContainText("Sam Lee");
  await expect(facts).toContainText(SCOPE);
  await expect(facts).toContainText(
    INBOX_COPY.youGetFact(cad(157500), cad(173250)),
  );
  await expect(facts).toContainText(INBOX_COPY.paymentFact);
  await expect(facts).toContainText(
    /If you don't answer, the hold is released\./,
  );
  expect(await mainText(page)).not.toMatch(BARE_DOLLAR);

  // The buyer's address is nowhere a creator can see: not in the text, nor in the HTML and the data it carries (07 D47).
  for (const path of ["/dashboard", `/dashboard/requests/${requestId}`]) {
    await page.goto(path);
    await expect(
      page.locator("[data-inbox-row], main dl").first(),
    ).toBeVisible();
    expect((await page.content()).toLowerCase()).not.toContain(
      buyerEmail.toLowerCase(),
    );
  }
  expect(creatorErrors).toEqual([]);
});
