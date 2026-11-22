# P21 — Admin view: audit and design

> Status: **built (2026-11-22).** Answers Q-197–Q-200 (all recommended, one step); the screens approved as drawn (Q-201);
> P21 implemented and verified (PROGRESS.md "P21 — Admin view", AD-113–AD-117). Screens: the "ClipLease Admin (P21)" design canvas, https://claude.ai/artifact/NPA7StLj7s2ebDEC2QXvoE
> (private to the owner): the six tabs at 1280, an empty tab, dark mode, the phone layout and Disable sheet, the Disable
> sheet's ready / still-open / error states and the Enable sheet. One line the screens add beyond Q-199's deck, for the
> owner's yes: the still-open sheet's body "The video is disabled and its posts are released. Try again to decline the
> request. If you close this, the request can't be charged and its hold is released at its deadline."
> Prompt: `../../mvp-plan/prompts/P21-admin-view.md` · Estimate 90 min · Next ids: Q-197, AD-113.
> This file corrects the prompt where the code or the docs moved on, settles what the prompt leaves open, and draws the
> screens the plan docs don't draw. Where it says *(proposed)*, the words are new and need the owner's yes (Q-199).

## 0. Where things stand

- **Step 0 passed.** `bun run check:step0` with P20b's specs (my-licenses, my-licenses.responsive, exclusive, delivery,
  licenses.responsive): typecheck, lint and 4507 unit tests green; the code is the code of the last green `check:full`
  (after the P18–P20b review fixes, 9f9b082), so integration and e2e didn't need to run again. P20b's files, the
  `/licenses/:path*` matcher, `normalizeEmail`, `requireAdmin`, `refreshVideoOwnership`, `recheckPosting` and every UI
  primitive P21 reuses exist; the buyer-token grep is clean. Step 0's psql and dev-app lines become tests (Q-188).
- **The audit:** three read-only auditors (the read model; disable/enable and money; pages, designs and e2e), every key
  claim spot-checked by hand. Nothing in the prompt is blocked; one money hole needs the owner (Q-197).

## 1. What P21 builds (plain words)

An admin-only page, `/admin`, with six tabs of the newest 50 rows each (creators, connected accounts, videos, requests,
licenses, events), and one safety switch: **Disable video** (the license page goes dark, waiting requests are declined
without charging anyone, the video's verified postings are freed for the rightful owner) and **Enable video** (back to Off;
the creator re-checks the postings). Revoking a license with its refund is P21b.

## 2. Questions for the owner

**Q-197 · Money: can a disabled video still be approved?** Today nothing in Approve or auto-approve looks at whether the
video is disabled (the capture step takes the video's lock but ignores its status, `state-machine.ts:416`). If Disable's
decline of a request fails for a moment (the payment service hiccups), the request stays open, and **auto-approve can then
charge the buyer for a disabled video with nobody touching anything**; the creator's own Approve has the same opening.
- **a) Close the hole (recommended).** Under the same video lock Disable takes, the capture step refuses a `disabled` video
  (not an `unpublished` one, so the creator's own Turn off still never blocks Approve, J5.20) and declines the request as
  the system with reason `video_disabled`, exactly as it already does for an exclusive conflict. Auto-approve's 10-minute
  give-up does the same instead of handing a disabled video's request to the creator. No new words: the Inbox already
  says "This video was disabled, so the request was declined. The buyer wasn't charged."
- b) As the prompt says: Approve stays unblocked; running Disable again and the deadline are the backstop (the hole stays).
- c) Only auto-approve skips disabled videos; the creator's Approve stays unblocked.

**Q-198 · A request Disable couldn't decline right away** (the payment service was down for a moment, or a capture was
already in flight).
- **a) The sheet stays open (recommended)** with a warning "1 waiting request is still open." / "{n} waiting requests are
  still open." *(proposed)* and its button reads **Try again**, which runs the sweep again. If the admin closes it, nothing
  can charge those buyers (with Q-197 a) and their holds are released at the deadline.
- b) Disabled rows that still have waiting requests also show a **Decline waiting** button *(proposed)*.
- c) No UI: the deadline and the cron are the backstop.

