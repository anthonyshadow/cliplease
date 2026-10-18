import { expect, type Page, test } from "@playwright/test";
import { OTP_RESEND_DELAY_MS } from "../../src/lib/sign-in";
import { DAY_MS } from "../../src/lib/time";
import { readSignInCode, wrongCode } from "../helpers/read-latest-email";
import { collectConsoleErrors } from "./helpers/console";
import {
  atEveryWidth,
  expectNoHorizontalScroll,
  expectPageFrame,
} from "./helpers/layout";
import {
  e2eAdminEmail,
  requestCode,
  signInWithEmail,
  uniqueEmail,
} from "./helpers/sign-in";

// P04: /sign-in (S10), the route gates and the admin bootstrap, on both projects. Every test signs in its own address.
const BAD_CODE = "That code didn't work. Check it or send a new one.";
const TOO_MANY = "Too many tries. Wait a minute and try again.";
const SIGNED_OUT = "You've been signed out. Sign in again to continue.";
const VERIFY_PATH = "/api/auth/sign-in/email-otp";
const SEND_PATH = "/api/auth/email-otp/send-verification-otp";
const GET_SESSION_PATH = "/api/auth/get-session";

/** The visually hidden alert that announces a field error (focus may already be in the field). */
const announced = (page: Page, text: string) =>
  page.getByRole("alert").filter({ hasText: text });

/** Counts the requests the page sends to `pathname` from now on. */
function countRequests(page: Page, pathname: string) {
  const seen = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === pathname) seen.count += 1;
  });
  return seen;
}

/**
 * Reloads `path` with the page's clock two days ahead, so the session's daily extension is due, and waits for
 * SessionRefresh's answer from the auth route (waiting for the answer, not the request, so no later navigation cancels
 * it). The server's clock and the cookie's lifetime are untouched.
 */
async function expectRefreshWhenDue(page: Page, path: string) {
  await page.clock.install({ time: Date.now() + 2 * DAY_MS });
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === GET_SESSION_PATH,
  );
  await page.goto(path);
  expect((await refreshed).status()).toBe(200);
}

