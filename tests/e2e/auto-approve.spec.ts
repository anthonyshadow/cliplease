import { expect, type Locator, type Page, test } from "@playwright/test";
import { REQUEST_EMAIL_COPY } from "../../src/emails/request-copy";
import { formatMoney } from "../../src/lib/format";
import { INBOX_COPY, requestPill } from "../../src/lib/licensing/inbox";
import { LICENSE_PAGE_COPY } from "../../src/lib/licensing/license-page";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { REQUESTS_SETTINGS_COPY } from "../../src/lib/payouts";
import { licensePath, requestDetailPath } from "../../src/lib/urls";
import { BARE_DOLLAR } from "../helpers/money";
import { readLatestEmail } from "../helpers/read-latest-email";
import {
  choose,
  chooseDemoSelection,
  E2E_LICENSEE,
  hydrated,
  radio,
} from "./helpers/buyer";
import { collectConsoleErrors } from "./helpers/console";
import { buyLicense, publishDemoVideo } from "./helpers/flows";
import { pressAndSettleIn } from "./helpers/press";
import { cleanCreatedVideos } from "./helpers/videos";

// The auto-approve proof (P19c; 01 J7.6, J7.18; 04 §11.2, §11.5, §11.10; 05 §4.1, §4.3, §6.3, §6.11, §8; 07 D81) on
// chromium-desktop and webkit-iphone: a creator with payouts on (publishDemoVideo) picks 48 hours and turns on "Approve
// requests automatically" in Settings, saved by the Requests section's own Save. A logged-out buyer reads "Instant
// approval." under the button, pays on the fake checkout and lands on /r reading Processing… (or already Approved: the
// approval runs after Pay's response and can finish before the first render), which turns Approved with no tap from
// the creator. license-approved carries the /l link with /r's own key (no Get file and license on /r until P20, owner
// answer Q-141 a), request-received the 05 §8 auto wording (owner answer Q-152), and the creator gets no request-new.
// The creator's History reads «✓ Approved» and "Auto-approved", nothing waits, and the request page says it too.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const cad = (cents: number) => formatMoney(cents, "cad");
const mainText = (page: Page) => page.locator("main").innerText();

/** Filled in where a sentence names a value the test can't know (a deadline); leadOf keeps the words before it. */
const MARK = "\u0000";

/** `filled`'s words before MARK. */
function leadOf(filled: string): string {
  const at = filled.indexOf(MARK);
  if (at < 0) throw new Error("leadOf: the copy has no mark");
  return filled.slice(0, at);
}

/** An approved request's pill in `scope` (04 §9.9): the cleared tone, its check before the label. */
function approvedPill(scope: Locator): Locator {
  const pill = requestPill("approved");
  if (!pill) throw new Error("approvedPill: approved has no pill");
  return scope.getByText(pill.label, { exact: true });
}

