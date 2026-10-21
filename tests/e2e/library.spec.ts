import { randomUUID } from "node:crypto";
import { expect, type Request, type Response, test } from "@playwright/test";
import { encodeLibraryCursor } from "../../src/lib/library/filter";
import { CONNECTIONS, SYNC_LINE } from "./helpers/connections";
import { collectConsoleErrors, type ExpectedFailure } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  connectDemo,
  expectThumbnailsLoaded,
  LIBRARY,
  searchParam,
  tileCaption,
  tileLink,
  tiles,
  waitForGridHydrated,
} from "./helpers/library";
import { isServerAction, pressAndSettle, pressLink } from "./helpers/press";

// S12 behavior (05 §6.1, J3) on chromium-desktop and webkit-iphone: the empty state, a Demo connect's 24 tiles, the
// platform chip, caption search, a second account with Show more and the account strip, Sync all's summary, a failed
// thumbnail, and nothing syncing on open. Each test signs up its own creator. Tile links go to
// /dashboard/videos/new?post=…, which doesn't exist yet (P10b/P11): they are read, never followed. Controls are
// pressed with the keyboard: on the iPhone a click near the bottom can land on the fixed TabBar.
test.use({ reducedMotion: "reduce" });

// Post 01, the newest (07 D53). The caption is longer than two lines can show; the CSS clamps it, the DOM has it all.
const FIRST_CAPTION = /^He saw snow for the first time/;
const FIRST_META = "Demo · 1 Oct 2026 · 0:14 · 14.8M views";
// 07 D39: the media + caption link and Make licensable both open the Source page (P11) for a post with no video.
const TILE_HREF = /^\/dashboard\/videos\/new\?post=([0-9a-f-]{36})$/;
const THUMBNAIL_PATH = /^\/api\/library\/thumbnails\/([0-9a-f-]{36})$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

