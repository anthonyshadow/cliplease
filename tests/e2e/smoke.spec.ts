import { expect, type Page, test } from "@playwright/test";
import { visit } from "./helpers/console";
import { expectNoHorizontalScroll } from "./helpers/layout";

const LEGAL_ROUTES = [
  "/legal/license/v1",
  "/legal/terms",
  "/legal/privacy",
  "/legal/data-deletion",
];

/** Text each legal route's sections must carry, by section id (P01). */
const SECTION_TEXT: Partial<Record<string, Record<string, string>>> = {
  "/legal/terms": {
    payouts: "Stripe may debit the bank account linked to your payouts",
    "auto-renewal": "at most about a day before",
  },
};

/** The page content keeps the side gutter (--gutter: 16 px below md, 24 px from md, 32 px from lg). */
async function expectGutter(page: Page) {
  const padding = await page
    .locator("main")
    .first()
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft));
  expect(padding).toBeGreaterThanOrEqual(16);
}

/** WCAG 2.2 SC 1.4.10 Reflow width: long words and link rows must wrap, never scroll sideways. */
const NARROWEST = { width: 320, height: 640 };

test("home page responds with 200 and shows main", async ({ page }) => {
  const errors = await visit(page, "/");
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
  test(`${route} shows the draft notice and its sections`, async ({ page }) => {
    const errors = await visit(page, route);
    await expect(
      page.getByText("Draft for testing. Not for real transactions."),
    ).toBeVisible();
    await expect(page.getByText("Last updated 15 Oct 2026 · v1")).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Sign in" }),
    ).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/\{[a-z_]+\}/);
    for (const [id, text] of Object.entries(SECTION_TEXT[route] ?? {})) {
      await expect(page.locator(`#${id}`)).toContainText(text);
    }
    await expectNoHorizontalScroll(page);
    await expectGutter(page);
    await page.setViewportSize(NARROWEST);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

test("/dev/ui renders the primitive gallery (APP_ENV=test)", async ({
  page,
}) => {
  const errors = await visit(page, "/dev/ui");
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
  const errors = await visit(page, "/does-not-exist", 404);
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
