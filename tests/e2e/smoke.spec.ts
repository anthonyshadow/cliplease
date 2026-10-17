import { expect, test } from "@playwright/test";

test("home page responds with 200 and shows main", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("main")).toBeVisible();
});
