import { expect, test } from "@playwright/test";
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
  atEveryWidth,
  expectCreatorChrome,
  expectInsideColumn,
  expectPageFrame,
  expectSettingsColumn,
  expectSheetForm,
  expectTouchTarget,
} from "./helpers/layout";

// G.6 for Connections (S13, 05 §6.2; 07 D145, D147, D149, D154) on all four projects: one left-aligned 640 px column
// at every tier, the creator chrome per tier, the card's controls inside the column, and the Disconnect sheet's form.
test.use({ reducedMotion: "reduce" });

test("G.6: Connections keeps one left-aligned 640 px column, before and after a connect, at every tier", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await page.goto(CONNECTIONS);
  const connectDemo = page.getByRole("link", { name: "Connect Demo" });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectPageFrame(page, width, { banner: true });
    await expectSettingsColumn(page, width);
    await expectCreatorChrome(page, width);
    await expectInsideColumn(connectDemo);
    await expectTouchTarget(connectDemo);
  });

  await linkDemoAccount(page, CONNECTIONS);
  const card = accountCard(page, "@demo.creator");
  const syncNow = card.getByRole("button", { name: "Sync now", exact: true });
  const more = card.getByRole("button", { name: "More for @demo.creator" });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectPageFrame(page, width, { banner: true });
    await expectSettingsColumn(page, width);
    await expectCreatorChrome(page, width);
    await expect(card.getByText(SYNC_LINE)).toBeVisible();
    for (const control of [syncNow, more]) {
      await expectInsideColumn(control);
      await expectTouchTarget(control);
    }
    // Overflow → Disconnect… opens the sheet: a bottom sheet below md, a centered dialog from md. Esc closes it and
    // nothing is disconnected.
    const sheet = await openDisconnectSheet(page, "@demo.creator");
    await expectSheetForm(sheet, width);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
});

test("G.6: the longest connect error keeps the column and the card in place at every tier", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await page.goto(CONNECTIONS);
  await linkDemoAccount(page, CONNECTIONS);
  await page.goto(`${CONNECTIONS}?error=already_linked`);
  const banner = page.getByText(/is already connected to another/);
  const card = accountCard(page, "@demo.creator");
  const another = page.getByRole("link", {
    name: "Connect another Demo account",
  });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectPageFrame(page, width, { banner: true });
    await expectSettingsColumn(page, width);
    await expectCreatorChrome(page, width);
    await expect(banner).toBeVisible();
    await expect(card).toBeVisible();
    await expectInsideColumn(card);
    await expectInsideColumn(another);
    await expectTouchTarget(another);
  });
  expect(errors).toEqual([]);
});
