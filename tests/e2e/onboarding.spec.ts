import { expect, type Page, test } from "@playwright/test";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import { collectConsoleErrors } from "./helpers/console";
import {
  completeProfileStep,
  E2E_CREATOR_NAME,
  setUpPayouts,
  signUpCreator,
  uniqueHandle,
  uniqueLongHandle,
} from "./helpers/creator";
import { expectNoHorizontalScroll } from "./helpers/layout";
import { pressAndSettle, pressButton, waitInPage } from "./helpers/press";
import {
  addStaleSessionCookie,
  signInWithEmail,
  uniqueEmail,
} from "./helpers/sign-in";

// J1 and J11 with the fake payments driver (05 §5.2, §6.11, §4.6; 07 D93, D95, D139).

const AGE_ERROR = "You must be 18 or older to sell on ClipLease.";
const CAD_FACT =
  "You'll get paid in Canadian dollars (CAD) to a Canadian bank account.";
const NEGATIVE_BALANCE =
  "If a refund ever takes back money you've already been paid and your Stripe balance goes below zero, Stripe may take that amount from your bank account.";
const BANNER = "Set up payouts so you can approve requests (about 2 min)";
const NEW_NAME = "Maya Rivera";

/** `handle` as a RegExp source: its dots are literal. */
const literal = (handle: string) => handle.replaceAll(".", "\\.");

/** The CAD fact line and, under it, the negative-balance line with its Payout terms link (07 D139). */
async function expectPayoutFacts(page: Page) {
  await expect(page.getByText(CAD_FACT, { exact: true })).toBeVisible();
  await expect(page.getByText(NEGATIVE_BALANCE)).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Payout terms/ }),
  ).toHaveAttribute("href", "/legal/terms#payouts");
}

