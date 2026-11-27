import { randomBytes } from "node:crypto";
import {
  type BrowserContext,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { signInPath } from "../../../src/lib/sign-in";
import { DAY_MS } from "../../../src/lib/time";
import { readSignInCode } from "../../helpers/read-latest-email";
import { projectLetter, runId } from "./run";

/** Better Auth's session read, which SessionRefresh calls once the sign-in's daily extension is due. */
export const GET_SESSION_PATH = "/api/auth/get-session";

/**
 * A run-unique address, `<role>+<run id>-<project letter><8 hex>@example.com` (P22; `role` creator unless given). Each
 * test and project needs its own: only the newest code for an address works, so two tests signing the same address in
 * at once would break each other. The random part keeps two calls in one test apart.
 */
export function uniqueEmail(testInfo: TestInfo, role = "creator"): string {
  return `${role}+${runId()}-${projectLetter(testInfo)}${randomBytes(4).toString("hex")}@example.com`;
}

/**
 * The first ADMIN_EMAILS address (the owner, 07 D88), as env.ts reads it: the setup project signs it in once and every
 * admin step after it uses that session (.auth/admin.json). playwright.config.ts copies .env.test into process.env.
 */
export function setupAdminEmail(): string {
  const first = process.env.ADMIN_EMAILS?.split(",")[0]?.trim().toLowerCase();
  if (!first) throw new Error("ADMIN_EMAILS lists no address (07 D88)");
  return first;
}

const E2E_ADMINS: Readonly<Partial<Record<string, string>>> = {
  "chromium-desktop": "e2e-admin@example.com",
  "webkit-iphone": "e2e-admin-2@example.com",
};

/**
 * One ADMIN_EMAILS address per original project (.env.test lists both, 07 D88), for the same reason: admin.spec.ts's
 * one OTP sign-in test per project; `null` on every other project, where it skips (07 D154).
 */
export function e2eAdminEmail(testInfo: TestInfo): string | null {
  return E2E_ADMINS[testInfo.project.name] ?? null;
}

/**
 * Opens /sign-in?next=… (plain /sign-in when `next` is null, so the landing rule decides; 07 D126), asks for a code for
 * `email` and returns it once step 2 shows.
 */
export async function requestCode(
  page: Page,
  email: string,
  next: string | null = "/dashboard",
): Promise<string> {
  await page.goto(next === null ? "/sign-in" : signInPath(next));
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
 * Signs `email` in through the /sign-in UI (with `next`, or none when null) and waits until it lands on its next page:
 * the form goes back to /sign-in, which sends the session on. The code goes in with one fill, like a paste, so the form
 * submits it by itself.
 */
export async function signInWithEmail(
  page: Page,
  email: string,
  next: string | null = "/dashboard",
): Promise<void> {
  const code = await requestCode(page, email, next);
  await page.getByLabel("Code", { exact: true }).fill(code);
  await page.waitForURL((url) => url.pathname !== "/sign-in");
}

/** Gives `context` a signed-looking session cookie for a session that no longer exists, as after a sign-out elsewhere. */
export function addStaleSessionCookie(
  context: BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  return context.addCookies([
    {
      name: "better-auth.session_token",
      value: "ended.c2lnbmF0dXJl",
      url: baseURL,
    },
  ]);
}

/**
 * Reloads `path` with the page's clock two days ahead, so the session's daily extension is due, and waits for
 * SessionRefresh's answer from the auth route (waiting for the answer, not the request, so no later navigation cancels
 * it). The server's clock and the cookie's lifetime are untouched. The page's clock stays installed: call it last.
 */
export async function expectRefreshWhenDue(page: Page, path: string) {
  await page.clock.install({ time: Date.now() + 2 * DAY_MS });
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === GET_SESSION_PATH,
  );
  await page.goto(path);
  expect((await refreshed).status()).toBe(200);
}
