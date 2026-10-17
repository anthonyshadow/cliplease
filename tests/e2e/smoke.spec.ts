import { expect, type Page, test } from "@playwright/test";

const LEGAL_ROUTES = [
  "/legal/license/v1",
  "/legal/terms",
  "/legal/privacy",
  "/legal/data-deletion",
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

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