test("J7.6, J7.18: with auto-approve on, the license page says Instant approval. and a paid request turns Approved on /r with no tap from the creator, whose History reads Auto-approved", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const {
    email: creatorEmail,
    handle,
    shareUrl,
  } = await publishDemoVideo(page);
  const creatorErrors = collectConsoleErrors(page);

  // Settings → Requests (05 §6.11 callouts 4, 5 and 8): 48 hours, and the Switch, unlocked while payouts are on; the
  // section's own Save answers "Saved." and a reload reads both back.
  await page.goto("/dashboard/settings");
  await choose(page, "approvalWindowHours", "48");
  const toggle = page.getByRole("switch", {
    name: REQUESTS_SETTINGS_COPY.autoApprove,
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(
    page.getByText(REQUESTS_SETTINGS_COPY.autoApproveHelper, { exact: true }),
  ).toBeVisible();
  await toggle.focus();
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await pressAndSettleIn(
    page,
    page.getByRole("region", { name: "Requests", exact: true }),
    "Save",
  );
  await expect(
    page.getByText(REQUESTS_SETTINGS_COPY.saved, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(radio(page, "approvalWindowHours", "48")).toBeChecked();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // The license page, logged out at 390 × 844 (01 J7.6's auto variant; 04 §11.2): "Instant approval." and the charge
  // now, server-rendered, with no deadline and nothing of the manual hold copy.
  const visitor = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const licensePage = await visitor.newPage();
  const visitorErrors = collectConsoleErrors(licensePage);
  await licensePage.goto(shareUrl);
  await hydrated(licensePage);
  await chooseDemoSelection(licensePage);
  await expect(
    licensePage.locator("p", { hasText: LICENSE_PAGE_COPY.holdAutoLead }),
  ).toHaveText(
    `${LICENSE_PAGE_COPY.holdAutoLead} ${LICENSE_PAGE_COPY.holdAutoBody(handle, cad(173250))}`,
  );
  const shown = await mainText(licensePage);
  expect(shown).not.toContain(LICENSE_PAGE_COPY.holdLead(handle));
  expect(shown).not.toContain(
    leadOf(LICENSE_PAGE_COPY.holdDeadline(handle, MARK)),
  );
  await visitor.close();
  expect(visitorErrors).toEqual([]);

  // Pay (01 J7.18): /r lands on Processing… or, when the approval ran first, Approved; its 3 s refreshes bring Approved
  // and the charge, with no countdown.
  const since = Date.now();
  const COPY = REQUEST_STATUS_COPY;
  const { requestId, statusUrl, context, email } = await buyLicense(
    browser,
    shareUrl,
    {
      use: "paid_social",
      term: "y1",
      territory: "worldwide",
      landing: new RegExp(`^(${COPY.processing}|${COPY.approvedTitle})$`),
    },
  );
  const [buyer] = context.pages();
  if (!buyer) throw new Error("no buyer page");
  const buyerErrors = collectConsoleErrors(buyer);
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
    COPY.approvedTitle,
    { timeout: 15_000 },
  );
  await expect(buyer.locator("main")).toContainText(
    COPY.approvedBody(handle, cad(173250)),
  );
  await expect(buyer.locator("main time")).toHaveCount(0);
  expect(await mainText(buyer)).not.toMatch(BARE_DOLLAR);
  await context.close();
  expect(buyerErrors).toEqual([]);

  // The emails (05 §8): license-approved links /l with /r's own key; request-received opens with the auto wording, up
  // to its deadline; and no request-new reaches the creator (01 J7.18).
  const token = new URL(statusUrl).searchParams.get("t") ?? "";
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const approved = await readLatestEmail({
    to: email,
    template: "license-approved",
    since,
  });
  expect(approved.text).toContain(licensePath(token));
  expect(approved.text).not.toMatch(BARE_DOLLAR);
  const received = await readLatestEmail({
    to: email,
    template: "request-received",
    since,
  });
  expect(received.subject).toBe(REQUEST_EMAIL_COPY.receivedSubject(handle));
  expect(received.text).toContain(
    leadOf(REQUEST_EMAIL_COPY.receivedAutoBody(handle, cad(173250), MARK)),
  );
  expect(received.text).not.toMatch(BARE_DOLLAR);
  await expect(
    readLatestEmail({ to: creatorEmail, template: "request-new", since }),
  ).rejects.toThrow(`No request-new email to ${creatorEmail}`);

  // The creator (05 §6.3; 04 §11.5): History reads «✓ Approved» and "Auto-approved"; nothing waits; the request page
  // says "Auto-approved" in its status block, with no Approve left.
  await page.goto("/dashboard?view=history");
  const row = page.locator("[data-inbox-row]");
  await expect(row).toHaveCount(1);
  await expect(row.locator("[data-licensee]")).toHaveText(E2E_LICENSEE);
  const pill = approvedPill(row);
  await expect(pill).toBeVisible();
  await expect(pill.locator("svg")).toHaveCount(1);
  await expect(
    row.getByText(INBOX_COPY.autoApproved, { exact: true }),
  ).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${INBOX_COPY.title} ${INBOX_COPY.caughtUp}`,
  );
  await page.goto(requestDetailPath(requestId));
  const status = page.locator("#request-status");
  await expect(approvedPill(status)).toBeVisible();
  await expect(
    status.getByText(INBOX_COPY.autoApproved, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: INBOX_COPY.approve, exact: true }),
  ).toHaveCount(0);
  expect(creatorErrors).toEqual([]);
});
