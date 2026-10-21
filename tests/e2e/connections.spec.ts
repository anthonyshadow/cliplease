import { expect, type Page, test } from "@playwright/test";
import {
  accountCard,
  CONNECTIONS,
  linkDemoAccount,
  openDisconnectSheet,
  SYNC_LINE,
} from "./helpers/connections";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  isServerAction,
  pressAndSettle,
  pressButton,
  pressLink,
} from "./helpers/press";

// S13 behavior (05 §6.2, J2) on chromium-desktop and webkit-iphone: connect, the card, Sync now, the menu, Disconnect,
// a second account, and the ?error= states. Controls are pressed with the keyboard: on the iPhone a click near the
// bottom can land on the fixed TabBar.
test.use({ reducedMotion: "reduce" });

// 05 §6.2 / 04 §11.7 (owner answer Q-13 for provider_error), written out: the specs pin the owner's wording.
const ERROR_MESSAGES = {
  denied: "Nothing was linked.",
  state: "Finish in the same browser you started in. Try again.",
  missing_scope: "Allow access to your videos so ClipLease can show them.",
  ig_not_tester:
    "This Instagram account isn't a tester yet. Ask the owner to invite it.",
  no_channel:
    "This Google account has no YouTube channel. Try another account.",
  already_linked:
    /^This account is already connected to another ClipLease account\. If it's yours, contact \S+@\S+\.$/,
  provider_error: "Couldn't reach the platform. Try again.",
} as const;

/** The page's primary controls (05 §6.2: exactly one per view, or none). */
const primaries = (page: Page) => page.locator('main [data-variant="primary"]');

