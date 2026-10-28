import { expect, type Page, type Route } from "@playwright/test";
import { isServerAction, pressLocator, requestEnded } from "./press";

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

/** Fills "Your details" with a valid licensee, name and email; the terms stay unticked. */
export async function fillDetails(page: Page) {
  await page
    .getByLabel("Licensed to", { exact: true })
    .fill("Daily Laughs Media LLC");
  await page.getByLabel("Your name", { exact: true }).fill("Sam Lee");
  await page.getByLabel("Email", { exact: true }).fill("Ana.Buyer@Studio.COM");
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