**Q-199 · The new words** (none of these are in the plan docs; everything else on the page is). Recommended deck:

| Where | Words |
|---|---|
| Disable sheet body, no waiting request | "The license page goes dark. Licenses already sold don't change. Its verified posts are released, so the rightful owner can make them licensable." (the last sentence is 04 §9.22 / 05 §7 word for word, not the prompt's variant) |
| …one waiting request | "The license page goes dark and 1 waiting request is declined. The buyer isn't charged. Licenses already sold don't change. …" (05 §7 callout 6) |
| …several | "The license page goes dark and {n} waiting requests are declined. The buyers aren't charged. Licenses already sold don't change. …" |
| Reason select | first option "Choose a reason", error "Choose a reason." (05 draws "Rights claim" preselected; an empty first option makes the admin choose) |
| Note helper | "Only admins see this. Up to 200 characters." |
| Disable buttons | Keep it live / **Disable video** (05) · loading "Disabling…" |
| Enable sheet | title "Enable {title}?" · body "It goes back to Off. Its released posts stay not verified until the creator taps Check again." · Keep it disabled / **Enable video** · loading "Enabling…" |
| Toasts | "Video disabled." (05, proposed there) · "Video enabled." |
| Licenses tab, Transfer column | "Transfer {price} sent" · "Transfer pending" · "Transfer failed ({code})" (05 §7 callout 7, proposed there; P21b adds refunds) |
| Events section headings | "Latest events" · "Failed emails" · "Unprocessed Stripe events" |
| Flagged event, for screen readers | "Flagged" (with a warning icon, so the red rows don't rely on color alone) |
| Empty tab or list | "Nothing here yet." (05, proposed there) |
| Tab row label (screen readers) | "Admin tables" |

- **a) Use this deck (recommended).** b) Change any line.

**Q-200 · Size.** The prompt guesses 90 minutes; with the corrections below it will run past twice that (AGENTS §3).
- **a) Do it in one go (recommended)**, as P19f–P20b. b) Stop halfway (the read-only tables first, then Disable/Enable).