test("a new creator onboards, sets up payouts, has a public page and signs out", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  const handle = uniqueHandle(testInfo);
  await signInWithEmail(page, uniqueEmail(testInfo), "/onboarding");
  await expect(page).toHaveURL("/onboarding?step=profile");

  // Step 1: no date of birth, a required and unticked 18+ box.
  await expect(page.getByLabel(/birth/i)).toHaveCount(0);
  await expect(page.getByText(/date of birth/i)).toHaveCount(0);
  const age = page.getByLabel("I'm 18 or older", { exact: true });
  await expect(age).not.toBeChecked();
  await expect(age).toHaveAttribute("required");

  const name = page.getByLabel("Your name", { exact: true });
  const handleField = page.getByLabel("Handle", { exact: true });
  await name.fill(E2E_CREATOR_NAME);
  await handleField.fill("admin");
  await expect(page.getByText("That handle isn't available.")).toBeVisible();
  await handleField.fill(`@${handle.toUpperCase()}`);
  await expect(handleField).toHaveValue(handle);
  await expect(page.getByText(`@${handle} is yours`)).toBeVisible();

  // Continue without the tick: the error under the box, focus on it, and nothing saved (J1.7).
  await page.getByRole("button", { name: "Continue" }).click();
  // The field message under the box describes it (the sr-only alert repeats the same words).
  await expect(age).toHaveAccessibleDescription(AGE_ERROR);
  await expect(age).toBeFocused();
  await expect(page).toHaveURL("/onboarding?step=profile");
  await page.reload();
  await expect(page).toHaveURL("/onboarding?step=profile");
  await expect(name).toHaveValue("");
  await expect(handleField).toHaveValue("");

  await completeProfileStep(page, handle);
  await expect(
    page.getByRole("heading", { level: 1, name: "Connect your accounts" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Continue" }).click();
  await page.waitForURL("/onboarding?step=payouts");
  await expect(
    page.getByText(
      "You can publish now. You'll need payouts set up to approve a request.",
    ),
  ).toBeVisible();
  await expectPayoutFacts(page);
  // No country or currency control (07 D94).
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByLabel(/country|currency/i)).toHaveCount(0);

  await setUpPayouts(page);
  await expect(
    page.getByText("Canadian dollars (CAD)", { exact: true }),
  ).toBeVisible();
  await expectPayoutFacts(page);
  // The handle is read-only (07 D20).
  await expect(page.getByText(`@${handle}`, { exact: true })).toBeVisible();
  await expect(page.getByText("Handles can't change yet.")).toBeVisible();
  await expect(page.getByLabel("Handle", { exact: true })).toHaveCount(0);
  const zone = await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  await expect(
    page.getByText(`Emails use ${zone} (from this device)`),
  ).toBeVisible();
  // The window is read-only here (P19c makes it a choice); Save and Update from this device answer with a toast.
  await expect(page.getByText("72 hours", { exact: true })).toBeVisible();
  await page.getByLabel("Display name", { exact: true }).fill(NEW_NAME);
  await pressAndSettle(page, "Save");
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await pressAndSettle(page, "Update from this device");
  await expect(
    page.getByText("Time zone updated.", { exact: true }),
  ).toBeVisible();

  // There is no guardian step (07 D93).
  await page.goto("/onboarding?step=guardian");
  await expect(page).toHaveURL("/dashboard");

  // The public page, logged out, on a phone-sized screen.
  const visitorContext = await browser.newContext({
    baseURL,
    viewport: { width: 375, height: 812 },
  });
  const visitor = await visitorContext.newPage();
  // A fresh handle: valid, and no creator has it, so the page looks it up and finds nothing.
  const missing = `/@${uniqueHandle(testInfo)}`;
  const visitorErrors = collectConsoleErrors(visitor, [
    { status: 404, pathname: missing },
  ]);
  const ok = await visitor.goto(`/@${handle}`);
  expect(ok?.status()).toBe(200);
  await expect(
    visitor.getByRole("heading", { level: 1, name: NEW_NAME }),
  ).toBeVisible();
  await expect(visitor.getByText(`@${handle}`, { exact: true })).toBeVisible();
  await expect(visitor.getByText("No videos yet.")).toBeVisible();
  await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    new RegExp(`/@${literal(handle)}$`),
  );
  // Mixed case is a permanent (308) redirect to the lowercase URL.
  const moved = await visitor.request.get(`/@${handle.toUpperCase()}`, {
    maxRedirects: 0,
  });
  expect(moved.status()).toBe(308);
  expect(moved.headers().location).toMatch(new RegExp(`/@${literal(handle)}$`));
  await visitor.goto(`/@${handle.toUpperCase()}`);
  await expect(visitor).toHaveURL(`/@${handle}`);
  const unknown = await visitor.goto(missing);
  expect(unknown?.status()).toBe(404);
  await expect(visitor.getByText("No creator here.")).toBeVisible();
  expect(visitorErrors).toEqual([]);
  await visitorContext.close();

  // Sign out from Settings (J1.11).
  await page.goto("/dashboard/settings");
  await pressButton(page, "Sign out");
  await expect(page).toHaveURL("/sign-in");
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/sign-in?next=%2Fdashboard");
  expect(errors).toEqual([]);
});

