import { randomUUID } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { signInPath } from "../../../src/lib/sign-in";
import { readSignInCode } from "../../helpers/read-latest-email";

/**
 * A run-unique address. Each test and project needs its own: only the newest code for an address works, so two tests
 * signing the same address in at once would break each other.
 */
export function uniqueEmail(testInfo: TestInfo): string {
  return `creator+${testInfo.project.name}-${randomUUID().slice(0, 8)}@example.com`;
}

/** One ADMIN_EMAILS address per project (.env.test lists both, 07 D88), for the same reason. */
export function e2eAdminEmail(testInfo: TestInfo): string {
  return testInfo.project.name === "webkit-iphone"
    ? "e2e-admin-2@example.com"
    : "e2e-admin@example.com";
}

/** Opens /sign-in?next=…, asks for a code for `email` and returns it once step 2 shows. */
export async function requestCode(
  page: Page,
  email: string,
  next = "/dashboard",
): Promise<string> {
  await page.goto(signInPath(next));
  await page.getByLabel("Email", { exact: true }).fill(email);
  const since = Date.now();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email." }),
  ).toBeVisible();
  // Step 2 takes focus to the code field, which is described by the "we sent to …" line.
  const field = page.getByLabel("Code", { exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveAccessibleDescription(
    /^Enter the 6-digit code we sent to .…@/,
  );
  return readSignInCode(email, since);
}

/**
 * Signs `email` in through the /sign-in UI and waits until it lands on its next page. The code goes in with one fill,
 * like a paste, so the form submits it by itself.
 */
export async function signInWithEmail(
  page: Page,
  email: string,
  next = "/dashboard",
): Promise<void> {
  const code = await requestCode(page, email, next);
  await page.getByLabel("Code", { exact: true }).fill(code);
  await page.waitForURL((url) => url.pathname !== "/sign-in");
}