The prompt's own question 2 (the reason labels) is **already settled** by 05 §7 callout 6 ("Rights claim · Prohibited
content · Other"), and the code uses them (`src/lib/videos/review.ts:43`). Its question 1 is Q-197/Q-198 above, with a
corrected premise: no doc says Approve stays open on a *disabled* video (D28 and J5.20 are about the creator's Turn off).

## 3. Corrections to the prompt (the code or docs moved on)

| Prompt says | Reality | Do |
|---|---|---|
| Step 0: `drizzle/0002_buyer_licenses.sql`, count 3 | `0004_buyer_licenses`, count 5 (PROGRESS.md:775) | as built |
| Step 0 psql / dev-app checks | no dev-DB access (Q-188) | tests on the test DB |
| Task 1: scope labels from `options.ts` | `scopeLabel` in `src/lib/licensing/selection.ts:423` | reuse it |
| Task 1: "the 03 §7.9 CASE" | the code's `statusColumn` (`src/server/licensing/licenses.ts:28`) mirrors `publicStatus` | export and reuse it (one CASE for P22b to change) |
| Task 6: new `VIDEO_DISABLED_REASON_LABELS` | the map exists privately in `review.ts:43` | move it to `src/lib/admin/labels.ts`, export, import back |
| Task 6: creator side to build | already built: pill, Banner, no Turn on/Delete, no Copy link, read-only steps, `/r` and email `video_disabled` copy, `released` posting copy | confirm with tests only |
| Task 6 / e2e: "Where posted shows Check again" on the video page | an Off video's page shows a summary + **Edit**; Check again lives on `?step=postings` | the e2e follows Edit |
| e2e: "Verified · on @demo.creator" | a Library video's source row reads "@demo.creator on Demo" + «Verified» + "· From your Library" | assert that |
| [int] A.4: "claim cleared" | finished rows keep their claim (`state-machine.ts:317`); a declined row keeps `payment_action = 'decline'` | assert the kept claim |
| [int]/Verify: "recheckPosting → verified, then publishVideo succeeds" | re-verifying clears the same-video tick (`save.ts:898`), so Turn on reports `same_video_unconfirmed` | `confirmSameVideo` between them (e2e: re-tick + Continue) |
| [int]: "the poster route returns 404" | 404 signed out; the owner and admins still get it | assert signed out |
| e2e: Check again right after Enable | a check within 30 s is refused (`POSTING_CHECK_COOLDOWN_MS`) | age `checked_at` with a guarded test-DB helper, no sleep |
| e2e: move P04's admin test as is | `expectRefreshWhenDue` is a local function also used by a test that stays; it installs a clock 2 days ahead | move it to `tests/e2e/helpers/sign-in.ts`; run it **last** |
| AC: the sweep "skips" on iPad and XL | `admin.spec.ts` never runs there (`testMatch` keeps those projects on `*.responsive.spec.ts`) | record it |
| NavBar's `below` prop comment: "P21 puts the tabs here" | a layout gets no `searchParams`; the tabs go in the page | fix the comment |
| Out of scope "Licenses money column → P21b" vs Task 1's transfer status | contradictory | show the transfer only (Q-199), P21b adds refunds |

## 4. Design decisions (mine; override any)

1. **Who may decline as `video_disabled`:** `declineScope` gains `{ admin: true }` for an admin actor with reason
   `video_disabled` (and, with Q-197 a, the system with `video_disabled`). AD-112's "a creator waits while auto-approve
   runs" applies to creators only, so the admin's sweep declines auto-approving requests too (D28: no time guard).
2. **Disable, one short transaction:** `lockVideoForLicensing` first (the lock every licensing step takes, so it serializes
   with checkouts, authorizations and capture claims) → if already disabled: no update, no `video.disabled` row, go to the
   sweep → else set `disabled`, `disabled_at`, reason, note → release every verified posting (`unverified` / `released`,
   `verified_at` and social ids kept) with one `video_posting.released` audit each (`{ videoId, platform }`, never the link)
   → clear `same_video_confirmed_at` when anything was released (the posting writers' rule, D69) →
   `refreshVideoOwnership(tx, videoId)` → audit `video.disabled { reason, note }`. Commit.
3. **The sweep, outside any transaction:** the video's `awaiting_approval` requests with `overdue` from the database's clock;
   overdue → `expireLicenseRequest(id, admin)`, else `declineLicenseRequest(id, admin, 'video_disabled')`; stop starting
   requests after a 45 s budget (the page's `maxDuration` is 60); stop if another admin enabled the video meanwhile (two
   admins, D88). Returns `{ stillOpen }`, the waiting requests left.
4. **Enable:** under the same lock; from `disabled` only (else nothing, no audit) → `unpublished`, disabled fields cleared,
   audit `video.enabled { previousReason }`. A disabled **draft** also comes back as `unpublished` (03, D45), with no
   publish date; Turn on runs every blocker as usual.
5. **Actors and actions:** `requireAdminActor` next to `requireCreatorActor` (`src/server/auth/actor.ts`); every loader and
   domain function takes `a: Actor` and narrows it. Actions in `src/app/admin/actions.ts` are each
   `return redactErrors(event, …)` (the lint's `redacted-action` rule), parse → `requireAdmin("/admin")` → domain →
   `refresh()`. Zod: the note trims, `""` becomes nothing, ≤ 200.
6. **The read model** (`src/server/admin/queries.ts`, six loaders, P21b's Step 0 greps the six names): explicit columns
   only; newest first, `created_at DESC, id DESC`, limit 50; counts as subqueries on existing indexes; the three Events
   lists with `Promise.all`; **never** expire, settle or reconcile anything (P22 relies on it). Never selected: token
   ciphertexts and hashes, object keys, `original_upload_id`, IPs and user agents, `avatar_url`, `recipient_hash`,
   original filenames, raw social ids and links, `license.snapshot`, and nothing from Better Auth's session / account /
   verification tables (only `user.email`).
7. **Columns** (§6 draws them): 05 §7's lists, plus the primary verified platform on Videos ("Verified · Demo", D89),
   "on · fell back" for auto-approve and "Processing…" for a claimed request on Requests, `platform_currency` on Stripe
   events. Left out with a follow-up: Accounts "view counts" (only the mock provider exists; P28b).
8. **Labels:** statuses with a 04 §9.9 pill use it (`VideoStatusPill`, `licenseStatusPill`, payouts, Sync problem); the
   ones 04 has no pill for (`checkout_pending`, `awaiting_approval`, `abandoned`, a disconnected account) print the raw
   value in `ink-2`, as 04 §9.9 already does for admin renewal statuses. Exclusive rows show «Exclusive»; standard
   licenses read "Standard" on Licenses (05 callout 11) and nothing on Requests (04 §9.31). Videos' "Req." header reads
   **Waiting** (the count the Disable sheet's {n} uses).
9. **Events:** three lists. Audit rows: Time · Action (verbatim) · Actor (type, plus the user's email when there is one;
   admins already see emails, D47) · Target (type and id) · Details (the redacted `data`). Flagged rows (red text, a
   warning icon and "Flagged" for screen readers) come from one `ADMIN_EVENT_FLAGS` list (P22h extends it): the prompt's
   six plus `license_request.issue_failed` (money taken, no license written: PROGRESS.md:214 asked for it),
   `stripe_event.currency_mismatch` and `connect.negative_balance_debits_failed` (both written by code today, both flags
   in 05 §7). Failed emails never show the recipient.
10. **Times:** `expires_at` in the viewer's own zone through the existing deadline cell (G.7); every other time in UTC
    ("19 Nov 2026, 14:32 UTC", `formatLicenseDate`).
11. **Primitives:** `SegmentedControl` gets a scroll option (below `md` the six tabs scroll inside a padded box that keeps
    their 44 px targets; from `md` equal segments) and scrolls the current tab into view; `DataTable` gets a per-row tone
    for flagged rows; one row-action component per video switches Disable/Enable, named "Disable {title}" for screen
    readers (DataTable renders each cell twice, stacked and wide, so ids can't be shared).
12. **No `loading.tsx`** under `/admin`: a streamed page answers 200, and A.1 needs a real 404 for non-admins (Q-110's
    reason, as /l and My licenses). 05's skeleton rows aren't built.
13. **No avatar or Sign out on the admin bar** (04 §9.30 and the prompt over 05's "(AD)"); an admin signs out from
    `/dashboard`. Say so if you want the account Menu here.
14. **e2e** (`tests/e2e/admin.spec.ts`, the one admin sign-in per project): sign in → arrange (a published Library video,
    one approved license, one open request; rows found by the run's `@handle`) → six tabs → the width sweep (132 checks on
    chromium-desktop, both themes once on the iPhone) → Disable (reason Other, note `ticket-<run>`) → the license page 404,
    `/r` "Not approved", the creator's Banner without the note, the old `/l` still "Verified" → Events shows
    `video.disabled` and `video_posting.released` (filtered by the video) → Enable → «Off» → Edit → Check again (cooldown
    aged in the test DB) → "@demo.creator on Demo «Verified»" → re-tick same video, Continue → Turn on → Events shows
    `video.enabled` → `expectRefreshWhenDue` last. Timeout 600 s, no sleeps. `sign-in.spec.ts` loses the admin test and
    its now-unused imports.

## 5. What a creator and a buyer see (already built; P21 only tests it)

- Creator `/dashboard/videos/[id]`: «Disabled by ClipLease» and the error Banner "Disabled by ClipLease: Other. Questions?
  support@…"; every step read-only; no Turn on, Delete or Copy link; the admin's note is never shown.
- Buyer `/r`: "Not approved" + "This video is no longer available. You haven't been charged, and the hold on your card has
  been released."; the `request-declined` email's `video_disabled` variant. The creator gets no email (D34).
- After Enable: «Off»; on Edit → Where posted, the row reads "Not verified. This post was released when ClipLease turned the
  video off." with **Check again**.

## 6. Screens

05 §7 draws the Videos and Licenses tabs at desktop width and the Disable sheet. These frames fill in the rest, in 05's
style. Pills are «…», buttons […], the selected tab (■ …).

**6.1 Mobile (< 768): the tab row scrolls inside itself, rows stack (label above value, the action last)**

```
┌────────────────────────────────────┐
│ ClipLease  Admin                   │
╞════════════════════════════════════╡
│ ┌────────────────────────────────┐ │
│ │( Creators )( Accounts )(■ Vide→│ │  ← scrolls sideways inside its box; the page never does;
│ └────────────────────────────────┘ │    the current tab is scrolled into view
│ Newest 50                          │
│ ┌────────────────────────────────┐ │
│ │ Title                          │ │
│ │ First snow                     │ │
│ │ Creator                        │ │
│ │ @maya                          │ │
│ │ Ownership                      │ │
│ │ Verified · Demo                │ │
│ │ Postings                       │ │
│ │ 3 · 2 verified                 │ │
│ │ Status                         │ │
│ │ «Live»                         │ │
│ │ Waiting                        │ │
│ │ 2                              │ │
│ │ [        Disable        ]      │ │
│ ├────────────────────────────────┤ │
│ │ Title                          │ │
│ │ Rooftop storm timelapse        │ │
│ │ …                              │ │
│ │ Status                         │ │
│ │ «Disabled by ClipLease»        │ │
│ │ Reason                         │ │
│ │ Rights claim                   │ │
│ │ [        Enable         ]      │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```
Tablet (768–1023): the same stacked rows, the six tabs as equal segments. Desktop (≥ 1024): tables; XL (≥ 1536): the
same in the 1440 container. A table wider than its box scrolls inside its own wrapper.

**6.2 Creators**

```
│ Handle   Name         Email               Payout currency          Payouts                 Videos  Created              │
│ @maya    Maya Reyes   maya@example.com    Canadian dollars (CAD)   «Active»                    3   2 Nov 2026, 14:32 UTC│
│ @theo    Theo Park    theo@example.com    Canadian dollars (CAD)   «Stripe is checking…»       1   1 Nov 2026, 09:10 UTC│
```

**6.3 Accounts** (`?tab=connections`)

```
│ Platform  Username      Owner   Status          Last sync               Last error        Connected         Disconnected │
│ Demo      @demo.creator @maya   «Connected»     7 Nov 2026, 10:02 UTC   —                 2 Nov 2026 …      —            │
│ Demo      @old.handle   @theo   «Sync problem»  5 Nov 2026, 08:40 UTC   rate_limited      1 Nov 2026 …      —            │
│ Demo      @gone         @theo   disconnected    1 Nov 2026, 12:00 UTC   —                 1 Nov 2026 …      3 Nov 2026 … │
```

**6.4 Videos** (05 §7 as drawn, "Req." → **Waiting**, plus Reason and Created)

```
│ Title                   Creator Ownership       Postings       Status                   Waiting Reason        Created     Action     │
│ First snow              @maya   Verified · Demo 3 · 2 verified «Live»                        2 —             2 Nov …     [ Disable ]│
│ Rooftop storm timelapse @maya   Self-attested   2 · 0 verified «Disabled by ClipLease»        0 Rights claim  1 Nov …     [ Enable ] │
```
The admin's note shows on the row (admins only), never on a creator page.

**6.5 Requests** (wide: it scrolls inside its wrapper at 1024 and 1280)

```
│ Licensee        Buyer email       Video       Scope                                      Type         License      Fee        Total        Checkout      PaymentIntent   Charge       Status              Reason         Auto-approve  Deadline              Created │
│ Daily Laughs    ana@studio.com    First snow  Paid social ads · 1 year · Worldwide       «Exclusive»  CA$1,575.00  CA$157.50  CA$1,732.50  cs_test_…     pi_3P…          ch_3P…       awaiting_approval   —              on            Thu 19 Nov, 5:00 PM   …       │
│ Morning Show    bo@studio.com     Caught…     Organic social repost · 30 days · Canada                CA$150.00    CA$15.00   CA$165.00    cs_test_…     pi_3Q…          ch_3Q…       «Declined»          video_disabled on · fell back —                   …       │
│ Northwind       cy@studio.com     Rooftop…    Broadcast · 6 months · Worldwide                        CA$900.00    CA$90.00   CA$990.00    cs_test_…     pi_3R…          —            Processing…         —              —             Fri 20 Nov, 9:00 AM   …       │
```

**6.6 Licenses** (P21's columns; P21b adds refunds and Revoke, P22b+ the renewal columns)

```
│ Code          Licensed to     Video        Status     Type         Issued                  Downloads  Transfer                       Revoked │
│ CL-7K3M-9QXA  Daily Laughs…   First snow   «Valid»    «Exclusive»  2 Nov 2026, 14:32 UTC          2  Transfer CA$1,575.00 sent       —       │
│ CL-4F8T-2WRB  Morning Show…   Caught…      «Expired»  Standard     1 Oct 2026, 09:10 UTC          0  Transfer pending               —       │
│ CL-9P2D-6HNC  Northwind B…    Rooftop…     «Valid»    Standard     30 Sep 2026, 08:00 UTC         1  Transfer failed (account_closed) —     │
```

**6.7 Events** (three lists; flagged rows red with ⚠ and "Flagged" for screen readers)

```
│ Latest events                                                                                                         │
│ Time                    Action                                  Actor                     Target                Details│
│ 8 Nov 2026, 03:09 UTC   video.enabled                           admin · you@example.com   video 1f3c…           {"previousReason":"other"}
│ 8 Nov 2026, 03:08 UTC ⚠ license_request.exclusive_conflict     system · auto_approve     license_request 9a2b… {"exclusive":true}
│ 8 Nov 2026, 03:05 UTC   video_posting.released                  admin · you@example.com   video_posting 7d4e…   {"videoId":"1f3c…","platform":"mock"}
│                                                                                                                        │
│ Failed emails                                                                                                          │
│ Time                    Template            Entity                  Attempts  Error                                    │
│ 7 Nov 2026, 22:10 UTC   request-declined    license_request 9a2b…          3  SmtpError                                │
│                                                                                                                        │
│ Unprocessed Stripe events                                                                                              │
│ Received                Id                  Type                         Account  Attempts  Last error                 │
│ Nothing here yet.                                                                                                      │
```

**6.8 Disable sheet** (desktop dialog; below 768 a bottom sheet, buttons stacked full width, primary first)

```
┌──────────────────────────────────────────────────┐   ┌──────────────────────────────────────────────────┐
│ Disable First snow?                              │   │ Disable First snow?                              │
│ The license page goes dark and 2 waiting         │   │ ┌──────────────────────────────────────────────┐ │
│ requests are declined. The buyers aren't         │   │ │ ⚠ 1 waiting request is still open.           │ │  ← Q-198 a, after the sweep
│ charged. Licenses already sold don't change.     │   │ └──────────────────────────────────────────────┘ │
│ Its verified posts are released, so the          │   │ The video is disabled. …                         │
│ rightful owner can make them licensable.         │   │                                                  │
│ Reason                                           │   │                    [ Close ] [ Try again ]       │
│ ╎ Choose a reason                            ▾ ╎ │   └──────────────────────────────────────────────────┘
│ Note (optional)                                  │
│ ╎                                              ╎ │   Error (any failure): a Banner "Something went wrong.
│ Only admins see this. Up to 200 characters.      │   Try again." inside the sheet; the sheet stays open.
│             [ Keep it live ] [! Disable video !] │   Pending: "Disabling…", the sheet can't be closed.
└──────────────────────────────────────────────────┘
```

**6.9 Enable sheet**

```
┌──────────────────────────────────────────────────┐
│ Enable Rooftop storm timelapse?                  │
│ It goes back to Off. Its released posts stay     │
│ not verified until the creator taps Check again. │
│          [ Keep it disabled ] [ Enable video ]   │   primary (not destructive); "Enabling…" while pending
└──────────────────────────────────────────────────┘
```

**6.10 Empty tab:** the caption, then "Nothing here yet." in place of the table (each Events list the same).

## 7. Build plan

| Area | Files |
|---|---|
| Pure | `src/lib/admin/tabs.ts` (`ADMIN_TABS`, `parseAdminTab`, the tab labels) · `src/lib/admin/labels.ts` (`VIDEO_DISABLED_REASON_LABELS` moved from review.ts, `ADMIN_EVENT_FLAGS`, `isAdminEventFlag`, the transfer and raw-status labels) · `src/lib/validation/admin.ts` (`AdminDisableVideoSchema`, `AdminEnableVideoSchema`) · the copy deck |
| Server | `src/server/admin/queries.ts` (six `listAdmin…` loaders) · `src/server/videos/admin.ts` (`adminSetVideoDisabled`, the sweep) · `src/server/auth/actor.ts` (`requireAdminActor`) · `src/server/licensing/requests.ts` (`declineScope`) · `src/server/licensing/licenses.ts` (export `statusColumn`, `downloadsColumn`) · with Q-197 a: `state-machine.ts` (the capture claim refuses a disabled video), `approve.ts` (decline it as the system), `auto-approve.ts` (give-up declines it) |
| Page | `src/app/admin/page.tsx` (`requireAdmin`, tabs, one DataTable per tab, `maxDuration = 60`) · `src/app/admin/actions.ts` · `src/app/admin/_components/` (the video row action with both sheets, the deadline cell, the Events lists) · `segmented-control.tsx` (scroll option) · `data-table.tsx` (row tone) · `nav-bar.tsx` (comment) |
| Tests | unit: tabs, labels (every reason and flag), Zod schemas, SegmentedControl scroll, DataTable tone, the sheets · [int] `tests/integration/admin.test.ts` (§8) · e2e `tests/e2e/admin.spec.ts` (§4.14), `sign-in.spec.ts` trimmed, `expectRefreshWhenDue` to `helpers/sign-in.ts`, a guarded `ageCheckedAt` helper |

## 8. How it gets verified

- **[int] `admin.test.ts`**, each named by its AC: A.4/J8.10 decline (`video_disabled`, the decline claim kept, one cancel
  `pi-cancel:<id>:decline:<attempt>`, one buyer `request-declined`, no creator email); the release (posting `unverified` /
  `released`, ids kept, one `video_posting.released`, ownership `self_attested`; another creator then verifies the post
  with no unique violation and a `video_posting.conflict` flag); overdue → expired; a held capture claim untouched and
  counted in `stillOpen`; an auto-approving request declined by the admin; with Q-197 a: a creator's Approve and an
  auto-approval on a disabled video decline it and charge nothing; J7.16 (a checkout paid after Disable is abandoned
  `video_unavailable`); the license page and checkout refuse, the poster 404s signed out; Enable (fields cleared, posting
  still unverified, recheck → verified or the already-licensable refusal, `confirmSameVideo`, publish works); A.6 (exactly
  one `video.disabled` / `video.enabled` row per effective action, none for no-ops); A.3 (each loader's exact keys, no
  token, ciphertext, hash, key, IP or agent); a creator calling `adminSetVideoDisabled` is refused; the loaders write
  nothing.
- **e2e** `admin.spec.ts` on chromium-desktop and webkit-iphone (§4.14), then `bun run check:full`.
- **By eye**, from the test build (a throwaway spec, deleted after): every tab at 375 and 1280, light and dark, both sheets.

## 9. Follow-ups this records

P21b: Revoke, refunds, the failed-movements list with Retry (extends `listAdminLicenses` and `listAdminEvents`). P22: the
setup sign-in replaces the one-admin-test rule. P22b–P22h: Requests origin, Licenses term/renewal/consent columns, the
renewal flags in `ADMIN_EVENT_FLAGS`, Disable's renewal side. P28b: Accounts "view counts". P33a: the CDN keeps a disabled
video's public poster up to a day (`s-maxage=3600, stale-while-revalidate=86400`, pre-existing).
