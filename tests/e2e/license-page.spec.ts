import { expect, type Page, test } from "@playwright/test";
import { APP_NAME } from "../../src/lib/app-name";
import { formatDelta, formatMoney } from "../../src/lib/format";
import { DETAILS_COPY } from "../../src/lib/licensing/details";
import { LICENSE_PAGE_COPY } from "../../src/lib/licensing/license-page";
import { BADGE_COPY } from "../../src/lib/videos/ownership";
import { OBJECT_KEY } from "../helpers/object-key";
import { collectConsoleErrors } from "./helpers/console";
import { publishDemoVideo } from "./helpers/flows";
import { boxOf } from "./helpers/layout";
import { OWN_DEMO_LINK } from "./helpers/library";
import { trackExternalRequests } from "./helpers/network";
import { pressLocator } from "./helpers/press";
import { cleanCreatedVideos } from "./helpers/videos";

// The license page, J6–J7 part 1 (P15; 05 §4.1; 07 D03, D70, D72, D79, D94, D98) on chromium-desktop and webkit-iphone.
// A creator publishes Demo post 01 (publishDemoVideo; the e2e database has no --demo seed, 07 D53), then a logged-out
// buyer at 390 × 844 opens its link: the poster, the badge, "Where it was posted", the first-load choice and prices,
// Paid social ads · 1 year · Worldwide at the D79 golden, the currency lines, no cookies and no other host; the
// metadata, the 308 for a mixed-case handle and the 404. A music video's Paid social ads and TV / broadcast are off,
// and only a tap (not a key) on One country or One region moves focus into its select (owner answer Q-113 a).
// Radios are chosen with the keyboard (focus, Space): on the iPhone a click near the bottom can land on the fixed bar.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const cad = (cents: number) => formatMoney(cents, "cad");
const REL = "nofollow ugc noopener noreferrer";

const radio = (page: Page, group: string, key: string) =>
  page.locator(`input[name="${group}"][value="${key}"]`);
const tile = (page: Page, group: string, key: string) =>
  page.locator("[data-option-tile]").filter({ has: radio(page, group, key) });

/** Checks a radio from the keyboard. */
async function choose(page: Page, group: string, key: string) {
  const input = radio(page, group, key);
  await input.focus();
  await input.press("Space");
  await expect(input).toBeChecked();
}

/** The page has hydrated: the hidden timeZone is filled after mount. */
const hydrated = (page: Page) =>
  expect(page.locator('input[name="timeZone"]')).not.toHaveValue("");