test("J2: connect Demo, see its card, sync it, and disconnect it from the menu", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await page.goto(CONNECTIONS);
  // No account yet: only ConnectRows, and Demo's Connect is the one primary.
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(primaries(page)).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Connect Demo" }),
  ).toHaveAttribute("data-variant", "primary");

  await linkDemoAccount(page, CONNECTIONS);
  const card = accountCard(page, "@demo.creator");
  await expect(card).toBeVisible();
  await expect(card.getByText("Demo", { exact: true })).toBeVisible();
  await expect(card.getByText("Demo account", { exact: true })).toBeVisible();
  await expect(card.getByText("Connected", { exact: true })).toBeVisible();
  await expect(card.getByText(SYNC_LINE)).toBeVisible();
  // The avatar loads through the proxy (07 D42).
  const avatar = card.getByRole("img", { name: "Demo Creator" });
  await expect(avatar).toBeVisible();
  expect(
    await avatar.evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  expect(await avatar.getAttribute("src")).toMatch(
    /^\/api\/connections\/avatars\/[0-9a-f-]{36}$/,
  );
  // Every enabled platform is linked and healthy: no primary at all.
  await expect(primaries(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Connect Demo" })).toHaveCount(0);

  // Sync now runs and the line reads just synced again.
  await pressAndSettle(page, "Sync now");
  await expect(card.getByText(SYNC_LINE)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sync now", exact: true }),
  ).toBeEnabled();

  // The page never carries a token (J2.19).
  const html = await (await page.request.get(CONNECTIONS)).text();
  expect(html).not.toMatch(/mock_(access|refresh)_/);

  // The overflow menu works from the keyboard and gives the focus back.
  const more = page.getByRole("button", { name: "More for @demo.creator" });
  await pressButton(page, "More for @demo.creator");
  await expect(
    page.getByRole("menuitem", { name: "Open in Library" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Disconnect…" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(more).toBeFocused();

  // Disconnect… opens the sheet with the safe button focused; Disconnect brings the ConnectRow back.
  const sheet = await openDisconnectSheet(page, "@demo.creator");
  await expect(
    sheet.getByRole("button", { name: "Keep connected" }),
  ).toBeFocused();
  await pressAndSettle(page, "Disconnect");
  await expect(
    page.getByText("Disconnected @demo.creator.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect Demo" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  expect(errors).toEqual([]);
});

test("J2: a Disconnect that can't reach the server says so in the sheet, the page stays, and a retry disconnects", async ({
  page,
}) => {
  // The cut-off action is the one failure the browser may log.
  const errors = collectConsoleErrors(page, [{ abortedUnder: CONNECTIONS }]);
  await signUpCreator(page);
  await page.goto(CONNECTIONS);
  await linkDemoAccount(page, CONNECTIONS);
  // Cut off the first Server Action this page sends: the Disconnect.
  let cut = false;
  await page.route(
    (url) => url.pathname === CONNECTIONS,
    async (route) => {
      if (!cut && isServerAction(route.request())) {
        cut = true;
        await route.abort("failed");
        return;
      }
      await route.fallback();
    },
  );
  const sheet = await openDisconnectSheet(page, "@demo.creator");
  await pressButton(page, "Disconnect");
  // A refusal in the sheet, not the error page: the sheet, the card and the title are all still here (behind the
  // modal sheet they are hidden from the accessibility tree, so they are found by tag).
  await expect(sheet.getByRole("alert")).toHaveText(
    "Something went wrong. Try again.",
  );
  await expect(sheet).toBeVisible();
  await expect(page.locator("main article")).toHaveCount(1);
  await expect(page.locator("main h1")).toHaveText(/^Connections\./);
  expect(cut).toBe(true);
  await page.unrouteAll({ behavior: "wait" });

  await pressAndSettle(page, "Disconnect");
  await expect(
    page.getByText("Disconnected @demo.creator.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("J2.12: a second tap while a sync runs only says it is already syncing", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await page.goto(CONNECTIONS);
  await linkDemoAccount(page, CONNECTIONS);
  // Hold the Sync now request so the second tap lands while the first still runs; count the actions sent.
  const held = Promise.withResolvers<void>();
  let actions = 0;
  await page.route(
    (url) => url.pathname === CONNECTIONS,
    async (route) => {
      if (isServerAction(route.request())) {
        actions += 1;
        await held.promise;
      }
      await route.fallback();
    },
  );
  await pressButton(page, "Sync now");
  const syncing = page.getByRole("button", { name: "Syncing…" });
  await expect(syncing).toHaveAttribute("aria-busy", "true");
  await syncing.press("Enter");
  await expect(
    page.getByText("Already syncing", { exact: true }),
  ).toBeVisible();
  held.resolve();
  await expect(
    page.getByRole("button", { name: "Sync now", exact: true }),
  ).toBeEnabled();
  await page.unrouteAll({ behavior: "wait" });
  // The second tap started no second sync.
  expect(actions).toBe(1);
  expect(errors).toEqual([]);
});

test("J2.8: Connect another Demo account adds a second card", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await page.goto(CONNECTIONS);
  await linkDemoAccount(page, CONNECTIONS);
  const another = page.getByRole("link", {
    name: "Connect another Demo account",
  });
  await expect(another).toHaveAttribute(
    "href",
    "/api/connect/mock/start?switch=1&returnTo=%2Fdashboard%2Fconnections",
  );
  await pressLink(page, "Connect another Demo account");
  const second = accountCard(page, "@demo.creator.2");
  await expect(second).toBeVisible();
  await expect(second.getByText(SYNC_LINE)).toBeVisible();
  await expect(accountCard(page, "@demo.creator")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("?error= shows its message once; unknown codes show nothing; ig_personal shows the explainer", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  const main = page.locator("main");
  for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
    await page.goto(`${CONNECTIONS}?error=${code}`);
    const banner = main.getByText(message, { exact: true });
    await expect(banner).toBeVisible();
    // Rendered once: the param leaves the address, so a reload doesn't repeat it.
    await expect
      .poll(() => new URL(page.url()).searchParams.has("error"))
      .toBe(false);
    await page.reload();
    await expect(banner).toHaveCount(0);
  }
  await page.goto(`${CONNECTIONS}?error=nope`);
  await expect(main.getByRole("alert")).toHaveCount(0);
  await expect(main.getByRole("status")).toHaveCount(0);

  await page.goto(`${CONNECTIONS}?error=ig_personal`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Instagram needs a professional account. Switching is free.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
    "href",
    "/api/connect/instagram/start?returnTo=%2Fdashboard%2Fconnections",
  );
  await expect(
    page.getByRole("link", {
      name: "Not ready to switch? Upload the video instead. It will be labeled Self-attested.",
    }),
  ).toHaveAttribute("href", "/dashboard/videos/new");
  await pressLink(page, "Back to Connections");
  await expect(
    page.getByRole("heading", { level: 1, name: /^Connections\./ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