test("skipping payouts shows the banner until payouts are on", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  await expect(page).toHaveURL("/dashboard/library");
  await expect(page.getByText(BANNER)).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByText(BANNER)).toBeVisible();
  // The empty Inbox with no live video yet: the way to make one (05 §6.3 callout 13).
  await expect(page.getByText(INBOX_COPY.empty)).toBeVisible();
  await expect(
    page.getByRole("link", { name: INBOX_COPY.makeLicensable }),
  ).toHaveAttribute("href", "/dashboard/library");

  await page.getByRole("link", { name: "Set up payouts" }).click();
  await page.waitForURL("/dashboard/settings#payouts");
  await expectPayoutFacts(page);
  await setUpPayouts(page);

  await page.goto("/dashboard/library");
  await expect(
    page.getByRole("heading", { level: 1, name: /^Library\./ }),
  ).toBeVisible();
  await expect(page.getByText(BANNER)).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(page.getByText(BANNER)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a taken handle offers free suggestions, a handle claimed meanwhile is just taken, and format problems are explained", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  // The longest handle: its suggestions are as long as handles get. A saved profile is all the test needs.
  const taken = uniqueLongHandle(testInfo);
  await signInWithEmail(page, uniqueEmail(testInfo), "/onboarding");
  await completeProfileStep(page, taken);
  await page.context().clearCookies();
  // A controllable clock (time still flows) lets the test move past the 300 ms pause without sleeping.
  await page.clock.install();
  await signInWithEmail(page, uniqueEmail(testInfo), "/onboarding");
  await expect(page).toHaveURL("/onboarding?step=profile");
  const field = page.getByLabel("Handle", { exact: true });

  // The availability line (aria-live). A bad character is explained once typing pauses, without leaving the field.
  const line = page.locator('form p[aria-live="polite"]');
  await field.fill("maya-films");
  await expect(line).toHaveText(
    "Use lowercase letters, numbers, dots and underscores",
  );
  await expect(field).toBeFocused();

  // A handle that more typing can still make valid stays quiet until a blur (04 §9.6). The field has not been left
  // yet; running the clock past the 300 ms pause fires the timer after which the line would otherwise show.
  for (const unfinished of ["ma", "maya."]) {
    await field.fill(unfinished);
    await page.clock.runFor(600);
    // The timer's state update renders after runFor returns: give it time to show before checking the line stays empty.
    await waitInPage(page, 250);
    await expect(line).toHaveText("");
  }
  await field.blur();
  await expect(line).toHaveText(
    "Start and end with a letter or number, with no two dots in a row.",
  );
  await field.fill("ma");
  await expect(line).toHaveText("Use 3 to 30 characters.");

  await field.fill(taken);
  await expect(line).toHaveText(`@${taken} is taken`);
  const chips = page.getByRole("button", { name: /^@/ });
  await expect(chips.first()).toBeVisible();
  expect(await chips.count()).toBeLessThanOrEqual(3);
  // Long suggestions, and the line naming the taken handle, wrap on the narrowest phone (07 D153).
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 720 });
  await expectNoHorizontalScroll(page);
  if (viewport) await page.setViewportSize(viewport);
  const suggestion = (await chips.first().innerText()).slice(1);
  await chips.first().click();
  await expect(field).toHaveValue(suggestion);
  await expect(field).toBeFocused();
  await expect(line).toHaveText(`@${suggestion} is yours`);

  // 01 J1.5: the handle was free when checked, and someone else claims it before Continue.
  const rivalContext = await browser.newContext({ baseURL });
  const rival = await rivalContext.newPage();
  await signInWithEmail(rival, uniqueEmail(testInfo), "/onboarding");
  await completeProfileStep(rival, suggestion);
  await rivalContext.close();
  await page.getByLabel("Your name", { exact: true }).fill(E2E_CREATOR_NAME);
  await page.getByLabel("I'm 18 or older", { exact: true }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(field).toHaveAccessibleDescription(
    new RegExp(`@${literal(suggestion)} was just taken$`),
  );
  await expect(chips.first()).toBeVisible();
  await expect(page).toHaveURL("/onboarding?step=profile");
  // A key that normalizes away changes nothing: the refusal and the fresh suggestions stay.
  await field.press("End");
  await field.press("Space");
  await expect(field).toHaveValue(suggestion);
  await expect(field).toHaveAccessibleDescription(
    new RegExp(`@${literal(suggestion)} was just taken$`),
  );
  await expect(chips.first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("a failed payout setup comes back to Settings with an error above the button that tries again", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  // Where /api/stripe/onboarding sends the creator when it fails (05 §1 "Error (recoverable)").
  await page.goto("/dashboard/settings?payouts=error");
  const payouts = page.locator("#payouts");
  await expect(payouts.getByRole("alert")).toHaveText(
    "Something went wrong. Try again.",
  );
  await expect(
    payouts.getByRole("link", { name: "Set up payouts" }),
  ).toHaveAttribute("href", "/api/stripe/onboarding");
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("a signed-out visitor with a stale session cookie comes back to the step they opened", async ({
  page,
  context,
  baseURL,
}) => {
  await addStaleSessionCookie(context, baseURL);
  // The proxy lets a request with a cookie through; the page's own check keeps ?step=.
  await page.goto("/onboarding?step=payouts");
  await expect(page).toHaveURL("/sign-in?next=%2Fonboarding%3Fstep%3Dpayouts");
});