test("J6.4, J7.1–J7.6, J7.20, J7.21: a logged-out buyer sees the video, who owns it and where it was posted, and the live price", async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  test.setTimeout(240_000);
  const { handle, slug, shareUrl, videoId } = await publishDemoVideo(page);
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const buyer = await context.newPage();
  const missing = `/@${handle}/no-such-video`;
  const errors = collectConsoleErrors(buyer, [
    { status: 404, pathname: missing },
  ]);
  const external = trackExternalRequests(buyer);

  const response = await buyer.goto(shareUrl);
  expect(response?.status()).toBe(200);
  const html = (await response?.text()) ?? "";
  expect(html).not.toMatch(OBJECT_KEY);
  expect(html).not.toMatch(/<iframe|mock:\/\//);
  await hydrated(buyer);

  // The poster, the page's only image, from the poster route; the title and the creator (01 J7; 07 D08).
  const title =
    (await buyer.getByRole("heading", { level: 1 }).textContent()) ?? "";
  expect(title).toMatch(/^He saw snow for the first time/);
  const poster = buyer.locator("img");
  await expect(poster).toHaveCount(1);
  await expect(poster).toHaveAttribute(
    "src",
    new RegExp(`^/api/media/posters/${videoId}\\?v=[0-9a-f]{8}$`),
  );
  await expect(poster).toHaveAttribute(
    "alt",
    LICENSE_PAGE_COPY.posterAlt(title),
  );
  await expect(buyer.locator("iframe")).toHaveCount(0);
  await expect(
    buyer.getByRole("link", { name: `@${handle}`, exact: true }),
  ).toHaveAttribute("href", `/@${handle}`);

  // The badge from the primary verified posting and "Where it was posted" (07 D43, D70, D89).
  await expect(
    buyer.getByText("Verified · @demo.creator (demo account)", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    buyer.getByRole("button", { name: BADGE_COPY.explainerLink }),
  ).toBeVisible();
  const row = buyer
    .getByRole("region", { name: "Where it was posted" })
    .locator("[data-posting-row]");
  await expect(row).toHaveCount(1);
  await expect(
    row.getByText("@demo.creator on Demo", { exact: true }),
  ).toBeVisible();
  await expect(row.getByText("Verified", { exact: true })).toBeVisible();
  const viewPost = row.getByRole("link", {
    name: "View post on Demo (opens in a new tab)",
    exact: true,
  });
  await expect(viewPost).toHaveText("View post ↗");
  await expect(viewPost).toHaveAttribute("href", OWN_DEMO_LINK);
  await expect(viewPost).toHaveAttribute("target", "_blank");
  await expect(viewPost).toHaveAttribute("rel", REL);
  await expect(
    buyer.getByText(LICENSE_PAGE_COPY.whatYouGet.title, { exact: true }),
  ).toBeVisible();

  // Metadata (01 J6.4; 04 §12.1): the title, the canonical URL and the link preview from the poster route.
  await expect(buyer).toHaveTitle(`${APP_NAME}: ${title}`);
  const canonical = new URL(`/@${handle}/${slug}`, baseURL).href;
  await expect(buyer.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    canonical,
  );
  await expect(buyer.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    `${title} · @${handle}`,
  );
  await expect(
    buyer.locator('meta[property="og:description"]'),
  ).toHaveAttribute("content", `License this video on ${APP_NAME}.`);
  const ogImage = buyer.locator('meta[property="og:image"]');
  await expect(ogImage).toHaveAttribute(
    "content",
    new RegExp(`^https?://[^/]+/api/media/posters/${videoId}\\?v=[0-9a-f]{8}$`),
  );
  const image = await context.request.get(
    (await ogImage.getAttribute("content")) ?? "",
  );
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/jpeg");

  // First load (01 J7.1): Organic social repost · 30 days · One country, nothing chosen yet.
  await expect(radio(buyer, "use", "organic_social")).toBeChecked();
  await expect(radio(buyer, "term", "d30")).toBeChecked();
  await expect(radio(buyer, "territory", "country")).toBeChecked();
  const bar = buyer.locator("[data-pricebar]");
  const lines = bar.locator("[data-price-lines]");
  const total = bar.locator("[data-price-total]");
  const button = bar.getByRole("button");
  await expect(lines).toHaveText(
    `License ${cad(15000)} · Service fee ${cad(1500)}`,
  );
  await expect(total).toContainText(`Total ${cad(16500)}`);
  await expect(button).toHaveText("Choose a country");
  await expect(button).toBeDisabled();
  await expect(bar.getByRole("status")).toHaveText("");

  // Paid social ads · 1 year · Worldwide (07 D79): the golden, the button and the Organic tile's license-price delta.
  await choose(buyer, "use", "paid_social");
  await choose(buyer, "term", "y1");
  await choose(buyer, "territory", "worldwide");
  await expect(lines).toHaveText(
    `License ${cad(157500)} · Service fee ${cad(15750)}`,
  );
  await expect(total).toContainText(`Total ${cad(173250)}`);
  await expect(button).toHaveText(`Request license · ${cad(173250)}`);
  await expect(button).toBeDisabled();
  await expect(bar.getByRole("status")).toHaveText(`Total ${cad(173250)}`);
  await expect(tile(buyer, "use", "organic_social")).toContainText(
    formatDelta(-105000, "cad"),
  );
  await expect(buyer.locator('input[name="expectedTotalCents"]')).toHaveValue(
    "173250",
  );
  const submission = buyer.locator('input[name="submissionId"]');
  await expect(submission).toHaveValue(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

  // The currency, said once in the summary and once in the small print, and no bare $ anywhere (07 D94, D98).
  const main = buyer.locator("main");
  await expect(
    main.getByText("Prices in Canadian dollars (CAD).", { exact: true }),
  ).toBeVisible();
  await expect(main).toContainText(
    "Your card is charged in Canadian dollars. If your card uses another currency, your bank converts it and may add a fee.",
  );
  const text = await buyer.locator("body").innerText();
  expect(text).not.toMatch(/(^|[^A-Z])\$\d/);
  expect(text).not.toMatch(/USD|US\$/);

  // A focused field stays clear of the bar; its error shows on blur without moving the checkbox from under the tap
  // that blurred it (P12's WebKit miss).
  const email = buyer.getByLabel("Email", { exact: true });
  await email.fill("sam@");
  await expect
    .poll(async () => {
      const [field, barBox] = await Promise.all([boxOf(email), boxOf(bar)]);
      return field.bottom <= barBox.top + 0.5;
    })
    .toBe(true);
  const terms = buyer.getByRole("checkbox");
  await terms.scrollIntoViewIfNeeded();
  if (isMobile) await terms.tap();
  else await terms.click();
  await expect(terms).toBeChecked();
  await expect(
    main.getByText(DETAILS_COPY.email, { exact: true }),
  ).toBeVisible();

  // Nothing set a cookie (01 J7.20); a reload renders a fresh submission id.
  expect(await context.cookies()).toEqual([]);
  const firstId = await submission.inputValue();
  await buyer.reload();
  await hydrated(buyer);
  await expect(submission).not.toHaveValue(firstId);

  // Mixed case is a permanent redirect to the lowercase handle; a slug that names nothing is the 404 (07 D03).
  const moved = await context.request.get(`/@${handle.toUpperCase()}/${slug}`, {
    maxRedirects: 0,
  });
  expect(moved.status()).toBe(308);
  expect(moved.headers().location).toMatch(
    new RegExp(`/@${handle.replaceAll(".", "\\.")}/${slug}$`),
  );
  const gone = await buyer.goto(missing);
  expect(gone?.status()).toBe(404);
  await expect(
    buyer.getByRole("heading", {
      level: 1,
      name: LICENSE_PAGE_COPY.unavailable,
    }),
  ).toBeVisible();
  await expect(
    buyer.getByRole("link", { name: LICENSE_PAGE_COPY.seeVideos(handle) }),
  ).toHaveAttribute("href", `/@${handle}`);
  expect(await buyer.title()).not.toContain(title);

  expect(external).toEqual([]);
  await context.close();
  expect(errors).toEqual([]);
});

test("J7.4, J5.14: a music video's Paid social ads and TV / broadcast are off with the music notice; arrow keys skip them; a key press keeps focus on the radio, a tap moves it into the select", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const { shareUrl } = await publishDemoVideo(page, { music: "Yes" });
  const context = await browser.newContext({ baseURL });
  const buyer = await context.newPage();
  const errors = collectConsoleErrors(buyer);
  await buyer.goto(shareUrl);
  await hydrated(buyer);

  await expect(
    buyer.getByText(LICENSE_PAGE_COPY.music.title, { exact: true }),
  ).toBeVisible();
  await expect(buyer.getByText(LICENSE_PAGE_COPY.music.body)).toBeVisible();
  for (const key of ["paid_social", "broadcast"]) {
    await expect(radio(buyer, "use", key)).toBeDisabled();
    await expect(tile(buyer, "use", key)).toContainText(
      LICENSE_PAGE_COPY.musicDisabled,
    );
  }
  // The only Use left keeps the choice: the arrow keys pass over the disabled tiles.
  const organic = radio(buyer, "use", "organic_social");
  await organic.focus();
  await organic.press("ArrowDown");
  await expect(organic).toBeChecked();
  await expect(organic).toBeFocused();
  // Term moves with the arrows, and the price follows.
  const d30 = radio(buyer, "term", "d30");
  await d30.focus();
  await d30.press("ArrowRight");
  await expect(radio(buyer, "term", "m6")).toBeChecked();
  await expect(buyer.locator("[data-price-lines]")).toHaveText(
    `License ${cad(22500)} · Service fee ${cad(2250)}`,
  );
  // One region by keyboard keeps focus on the radio (owner answer Q-113 a); Tab reaches its select.
  const country = radio(buyer, "territory", "country");
  await country.focus();
  await country.press("ArrowDown");
  const region = radio(buyer, "territory", "region");
  await expect(region).toBeChecked();
  await expect(region).toBeFocused();
  await expect(buyer.locator("[data-pricebar]").getByRole("button")).toHaveText(
    "Choose a region",
  );
  await region.press("Tab");
  await expect(buyer.getByLabel("Region", { exact: true })).toBeFocused();
  await buyer
    .getByLabel("Region", { exact: true })
    .selectOption("middle_east_africa");
  await expect(buyer.locator("main")).toContainText(
    "in the Middle East & Africa, for 6 months from approval.",
  );
  await expect(buyer.locator('input[name="territoryCode"]')).toHaveValue(
    "middle_east_africa",
  );
  // Which countries?: its long list takes focus after Close and scrolls by keyboard, in WebKit too (WCAG 2.1.1).
  await pressLocator(
    buyer.getByRole("button", { name: LICENSE_PAGE_COPY.whichCountries }),
  );
  const sheet = buyer.getByRole("dialog", {
    name: LICENSE_PAGE_COPY.whichCountries,
  });
  await expect(sheet).toBeVisible();
  await buyer.keyboard.press("Tab");
  await expect(
    sheet.getByRole("region", { name: LICENSE_PAGE_COPY.whichCountries }),
  ).toBeFocused();
  await buyer.keyboard.press("PageDown");
  await expect
    .poll(() =>
      sheet.locator(".overflow-y-auto").evaluate((el) => el.scrollTop),
    )
    .toBeGreaterThan(0);
  await buyer.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // A tap on One country does move focus into its select. The tile's label is stretched over the tile (so a tap
  // anywhere selects), so it is what the pointer hits.
  await tile(buyer, "territory", "country").locator("label").click();
  await expect(radio(buyer, "territory", "country")).toBeChecked();
  await expect(buyer.getByLabel("Country", { exact: true })).toBeFocused();

  await context.close();
  expect(errors).toEqual([]);
});
