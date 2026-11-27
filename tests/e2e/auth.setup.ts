import { expect, test as setup } from "@playwright/test";
import { signUpCreator } from "./helpers/creator";
import { LIBRARY, tiles, waitForLibrary } from "./helpers/library";
import {
  ADMIN_STATE,
  CREATOR_STATE,
  MAYA_FILMS,
  writeRunId,
} from "./helpers/run";
import { setupAdminEmail, signInWithEmail } from "./helpers/sign-in";

// The setup project (P22; 07 D54, D154), before every other project: a new run id in run.txt, then each role signed in
// once with its storageState saved: the admin (the first ADMIN_EMAILS address, by OTP) and the setup creator (Demo
// connected, payouts on) that the decline and expiry specs share. Then the creator @maya.films, so /@maya.films (a
// dotted handle, 07 D20) resolves: every run empties the database first, so the handle is always free. In order, in one
// worker: run.txt first, and written once.
setup.describe.configure({ mode: "serial" });

/**
 * A creator's sign-up against a server that may still be cold, on the budget other sign-up specs use (pricing.spec.ts):
 * one timeout here skips the rest of setup and every project after it.
 */
const SIGN_UP_TIMEOUT_MS = 120_000;

setup("a new run id", () => {
  writeRunId();
});

setup("the admin signs in to /admin", async ({ page }) => {
  await signInWithEmail(page, setupAdminEmail(), "/admin");
  await expect(page).toHaveURL("/admin");
  await expect(
    page.getByRole("heading", { level: 1, name: "Admin" }),
  ).toBeAttached();
  await page.context().storageState({ path: ADMIN_STATE });
});

setup(
  "the setup creator: Demo connected, payouts on, its Library's 24 posts",
  async ({ page }) => {
    setup.setTimeout(SIGN_UP_TIMEOUT_MS);
    // A run-unique handle and payouts on: signUpCreator's defaults.
    await signUpCreator(page, { connectDemo: true });
    // Set up payouts returns to Settings (owner answer Q-214); the Library is next.
    await page.goto(LIBRARY);
    await waitForLibrary(page);
    await expect(tiles(page)).toHaveCount(24);
    await page.context().storageState({ path: CREATOR_STATE });
  },
);

setup("the creator @maya.films", async ({ page }) => {
  setup.setTimeout(SIGN_UP_TIMEOUT_MS);
  await signUpCreator(page, {
    payouts: false,
    handle: MAYA_FILMS,
    email: `${MAYA_FILMS}@example.com`,
  });
});
