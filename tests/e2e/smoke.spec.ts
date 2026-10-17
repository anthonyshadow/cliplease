import { expect, type Page, test } from "@playwright/test";

const LEGAL_ROUTES = [
  "/legal/license/v1",
  "/legal/terms",
  "/legal/privacy",
  "/legal/data-deletion",
];

/**
 * Console errors and page errors. On a 404 page the browser itself logs the document's own 404
 * ("Failed to load resource: … 404"); pass that path to ignore exactly that entry and nothing else.
 */
function collectConsoleErrors(page: Page, expected404Path?: string): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const isDocument404 =
      expected404Path !== undefined &&
      message.text().startsWith("Failed to load resource:") &&
      new URL(message.location().url).pathname === expected404Path;
    if (!isDocument404) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** The page content keeps the side gutter (--gutter, 16 px on phones and more from sm). */
async function expectGutter(page: Page) {
  const padding = await page
    .locator("main")
    .first()
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft));
  expect(padding).toBeGreaterThanOrEqual(16);
}

/** WCAG 2.2 SC 1.4.10 Reflow width: long words and link rows must wrap, never scroll sideways. */
const NARROWEST = { width: 320, height: 640 };

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("home page responds with 200 and shows main", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("main")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Your video. Your price." }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Sign in" }),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectGutter(page);
  expect(errors).toEqual([]);
});

for (const route of LEGAL_ROUTES) {
  test(`${route} shows the draft notice`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByText("Draft for testing. Not for real transactions."),
    ).toBeVisible();
    await expect(page.getByText("Last updated 15 Oct 2026 · v1")).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Sign in" }),
    ).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/\{[a-z_]+\}/);
    await expectNoHorizontalScroll(page);
    await expectGutter(page);
    await page.setViewportSize(NARROWEST);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

test("/legal/terms carries the payouts and auto-renewal sections", async ({
  page,
}) => {
  await page.goto("/legal/terms");
  await expect(page.locator("#payouts")).toContainText(
    "Stripe may debit the bank account linked to your payouts",
  );
  await expect(page.locator("#auto-renewal")).toContainText(
    "at most about a day before",
  );
});

test("/dev/ui renders the primitive gallery (APP_ENV=test)", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  const response = await page.goto("/dev/ui");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: /UI primitives/ }),
  ).toBeVisible();
  for (const section of [
    "Buttons",
    "Fields",
    "Status",
    "Feedback",
    "Overlays",
    "Composites",
    "Shell",
  ]) {
    await expect(
      page.getByRole("heading", { level: 2, name: section, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByText("CA$1,575.00", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.locator("meta[name=robots]")).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("an unknown URL returns 404 with the designed page", async ({ page }) => {
  const path = "/does-not-exist";
  const errors = collectConsoleErrors(page, path);
  const response = await page.goto(path);
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found." }),
  ).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Go to ClipLease" }),
  ).toHaveAttribute("href", "/");
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});
