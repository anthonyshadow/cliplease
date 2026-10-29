import { expect, type Page, type Route } from "@playwright/test";
import type { RateOptionKey } from "../../../src/lib/domain/values";
import { CHECKOUT_COPY } from "../../../src/lib/licensing/checkout-copy";
import { LICENSE_PAGE_COPY } from "../../../src/lib/licensing/license-page";
import {
  isServerAction,
  pressAndSettle,
  pressLocator,
  requestEnded,
} from "./press";

// A buyer on the license page (S01, 05 §4.1): its choices, "Your details" and the PriceBar's button.

export const radio = (page: Page, group: string, key: string) =>
  page.locator(`input[name="${group}"][value="${key}"]`);

/** Checks a radio from the keyboard: on the iPhone a click near the bottom can land on the fixed bar. */
export async function choose(page: Page, group: string, key: string) {
  const input = radio(page, group, key);
  await input.focus();
  await input.press("Space");
  await expect(input).toBeChecked();
}

/** The page has hydrated: the hidden timeZone is filled after mount. */
export const hydrated = (page: Page) =>
  expect(page.locator('input[name="timeZone"]')).not.toHaveValue("");

/** The PriceBar's button: "Choose a country", then "Request license · {total}". */
export const requestButton = (page: Page) =>
  page.locator("[data-pricebar]").getByRole("button");

/** Paid social ads · 1 year · Worldwide: CA$1,732.50 at the demo base (07 D79's golden). */
export async function chooseDemoSelection(page: Page) {
  await choose(page, "use", "paid_social");
  await choose(page, "term", "y1");
  await choose(page, "territory", "worldwide");
}

/** The licensee every helper fills in. */
export const E2E_LICENSEE = "Daily Laughs Media LLC";

/** Fills "Your details" with a valid licensee, name and `email`; the terms stay unticked. */
export async function fillDetails(
  page: Page,
  { email = "Ana.Buyer@Studio.COM" }: { email?: string } = {},
) {
  await page.getByLabel("Licensed to", { exact: true }).fill(E2E_LICENSEE);
  await page.getByLabel("Your name", { exact: true }).fill("Sam Lee");
  await page.getByLabel("Email", { exact: true }).fill(email);
}

/** The fake checkout's page for a new request (07 D35). */
export const FAKE_CHECKOUT_URL = /\/dev\/fake-checkout\/[0-9a-f-]{36}$/;

/** Presses Request license with a total the server didn't quote (07 D31), and waits for the refusal. */
export async function requestWithStaleTotal(page: Page) {
  await page
    .locator('input[name="expectedTotalCents"]')
    .evaluate((input: HTMLInputElement) => {
      input.value = "1";
    });
  const refused = requestEnded(page, isServerAction);
  await pressLocator(requestButton(page));
  await refused;
}

/**
 * Holds every Server Action call from now on, so the page stays pending while the test looks at it. The returned
 * release lets them go and drops the route (routing turns the browser's HTTP cache off).
 */
export async function holdServerActions(page: Page) {
  const { promise, resolve } = Promise.withResolvers<void>();
  const hold = async (route: Route) => {
    if (isServerAction(route.request())) await promise;
    return route.fallback();
  };
  await page.route("**/*", hold);
  return async () => {
    resolve();
    await page.unroute("**/*", hold);
  };
}

/** A license's scope and the buyer's address: what a buyer chooses and types on the license page. */
export type LicenseChoice = {
  use: RateOptionKey;
  term: RateOptionKey;
  territory: RateOptionKey;
  /** The country or region the select takes, for those territories. */
  country?: string;
  email?: string;
};

/**
 * Opens `shareUrl` as a buyer, chooses the scope, fills valid details, ticks the terms, requests and lands on the fake
 * checkout. Returns the new request's id.
 */
export async function requestLicense(
  page: Page,
  shareUrl: string,
  { use, term, territory, country, email }: LicenseChoice,
) {
  await page.goto(shareUrl);
  await hydrated(page);
  await choose(page, "use", use);
  await choose(page, "term", term);
  await choose(page, "territory", territory);
  if (territory === "country" || territory === "region") {
    if (!country)
      throw new Error(`requestLicense: ${territory} needs a country`);
    await page
      .getByLabel(LICENSE_PAGE_COPY[territory].label, { exact: true })
      .selectOption(country);
  }
  await fillDetails(page, { email });
  const terms = page.getByRole("checkbox");
  await terms.focus();
  await terms.press("Space");
  await pressLocator(requestButton(page));
  await page.waitForURL(FAKE_CHECKOUT_URL);
  return page.url().split("/").at(-1) ?? "";
}

/** requestLicense with the demo selection (Paid social ads · 1 year · Worldwide). */
export const requestDemoLicense = (page: Page, shareUrl: string) =>
  requestLicense(page, shareUrl, {
    use: "paid_social",
    term: "y1",
    territory: "worldwide",
  });

/**
 * From the fake checkout of `requestId`, opens Stripe's success URL before its event comes (02 §8.3): Cancel leads to
 * the buyer's /r link, and the fake session's id takes the place of `checkout=canceled`.
 */
export async function openSuccessUrl(page: Page, requestId: string) {
  await pressAndSettle(page, CHECKOUT_COPY.cancel);
  await expect(page).toHaveURL(/&checkout=canceled$/);
  await page.goto(
    page
      .url()
      .replace("&checkout=canceled", `&session_id=cs_fake_${requestId}`),
  );
}