test("J3: the empty Library, then a Demo connect shows 24 tiles with loaded thumbnails, and opening it syncs nothing", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = collectConsoleErrors(page);
  // 07 D42: images come through our proxy; the page never asks another host for anything.
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && !LOCAL_HOSTS.has(url.hostname)) {
      external.push(request.url());
    }
  });
  await signUpCreator(page);

  // No account yet: the no-accounts EmptyState (04 §11.9), with no strip, chips, search or grid.
  await page.goto(LIBRARY);
  const main = page.locator("main");
  await expect(
    main.getByRole("heading", {
      level: 1,
      name: "Library. Nothing here yet.",
    }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Connect an account", exact: true }),
  ).toHaveAttribute("href", CONNECTIONS);
  await expect(
    main.getByRole("link", { name: "Or upload a video", exact: true }),
  ).toBeVisible();
  await expect(main.locator("search")).toHaveCount(0);
  await expect(page.locator("[data-library-grid]")).toHaveCount(0);
  await pressLink(page, "Connect an account");
  await page.waitForURL(CONNECTIONS);
  await connectDemo(page);

  // Open the Library: every Server Action from here on would be a sync on open (07 D13).
  const actions: string[] = [];
  page.on("request", (request: Request) => {
    if (isServerAction(request)) actions.push(request.url());
  });
  const thumbnails = new Map<string, { status: number; type?: string }>();
  page.on("response", (response: Response) => {
    const { pathname } = new URL(response.url());
    if (THUMBNAIL_PATH.test(pathname)) {
      thumbnails.set(pathname, {
        status: response.status(),
        type: response.headers()["content-type"],
      });
    }
  });
  await page.goto(LIBRARY);
  await expect(tiles(page)).toHaveCount(24);
  await waitForGridHydrated(page);
  await expect(main.locator('p[aria-live="polite"]')).toHaveText(SYNC_LINE);
  await expect(
    page.getByRole("link", { name: "All 24", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: "Demo 24", exact: true }),
  ).toBeVisible();

  // The first tile is post 01: its caption, its meta line (the link's description), and both links to the Source page.
  const first = tiles(page).first();
  await expect(tileCaption(first)).toHaveText(FIRST_CAPTION);
  await expect(first.locator('p[id^="meta-"]')).toHaveText(FIRST_META);
  await expect(tileLink(first)).toHaveAccessibleDescription(FIRST_META);
  const href = await tileLink(first).getAttribute("href");
  expect(href).toMatch(TILE_HREF);
  const postId = TILE_HREF.exec(href ?? "")?.[1];
  await expect(
    first.getByRole("link", { name: "Make licensable", exact: true }),
  ).toHaveAttribute("href", href ?? "");
  // The thumbnail's version rides in the query, so a sync's new image gets past the browser's cached one.
  await expect(first.locator("img")).toHaveAttribute(
    "src",
    new RegExp(`^/api/library/thumbnails/${postId}\\?v=`),
  );
  // Every tile links to its own post.
  const hrefs = await tileLink(tiles(page)).evaluateAll((links) =>
    links.map((a) => a.getAttribute("href") ?? ""),
  );
  expect(hrefs.every((h) => TILE_HREF.test(h))).toBe(true);
  expect(new Set(hrefs).size).toBe(24);

  // Each thumbnail loads (they are lazy) from the proxy as an SVG.
  await expectThumbnailsLoaded(page);
  await expect.poll(() => thumbnails.size).toBe(24);
  for (const [pathname, answer] of thumbnails) {
    expect(answer, pathname).toEqual({ status: 200, type: "image/svg+xml" });
  }

  await page.waitForLoadState("networkidle");
  expect(actions).toEqual([]);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("J3: the Demo chip, caption search and Clear search keep each other's filters", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await connectDemo(page);
  await page.goto(LIBRARY);
  await expect(tiles(page)).toHaveCount(24);

  // The platform chip sets ?platform= (server-rendered links).
  await pressLink(page, "Demo 24");
  await expect.poll(() => searchParam(page, "platform")).toBe("mock");
  await expect(
    page.getByRole("link", { name: "Demo 24", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: "All 24", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
  await expect(tiles(page)).toHaveCount(24);

  // Typing searches 250 ms after the last key and keeps the platform.
  const field = page.getByRole("searchbox", { name: "Search captions" });
  await field.fill("snow");
  await expect.poll(() => searchParam(page, "q")).toBe("snow");
  expect(searchParam(page, "platform")).toBe("mock");
  await expect(tiles(page)).toHaveCount(1);
  await expect(tileCaption(tiles(page).first())).toHaveText(FIRST_CAPTION);

  // No match: the EmptyState with curly quotes and its Clear search link (the field's X button has the same name).
  await field.fill("zzzz");
  await expect.poll(() => searchParam(page, "q")).toBe("zzzz");
  await expect(
    page.getByRole("heading", { name: "No videos match “zzzz”." }),
  ).toBeVisible();
  await expect(tiles(page)).toHaveCount(0);
  await pressLink(page, "Clear search");
  await expect.poll(() => searchParam(page, "q")).toBeNull();
  expect(searchParam(page, "platform")).toBe("mock");
  await expect(tiles(page)).toHaveCount(24);
  await expect(field).toHaveValue("");
  expect(errors).toEqual([]);
});

test("J3: with two Demo accounts, All 48, Show more appends the next 24, the strip filters to one account, and a cursor past the end starts over", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await connectDemo(page, { accounts: 2 });
  await page.goto(LIBRARY);
  await expect(
    page.getByRole("link", { name: "All 48", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(tiles(page)).toHaveCount(24);

  // Show more appends in place (a Server Action) once the island has hydrated, and focuses the first new tile.
  await waitForGridHydrated(page);
  // A Cmd/Ctrl click is the browser's: the next page (?cursor=) opens in a new tab and this grid stays as it is.
  if (testInfo.project.name === "chromium-desktop") {
    const [next] = await Promise.all([
      page.context().waitForEvent("page"),
      page
        .getByRole("link", { name: "Show more" })
        .click({ modifiers: ["ControlOrMeta"] }),
    ]);
    // The new tab starts at about:blank: its tiles mean the ?cursor= page has loaded.
    await expect(tiles(next)).toHaveCount(24);
    expect(searchParam(next, "cursor")).not.toBeNull();
    await next.close();
    await expect(tiles(page)).toHaveCount(24);
    expect(searchParam(page, "cursor")).toBeNull();
  }
  await pressLink(page, "Show more");
  await expect(tiles(page)).toHaveCount(48);
  await expect(tileLink(tiles(page).nth(24))).toBeFocused();
  await expect(page.getByRole("link", { name: "Show more" })).toHaveCount(0);
  expect(searchParam(page, "cursor")).toBeNull();

  // 48 different posts; the two accounts share their 24 captions, so each caption shows exactly twice (the order
  // within a tie of posted_at is the id's, so it isn't asserted).
  const hrefs = await tileLink(tiles(page)).evaluateAll((links) =>
    links.map((a) => a.getAttribute("href") ?? ""),
  );
  expect(new Set(hrefs).size).toBe(48);
  const captions = await tileCaption(tiles(page)).allTextContents();
  const perCaption = new Map<string, number>();
  for (const caption of captions) {
    perCaption.set(caption, (perCaption.get(caption) ?? 0) + 1);
  }
  expect(perCaption.size).toBe(24);
  expect([...perCaption.values()].every((n) => n === 2)).toBe(true);

  // The strip item for the second account filters to it: ?account=, 24 tiles, each caption once.
  const second = page.getByRole("link", { name: /^@demo\.creator\.2/ });
  await second.focus();
  await second.press("Enter");
  await expect
    .poll(() => searchParam(page, "account"))
    .toMatch(/^[0-9a-f-]{36}$/);
  await expect(second).toHaveAttribute("aria-current", "page");
  await expect(tiles(page)).toHaveCount(24);
  expect(new Set(await tileCaption(tiles(page)).allTextContents()).size).toBe(
    24,
  );

  // A cursor past the end of the list (a bookmark whose posts have gone since) starts over from the first page with the
  // same filters, never "No videos found".
  const account = searchParam(page, "account");
  const past = encodeLibraryCursor({
    postedAt: new Date("1971-01-01T00:00:00Z"),
    id: randomUUID(),
  });
  await page.goto(`${LIBRARY}?account=${account}&cursor=${past}`);
  await expect.poll(() => searchParam(page, "cursor")).toBeNull();
  expect(searchParam(page, "account")).toBe(account);
  await expect(tiles(page)).toHaveCount(24);
  expect(errors).toEqual([]);
});

test("J3.4: Sync all reads each account's outcome in SyncStatus, by @username when two share a platform", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await connectDemo(page, { accounts: 2 });
  await page.goto(LIBRARY);
  const status = page.locator('main p[aria-live="polite"]');
  await expect(status).toHaveText(
    /^Synced (just now|\d+ min ago) · 48 videos$/,
  );
  await pressAndSettle(page, "Sync all");
  await expect(status).toHaveText(
    "@demo.creator up to date · @demo.creator.2 up to date",
  );
  await expect(
    page.getByRole("button", { name: "Sync all", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("J3.10: a thumbnail that fails shows “Demo · Sync to refresh”, never a broken image", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // The routed 404 is the one failure the browser may log.
  const expected: ExpectedFailure[] = [];
  const errors = collectConsoleErrors(page, expected);
  await signUpCreator(page);
  await connectDemo(page);
  await page.goto(LIBRARY);
  await expect(tiles(page)).toHaveCount(24);
  const href = await tileLink(tiles(page).first()).getAttribute("href");
  const postId = TILE_HREF.exec(href ?? "")?.[1];
  expect(postId).toBeDefined();
  const pathname = `/api/library/thumbnails/${postId}`;
  expected.push({ status: 404, pathname });
  // Routing turns the HTTP cache off, so the reload asks for the image again.
  await page.route(
    (url) => url.pathname === pathname,
    (route) => route.fulfill({ status: 404, body: "" }),
  );
  await page.reload();
  await expect(tiles(page)).toHaveCount(24);
  const failed = tiles(page).first();
  await expect(tileLink(failed)).toHaveAttribute("href", href ?? "");
  await expect(
    failed.getByText("Demo · Sync to refresh", { exact: true }),
  ).toBeVisible();
  await expect(failed.locator("img")).toHaveCount(0);
  // The caption and meta still show; the next tile's image still loads.
  await expect(tileCaption(failed)).toHaveText(FIRST_CAPTION);
  const next = tiles(page).nth(1).locator("img");
  await expect
    .poll(() => next.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await page.unrouteAll({ behavior: "wait" });
  expect(errors).toEqual([]);
});
