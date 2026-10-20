import { randomBytes } from "node:crypto";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { linkDemoAccount } from "./connections";
import { signInWithEmail, uniqueEmail } from "./sign-in";

// One letter per Playwright project (07 D154), the letters P22's run ids use: c chromium-desktop, w webkit-iphone,
// i webkit-ipad, x chromium-xl.
const PROJECT_LETTER: Readonly<Partial<Record<string, string>>> = {
  "chromium-desktop": "c",
  "webkit-iphone": "w",
  "webkit-ipad": "i",
  "chromium-xl": "x",
};

// This worker's run id, in base 36.
const RUN_ID = Date.now().toString(36);

/**
 * A run-unique dotted handle, `e2e.<run id><4 hex><project letter>` (17 characters, valid for HANDLE_RE). The random
 * part and the letter keep two tests, and the same test on two projects running at once, apart.
 */
export function uniqueHandle(testInfo: TestInfo): string {
  const letter = PROJECT_LETTER[testInfo.project.name] ?? "z";
  return `e2e.${RUN_ID}${randomBytes(2).toString("hex")}${letter}`;
}

/**
 * A run-unique handle of the full 30 characters, led by wide letters: the widest a handle can be, for checks that
 * nothing pushes a phone screen sideways.
 */
export function uniqueLongHandle(testInfo: TestInfo): string {
  const handle = uniqueHandle(testInfo);
  return `${"w".repeat(30 - handle.length)}${handle}`;
}

export const E2E_CREATOR_NAME = "Maya R.";

/** Fills the profile step (05 §5.2) for `handle`, ticks "I'm 18 or older" and continues to the connect step. */
export async function completeProfileStep(page: Page, handle: string) {
  await page.getByLabel("Your name", { exact: true }).fill(E2E_CREATOR_NAME);
  await page.getByLabel("Handle", { exact: true }).fill(handle);
  await expect(page.getByText(`@${handle} is yours`)).toBeVisible();
  await page.getByLabel("I'm 18 or older", { exact: true }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("/onboarding?step=connect");
}

/**
 * Signs a run-unique email up as a creator: sign-in, the profile step (with `handle`, or a run-unique one), Connect
 * Demo on the connect step when `connectDemo` (P10b; M3's specs), the connect step's Continue, then payout setup
 * (`payouts: true`, the default; it lands on Settings with payouts on) or "Skip for now" (it lands on the Library).
 * Later prompts extend this helper rather than forking it.
 */
export async function signUpCreator(
  page: Page,
  {
    payouts = true,
    handle = uniqueHandle(test.info()),
    connectDemo = false,
  }: { payouts?: boolean; handle?: string; connectDemo?: boolean } = {},
): Promise<{ email: string; handle: string }> {
  const email = uniqueEmail(test.info());
  await signInWithEmail(page, email, "/onboarding");
  await expect(page).toHaveURL("/onboarding?step=profile");
  await completeProfileStep(page, handle);
  if (connectDemo) await linkDemoAccount(page, "/onboarding?step=connect");
  await page.getByRole("link", { name: "Continue" }).click();
  await page.waitForURL("/onboarding?step=payouts");
  if (payouts) {
    await setUpPayouts(page);
  } else {
    await page.getByRole("link", { name: "Skip for now" }).click();
    await page.waitForURL("/dashboard/library");
  }
  return { email, handle };
}

/** Follows "Set up payouts" (the fake driver returns straight to Settings) and waits for "Payouts on". */
export async function setUpPayouts(page: Page) {
  await Promise.all([
    page.waitForURL("/dashboard/settings?payouts=returned"),
    page.getByRole("link", { name: "Set up payouts" }).click(),
  ]);
  await expect(page.getByText("Payouts on", { exact: true })).toBeVisible();
}