test.describe("signed out", () => {
  for (const path of ["/dashboard", "/onboarding", "/admin"]) {
    test(`${path} redirects to /sign-in with next`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await page.goto(path);
      await expect(page).toHaveURL(`/sign-in?next=${encodeURIComponent(path)}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Sign in" }),
      ).toBeVisible();
      await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("a session cookie that no longer works shows the signed-out banner", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: "ended.c2lnbmF0dXJl",
        url: baseURL,
      },
    ]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/sign-in?next=%2Fdashboard");
    await expect(page.getByRole("status")).toHaveText(SIGNED_OUT);
    // Without `next` (the landing page's Sign in link) the same cookie shows no banner (owner answer, P04).
    await page.goto("/sign-in");
    await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);
  });

  test("the proxy keeps the whole path and query in next", async ({
    request,
  }) => {
    // Only src/proxy.ts can answer these: the pages' own guards know their path but not the query, and
    // /dashboard/nope has no page at all.
    for (const [path, next] of [
      ["/dashboard?from=x", "%2Fdashboard%3Ffrom%3Dx"],
      ["/dashboard/nope?x=1", "%2Fdashboard%2Fnope%3Fx%3D1"],
      ["/admin/anything", "%2Fadmin%2Fanything"],
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toMatch(
        new RegExp(`/sign-in\\?next=${next}$`),
      );
    }
  });

  test("security headers: noindex on /sign-in, frame and sniffing rules everywhere", async ({
    request,
  }) => {
    const signIn = await request.get("/sign-in");
    expect(signIn.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    const home = await request.get("/");
    expect(home.headers()["x-frame-options"]).toBe("DENY");
    expect(home.headers()["x-content-type-options"]).toBe("nosniff");
    expect(home.headers()["x-robots-tag"]).toBeUndefined();
    expect(home.headers()["strict-transport-security"]).toBeUndefined();
  });
});

test.describe("sign-in form", () => {
  test("an invalid email shows the field error without a request", async ({
    page,
  }) => {
    const sends = countRequests(page, SEND_PATH);
    await page.goto("/sign-in");
    const email = page.getByLabel("Email", { exact: true });
    await email.fill("maya@");
    await email.press("Enter");
    const message = "Enter an email address like name@example.com.";
    await expect(email).toHaveAccessibleDescription(message);
    await expect(announced(page, message)).toHaveCount(1);
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    expect(sends.count).toBe(0);
  });

  test("a wrong code shows the error, announces it and moves focus back to the code field", async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page, [
      { status: 400, pathname: VERIFY_PATH },
    ]);
    const code = await requestCode(page, uniqueEmail(testInfo));
    const field = page.getByLabel("Code", { exact: true });
    await field.pressSequentially(wrongCode(code));
    // Clicking moves focus to the button; the failure brings it back to the field.
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(field).toHaveAccessibleDescription(
      `${BAD_CODE} Enter the 6-digit code we sent to c…@example.com.`,
    );
    await expect(announced(page, BAD_CODE)).toHaveCount(1);
    await expect(field).toBeFocused();
    await expect(page).toHaveURL(/\/sign-in/);
    expect(errors).toEqual([]);
  });

  test("a network failure is a form Banner, not the field's error", async ({
    page,
  }) => {
    await page.route(`**${SEND_PATH}`, (route) => route.abort());
    await page.goto("/sign-in");
    const email = page.getByLabel("Email", { exact: true });
    await email.fill("maya@example.com");
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Something went wrong. Try again." }),
    ).toBeVisible();
    await expect(email).not.toHaveAttribute("aria-invalid", "true");
    await expect(email).toBeFocused();
  });

  test("the limiter's 429 shows the too-many-tries copy", async ({ page }) => {
    const errors = collectConsoleErrors(page, [
      { status: 429, pathname: SEND_PATH },
    ]);
    await page.route(`**${SEND_PATH}`, (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ message: "Too many requests." }),
      }),
    );
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill("maya@example.com");
    await page.getByRole("button", { name: "Email me a code" }).click();
    const email = page.getByLabel("Email", { exact: true });
    await expect(email).toHaveAccessibleDescription(TOO_MANY);
    await expect(announced(page, TOO_MANY)).toHaveCount(1);
    await expect(email).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("typed digits wait for Sign in; Enter submits", async ({
    page,
  }, testInfo) => {
    const code = await requestCode(page, uniqueEmail(testInfo));
    const verifies = countRequests(page, VERIFY_PATH);
    const sessionChecks = countRequests(page, GET_SESSION_PATH);
    const field = page.getByLabel("Code", { exact: true });
    await field.pressSequentially(code);
    await expect(field).toHaveValue(code);
    // An auto-submit would have switched the button to "Signing in…" in the same event.
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    expect(verifies.count).toBe(0);
    await field.press("Enter");
    await page.waitForURL("/onboarding?step=profile");
    expect(verifies.count).toBe(1);
    // A brand-new session isn't due for its daily extension: SessionRefresh stays quiet.
    await page.waitForLoadState("networkidle");
    expect(sessionChecks.count).toBe(0);
  });

  test("Send a new code appears after 30 s and its code works", async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    const email = uniqueEmail(testInfo);
    await requestCode(page, email);
    const resend = page.getByRole("button", { name: "Send a new code" });
    await expect(resend).toHaveCount(0);
    await page.clock.fastForward(OTP_RESEND_DELAY_MS);
    const since = Date.now();
    await resend.click();
    await page
      .getByLabel("Code", { exact: true })
      .fill(await readSignInCode(email, since));
    await page.waitForURL("/onboarding?step=profile");
  });

  test("Use a different email goes back to step 1", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo);
    await requestCode(page, email);
    await page.getByRole("button", { name: "Use a different email" }).click();
    const field = page.getByLabel("Email", { exact: true });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(email);
  });
});

test.describe("signed in", () => {
  test("a new creator lands on /onboarding with one code check, gets the 404 on /admin, and signs out", async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page, [
      { status: 404, pathname: "/admin" },
    ]);
    const verifies = countRequests(page, VERIFY_PATH);
    await signInWithEmail(page, uniqueEmail(testInfo));
    await expect(page).toHaveURL("/onboarding?step=profile");
    // The app's pages sit on canvas-alt (04 §3).
    await expect(page.locator("html")).toHaveCSS(
      "background-color",
      "rgb(245, 245, 245)",
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Welcome. Pick your handle.",
      }),
    ).toBeVisible();
    expect(verifies.count).toBe(1);

    await page.goto("/sign-in?next=%2Fonboarding");
    await expect(page).toHaveURL("/onboarding?step=profile");

    const admin = await page.goto("/admin");
    expect(admin?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found." }),
    ).toBeVisible();
    // The 404 must not give the admin area away, title included.
    await expect(page).toHaveTitle("Page not found · ClipLease");

    await page.goto("/onboarding");
    await page.getByRole("button", { name: "Account menu" }).click();
    // Without a creator profile, Settings would only send them back here (04 §9.30).
    await expect(page.getByRole("menuitem", { name: "Settings" })).toHaveCount(
      0,
    );
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/sign-in");
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/sign-in?next=%2Fdashboard");
    await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("an ADMIN_EMAILS address opens the /admin placeholder", async ({
    page,
  }, testInfo) => {
    const admin = e2eAdminEmail(testInfo);
    if (admin === null) {
      test.skip(
        true,
        "admin sign-in runs on chromium-desktop and webkit-iphone only (07 D88, D154)",
      );
      return;
    }
    const errors = collectConsoleErrors(page);
    await signInWithEmail(page, admin, "/admin");
    await expect(page).toHaveURL("/admin");
    await expect(page).toHaveTitle("Admin · ClipLease");
    await expect(
      page.getByRole("heading", { level: 1, name: "Admin" }),
    ).toBeAttached();
    await expect(page.getByRole("banner")).toContainText("Admin");
    // The admin shell fits every tier (07 D154). The sweep lives in this test because a second test signing in the same
    // e2e admin would replace this one's code: only the newest code works.
    await atEveryWidth(page, testInfo, async ({ width }) => {
      await expectNoHorizontalScroll(page);
      await expectPageFrame(page, width, { banner: true });
    });
    // The admin shell keeps the sign-in alive too.
    await expectRefreshWhenDue(page, "/admin");
    expect(errors).toEqual([]);
  });

  test("the creator area asks the auth route to extend the sign-in once a day is due", async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page);
    await signInWithEmail(page, uniqueEmail(testInfo));
    await expect(page).toHaveURL("/onboarding?step=profile");
    await expectRefreshWhenDue(page, "/onboarding");
    expect(errors).toEqual([]);
  });
});
