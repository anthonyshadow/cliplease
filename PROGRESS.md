# Progress

<!--
  Template from the ClipLease plan kit: /Users/anthonyshadowitz/Documents/ClipLease/mvp-plan/PROGRESS.template.md
  App repo: /Users/anthonyshadowitz/Documents/ClipLease/App/ClipLease (package name `cliplease`; the kit is ../../mvp-plan from it).
  P00 creates PROGRESS.md at the app repo root from it (the kit README's P00 message asks for this). Format: AGENTS.md §6.

  How to keep it:
  - Status line: update it at every Wrap up. "Current prompt" = the next prompt to run. "Last verified" = the newest prompt
    whose Verify passed. "Blockers" = anything that stops the next prompt ("none" otherwise).
  - Each prompt starts as "· [ ] to do". When its Verify passes and every acceptance criterion is proven, replace that with
    "✅ (YYYY-MM-DD)" and fill every bullet: evidence is command + result, file path or URL.
  - Lettered parts are separate prompts in the build order (P04 → P04b → P05, 07 D157; P05 → P06, since P05b is Later and in no Step 0 chain; P10a → P10b → P10c → P11 → P11b → P11c → P12;
    P19 → P19b → P19c → P19d → P19e → P19f → P19g → P20 → P20b → P21; P21 → P21b → P22; P22 → P22b → P22c → P22d → P22e → P22f →
    P22g → P22h → P23; P25 → P25b → P25c → P25d → P26; P28 → P28b → P29; 07 D130). Each one's Step 0 checks the one above.
  - Optional hardening prompts (P31a–P33c) the owner skips: replace "· [ ] to do" with "· skipped (YYYY-MM-DD, owner)".
    The next Step 0 then checks the latest completed prompt instead.
  - "Record:" lists what this prompt's Wrap up asks for and what the next prompt's Step 0 looks for here, on top of the
    five usual bullets. Missing it makes the next prompt stop.
  - A conflict that docs/07-decisions.md settles is not a stop: follow 07 and note it under that prompt's Decisions.
  - The owner answered OQ-01–OQ-33 on 2026-10-15, revised OQ-21 and OQ-29 and added OQ-39 and OQ-40 on 2026-10-16 (07 §4.1, §8),
    answered OQ-41–OQ-48 the same day (07 §4.1, §9; the exclusive and renewal rules are `docs/08-exclusive-renewals-owner-spec.md`), and
    answered OQ-34–OQ-38 and OQ-49–OQ-53 the same day (07 §4.1, §10), and asked for a fully responsive app on 2026-10-18 (OQ-54; 07 §11,
    D144–D158: layout only), then answered OQ-55 and OQ-56 the same day (07 §12, D159–D160) and OQ-57 (07 §12.3, no new decision). Prompts never ask them again; they are listed below as answered.
    New questions get the next free number (Q-06, …; Q-01–Q-03 were asked in P02 and Q-04–Q-05 in P04, all answered).
  - Commands are always `bun run <script>` (Bun 1.4.3 as package manager only, Node 24 runtime; AGENTS.md §9, 07 D107).
  - Later prompts (outside the totals, 07 D105) have their own section after the Log, "## Later prompts": P34 (USD) runs last and
    only when the owner adds USD; P05b (teens) stays "not scheduled".
  - Money in this file is written with its currency (`CA$1,732.50`), never a bare `$` (07 D98).
  - Copy every judgment call into the Decisions table, which lives in progress/decisions.md since 2026-10-29 (audit D5);
    finished logs P00–P16 are in progress/log-P00-P16.md, their open follow-ups under "Follow-ups from archived logs".
  - Gates are signed off only after the owner says so in chat.
  - Never write secrets, OAuth tokens, sign-in codes, buyer emails or signed URLs in this file.
-->

## Status
Current prompt: P19b · Last verified: P19 · Blockers: none
Gates: A (P22) [ ] · R (P22h) [ ] · B (P25) [ ] · C (P27) [ ] · S12 Stripe renewal sign-off (P25d, not a gate) [ ]
Later: P34 (USD) not run · P05b (teens) not scheduled

## Log

Finished prompts P00–P16 and the reviews between them are in `progress/log-P00-P16.md` (archived 2026-10-29, audit
D5); their follow-ups for prompts still to do are under "Follow-ups from archived logs" below. P17 on stays here.

**M4 Buyer checkout** · P15–P17 · 7.5 h (P15–P16b archived)

### P17 — Buyer status, creator inbox and request emails (J7 proof) ✅ (2026-10-29)
> 120 min · Depends on: P16 (P16a + P16b) · Record: email copy; `formatEmailDateTime` goldens (OQ-19 answer: recipient zone + UTC)
- Done:
  - **Step 0** (Q-88): `bun run check:step0 tests/e2e/license-page.spec.ts tests/e2e/license-page.responsive.spec.ts` → typecheck, lint, token lint and unit (3252) green; integration and e2e not re-run (the code was that of the last green `check:full`). The four `export async function` greps print 4 lines; `scripted-payments` isn't in `src`; `update(licenseRequest)` sets `status` only in `state-machine.ts`; `email_log` has `recipient_hash`, the unique `idempotency_key`, `attempts` and `status`; `tests/helpers/read-latest-email.ts` exists and sign-in codes land in `.data/emails`; the seven primitives exist; the dev database's P16b request is `awaiting_approval` on `cad` with a 72.0 h window and `pi_fake_…`.
  - **Audit:** 4 readers (the outbox and templates, the buyer side, the creator side, the tests), each checked by a skeptic, over the prompt, 01–08, later prompts' Step 0 greps and the code. Owner answers Q-124–Q-128 in chat, all a (Decisions).
  - **Outbox** (`src/server/email/send.ts`, 02 §5.10, 07 D34): `recipientHash` (sha256 of the normalized address); `queueEmail(tx, …)` (ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, `provider` from `activeEmailProvider()`, so a queue insert never builds a driver); `sendQueuedEmails(ids)` and `retryEmailOutbox({ limit })` (queued rows untouched for 2 min and failed rows with attempts < 3, oldest first; returns the number sent) share one `sendRow`: a claim (`attempts + 1`, status `queued`, `updated_at = now()`, fenced on the attempts read and on being due) held as a 2-minute lease, the message composed from the entity now, the hash checked, `renderEmail` (html + text, `src/emails/render.ts`), `driver.send(…, { idempotencyKey })`, then `sent` (`sent_at`, `provider`, `provider_message_id`) or `failed` with a code, fenced on the claim's attempts. Codes only, never a message: `recipient_mismatch` and `entity_missing` (final: attempts 3), `token_unreadable`, `compose:<Error>`, `send:<Error>`; log lines `email.send_failed` with the row id and template. `EmailDriver` names its `provider` and returns `{ providerMessageId }` (console: null). `src/server/email/request-emails.ts`: one join for both emails' facts, `requestEnvelope` (recipient, subject) and `composeRequestEmail` (the buyer's link through `revealBuyerToken`, the creator's `requestDetailPath`). `applyTransition` queues `request-new` and `request-received` on `authorized` in its transaction (`EMAILS` table) and returns them as effects; `runEffects` (`src/server/licensing/effects.ts`) runs after the commit in `markAuthorized` and in `onWebhookEvent`'s own transition, through `afterResponse` (after(), logged and dropped outside a request); fake Pay schedules `retryEmailOutbox({ limit: 20 })`.
  - **Templates** (`src/emails/`): `components/email-layout.tsx` (text wordmark, headline = subject, paragraphs, the context block (title, scope), one table-wrapped ink button with "Or open: {url}", the footer by audience, "Test mode. No real money moved."), `components/styles.ts` (05 §8 hex; the sign-in email uses it too), `request-copy.ts`, `request-received.tsx`, `request-new.tsx` (the payouts line while payouts aren't active). `formatEmailDateTime` in `src/lib/format.ts` (07 D84 goldens). Subjects in `subjects.ts`, never a link or key.
  - **Queries** (`src/server/licensing/queries.ts`, DTO types in `src/lib/licensing/request-dto.ts`): `getBuyerStatus` (a pure read through `findRequestForBuyer`; the poster only while the video is public), `listInbox(creatorId, view)` (Waiting by `expires_at`; History the 20 newest of the four decided statuses with `license.code`), `getRequestForCreator` (uuid guard; the five creator statuses only), `waitingSummary` (count and soonest deadline, React `cache`). Fields mapped one by one: never the buyer's email, key, IP, user agent or Stripe ids. `displayStatus` (`src/lib/licensing/transitions.ts`): `processing` only for a claimed waiting row, no clock. `getBuyerRequest` keeps the return's reconcile, then reads `getBuyerStatus`.
  - **/r** (S03): `requestView` and `VIEW_COPY` cover every 01 §4.8 status (approved, declined, `video_disabled`, expired, capture_failed with the way back; renewal rows 404). One client `RequestStatusView` (`src/components/license/request-status-view.tsx`) holds the h1 and body for every view: a status change cross-fades (`animate-cross-fade`, 250 ms, a new token) and moves the focus to the new title (`FocusedHeading`, back at the top first), never on first load; deadlines in the viewer's zone after mount (`useViewerDeadline`); "Finishing checkout…" keeps P16b's 3 s × 10 (`useCheckingRefresh`, the hook `refreshing-message.tsx` now exports). Waiting: a neutral `CountdownChip` (or "Processing…" for a claimed row), "This page updates by itself.", `AutoRefresh` (`src/components/layout/auto-refresh.tsx`: every 30 s, window focus and visibilitychange, `onRefresh` and `restart` for P18). `RequestSummary` on every state: 48 × 64 `PosterThumb`, title, @handle, Scope and Total (Q-126 a), hairline border (canvas and surface are both white).
  - **Inbox** (S14, `src/app/(dashboard)/dashboard/page.tsx`): the two-tone h1, `SegmentedControl` "Waiting {n}" · "History" (equal-width grid columns, labels never wrap), the payouts Banner (`FinishPayoutsBanner` warns with the soonest deadline while a request waits, 07 D77), then `InboxList` (client, keyed by view, the one refresher) or the `EmptyState` body (no title: "No requests yet…" with Copy link or "Make a video licensable"; History "No decided requests yet.", Q-127 a). `InboxRow` stacks below md and is a grid from md (the countdown top-right on the name's line, Details bottom-right on the third line, the facts full width under the row); History rows show the price, the pill, the code and the 04 §11.5 line. `RequestFacts`, `RequestStatus`, `RequestOutcome`, `PayoutsWaiting` in `src/components/inbox/`. `Disclosure` gains an `actions` slot (the trigger once per tier when actions exist, so the tab order follows each tier) and grid hooks; `EmptyState`'s title is optional. The NavBar and TabBar badge: the layout's `waitingSummary`, kept current on client navigation by `InboxCountProvider` and the page's `SyncInboxCount` (`src/components/layout/inbox-count.tsx`).
  - **Request detail** (S15, `src/app/(dashboard)/dashboard/requests/[id]/page.tsx`): uuid guard, `requireCreator`, `notFound()` for anything not the creator's; ‹ Inbox, the heading "{licensee} wants to license {title}", the countdown or the pill and its line, the facts card (Payment and Answer by only while waiting; You get while waiting or approved, Q-128 a), the payouts `Notice` while a waiting request waits on payouts; one left-aligned 640 px column; tab title "Inbox".
  - **Review:** a 4-area workflow (the outbox, the reads and privacy, /r, the Inbox and e2e), each area's findings checked by a skeptic: 6 confirmed, fixed: two senders could send one row (the claim now holds a 2-minute lease and only its sender records the outcome; a test that blocks a send in flight fails on the old claim); the badge went stale on client navigation (layouts don't re-render; the Inbox page now updates it); the focus move didn't scroll the new title into view; from md Details sat on its own line (now the row's third line); the Disclosure's tab order below md once actions exist (the trigger once per tier); no test rendered the empty Inbox, the empty History or the no-video branch. Refuted: no attempts cap for a queued row whose sender died (D34 caps failed rows), stale waiting emails after a decision (no decision exists before P18; recorded below), no backoff on failed rows (02 §5.10), `effectiveStatus` unused (P16b's, kept for P19), the page wiring untested, a decided request's line, `SegmentedControl` in a block container.
  - **Simplify (owner request, before this commit):** 4 reviewers (reuse, simplification, efficiency, altitude), each angle's findings checked by a skeptic: 27 findings, 9 distinct cleanups applied, no behaviour or copy change. `RequestStatusView` mounts `FocusedHeading` for a changed title (the keyed block remounts with it) instead of its own scroll-and-focus effect, and `MessageBody`'s now unused `icon` prop is gone; one `sentences(...)` helper (`src/lib/format.ts`) builds every sentence list that leaves out a deadline not yet known (waiting, expired, Answer by, the payouts message, the expiry line); `DEADLINE_VIEWS` is gone (the bodies that name no deadline ignore it); `requestPill`'s "Processing…" is `REQUEST_STATUS_COPY.processing`; `CREATOR_STATUSES` is `["awaiting_approval", ...HISTORY_STATUSES]`; `emailDriver()` switches on `activeEmailProvider()`, the one reader of `RESEND_API_KEY`; the request page reads one nullable `payoutsDeadline`; `requestLicense(page, url, choice)` in `tests/e2e/helpers/buyer.ts` drives the license form for both `requestDemoLicense` and `buyLicense`; the outbox test reads the handle, title and deadline from its fixture instead of three SQL helpers. Skipped: one join builder for the buyer and creator reads (P19b adds a join to the creator's only; a builder generic over the columns didn't type in P17's build), a shared Set up payouts link (P19b points the Banner's elsewhere), the buyer email reusing /r's waiting sentence (P19c's auto wording differs per surface), the Inbox route from `CREATOR_NAV` (Q-126 a's copy), a per-batch facts cache in the sender (02 §5.10: each row read as it is now), a second UTC day format folded into the first, the reconcile's read order, a memoized viewer zone.
  - **Tests:** unit `format.test.ts` (D84 goldens, the fall-back hour, ASCII), `request-emails.test.tsx` (both templates, the payouts line, Kolkata, subjects), `console.test.ts` (provider, result), `request-status.test.ts` (every status → view, title, body, way back; renewal statuses 404), `transitions.test.ts` (`displayStatus`), `request-status-view.test.tsx`, `auto-refresh.test.tsx`, `refreshing-message.test.tsx` (the hook), `countdown-chip.test.tsx` (neutral below 6 h), `inbox.test.ts`, `inbox-row.test.tsx` (rows and `RequestFacts` per status), `finish-payouts-banner.test.tsx`, `disclosure.test.tsx`; [int] `email-outbox.test.ts` (16: queueing in the transaction and its rollback, replay, abandoned, sending to the right people with the buyer's `t=` passing `findRequestForBuyer`, Pay through the action, concurrent senders, a send in flight, a dead sender's lease, failure and the 3-attempt stop, recovery, the 2-minute rule, `recipient_mismatch`, `token_unreadable`, the payouts line), `inbox-queries.test.ts` (13), `authorization.test.ts` (after() mocked, `tests/helpers/after.ts`), `start-checkout.test.ts` (the full buyer DTO); e2e `request-received.spec.ts` (both projects: the empty Inbox and History, buyLicense, /r, both emails and the buyer link, the badge after a client navigation, the Inbox row, Details, the request page, no buyer address in text or HTML, no bare $), `inbox.responsive.spec.ts` (all four projects), `license-page.spec.ts` (X-Robots-Tag on the dead link), `onboarding.spec.ts` (the no-video empty Inbox). Helpers: `buyLicense` and `publishDemoVideo`'s `email` in `tests/e2e/helpers/flows.ts`, `requestLicense`, `fillDetails({ email })` and `E2E_LICENSEE` in `buyer.ts`.
- Verified: `bun run typecheck` ✅ · `bun run lint` ✅ · `bun run lint:tokens` ✅ (prints nothing) · `bun run test` ✅ (158 files, 3346 tests; 3345 after the simplify pass dropped `DEADLINE_VIEWS`' test) · `bun run test:int tests/integration/email-outbox.test.ts tests/integration/inbox-queries.test.ts tests/integration/authorization.test.ts tests/integration/start-checkout.test.ts` ✅ (16 + 13 + 36 + 22) · one `bun run test:e2e` of `request-received`, `inbox.responsive` (all four projects), `license-page`, `license-page.responsive`, `onboarding`, `onboarding.responsive` and `sign-in` ✅ (88 passed) · `bun run check:full` ✅ after the review fixes (lint 695 files; 3346 unit; 659 integration in 36 files; 255 e2e passed, 3 skipped by project), again after the simplify pass (lint 695 files; 3345 unit; 659 integration in 36 files; 255 e2e passed, 3 skipped by project), and last after deleting `WaitingBody` (Q-129 a: lint 693 files; 3342 unit in 157 files; 659 integration in 36 files; 255 e2e passed, 3 skipped by project), recorded in `.data/last-green`. A mutation check: the in-flight-send test fails with the old claim (status left `failed`) and passes with the lease.
  · Verify on the dev server (`--demo`, maya): a manual Pay at 390 × 844 → `/r` "Waiting for @maya", the hold with the deadline in the viewer's zone, a neutral "Expires in 2 d 23 h", "This page updates by itself." and the summary card; dark mode at 390; the emailed link opens the same `/r`; a window focus refreshes it (one RSC request). `email_log`: `request-received | sent | 1 | request-received/<id>` and `request-new | sent | 1 | request-new/<id>` (console, no error); `ls -t .data/emails` lists the two request emails first; their text: the creator's deadline in maya's zone (UTC), no payouts line (maya's are active), the buyer's in America/Toronto with UTC. `curl -sI` on the emailed link: 200, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`; with a wrong key, 404 with both. Signed in as maya: `/dashboard` "Inbox. 2 waiting for you.", rows soonest first, the TabBar badge, Details, Open request → the request page with its facts; the wide row at 1280; no horizontal scroll at 390. Amber: with `expires_at = now() + 5 h` the creator's chip is `bg-awaiting-tint` ("Expires in 4 h 59 min") and the buyer's stays `bg-fill`; the deadline was put back to 72 h. `bun run email:dev` doesn't exist (skipped).
- Decisions: see the Decisions table (2026-10-29, P17).
- Open questions: none (Q-129 a: `WaitingBody` and its test deleted).
- Follow-ups for later prompts: **P18**: queue `license-approved` with `queueEmail` after `issueLicense` (not the `EMAILS` table); Approve goes in the row's `Disclosure` `actions` (null today) and in the request page's action spot under the card; `InboxList` keeps a settled row through `useAutoRefresh`'s `onRefresh` and `restart`; focus to the row's `[data-row-status]` (tabIndex -1); the 40 px `ClearedSeal` on /r's approved view is P18's own task, and "keep P17's Get file and license link" doesn't apply (P17 renders none); History's "View license" link waits for P20's `/dashboard/licenses`; decide whether a request-new or request-received retry after the decision still sends (review), keeping P19c's auto-approve request-received. **P19**: Decline in the same slot; lazy expiry and the overdue display (its question 1: P17 keeps an overdue request waiting at "Expires in 0 min"); `reconcileStuckClaims` on /r, the Inbox and the request page; `retryEmailOutbox` (returns the number sent) in the cron; `request-declined` on `EmailLayout` and `REQUEST_EMAIL_COPY`. **P19c**: the DTOs gain `autoApprove` and `autoApproveFallbackAt`; `EMAILS` becomes a function of the row for auto-approve; `tests/helpers/after.ts` gains its queue mode; "Processing…" can reuse `useCheckingRefresh` and `AutoRefresh`. **P19g**: /r's exclusive row and lines (05 §4.3 callouts 10–11; no prompt builds them) and `exclusive_conflict`. **P20**: /r's Get file and license button; History's View license. **P22b**: `getBuyerStatus` should 404 a row whose `origin <> 'checkout'`. **P26**: subjects use curly quotes around the title (05 §8's tables write straight ones); the Resend driver returns `providerMessageId` and its `provider`; `sendRow` records the sending driver's provider. **Plan-kit fixes:** P17 Step 0 item 5 expects `72:00:00` (Postgres prints `3 days`); P17 Step 0 item 2 and Verify run commands AGENTS §2 replaces (`check:step0`, one `test:e2e`); P17 says the console driver writes `<iso>-<template>.json` (it is `<iso>-<6 hex>-<template>.json`); 04 §9.11's per-row payouts Notice with a secondary button is superseded by 05 §6.3 callout 15's one Banner; P19g's e2e expects /r "Exclusive request" with no task building it; 01 J8.10 paraphrases the `video_disabled` body (01 §4.8 is used).

### Review — Audit batch 1 ✅ (2026-10-29)
> Not a plan prompt: the owner asked for a full engineering, architecture and QA audit (three documents in `audit/`, deleted at the owner's request after the simplify pass below; IDs such as A1–D5, QW-n and AUDIT-0nn in these entries are their labels), then said "Start batch 1". Nothing in P18's scope was started. Status line unchanged.
- Done:
  - **A1 withdrawn (07 settles it):** the audit's top finding asked for a fake payments driver that refuses out-of-order capture/cancel and tracks idempotency keys; 07 D35 (restated in D76, D125) decides the fake answers ok to every call and fault injection lives only in the scripted double, and P19 Task 6 builds the scripted capture/cancel matrix. AUDIT-001 corrected to Low in the report.
  - **A2, buyer details out of the logs (02 §9.9, 07 D47):** `src/server/action-errors.ts` `rethrowRedacted(error, event)`: Next's redirect/notFound pass (`unstable_rethrow`), anything else is logged through `logEvent` (which keeps only a query error's pgCode and constraint) and a plain `Error(event)` with no `cause` is thrown instead, so Next never logs a `DrizzleQueryError` message with the insert's bound values. Used around `createLicenseRequest` in `startCheckout` (`license_request.start_failed`) and `payFakeCheckout` in `fakeCheckoutPay` (`fake_checkout.pay_failed`). The session and database reads of `uploadRoute`, `imageRouteResponse` (`social.image_failed`, 404), `posterResponse` (`posters.lookup_failed`, 404) and connect start (`social.connect_start_failed`, 500 no-store) moved inside a logged catch; `streamPlatformImage` logs a non-`RangeError` failure instead of a silent 404; onboarding's `checkHandle` uses `safeParse` (a crafted input gets the length line, not a 500).
  - **A3, the pool:** `src/db/client.ts` `POOL_MAX = 10` (pg-pool's default, written out) and `POOL_CONNECT_TIMEOUT_MS = 10_000`: a query that can't get a connection fails after 10 s instead of waiting until the function is stopped.
  - **A4, one event delivered twice at once:** three [int] cases (authorize, abandon on a failed assert, expire) deliver the same event concurrently behind a held row lock: one transition, at most one cancel, `attempts = 2`, `processed_at` set, no duplicate email keys. Today's claim takes an unprocessed event again (AUDIT-014); applyTransition's lock and guard keep it safe, and these tests pin that before P18/P19.
  - **A5, the gates:** `bun run lint:invariants` (`scripts/lint-invariants.ts`, TypeScript syntax tree over `src`): `status-write` (license_request.status only in `state-machine.ts`), `payments-in-tx` (no call bound to `src/server/payments/{index,registry,connect}` inside a `.transaction(` callback; helpers it calls aren't followed), `postings-fetch` (no `fetch` under `src/{server,lib}/postings`, 07 D67), `vitest-in-src` (only test files import vitest). `scripts/check.sh`: the fingerprint adds `.env.test` and `.env.test.local` (content hash only) and the Node and Bun versions; `fast()` adds the invariant lint and a schema-drift check (`drizzle-kit generate` into a copy of `drizzle/` under `.data/schema-drift`, which must find nothing to write); the test database is migrated before integration in `check:full` and in a `check:step0` that runs it. `scripts/test-db.sh` pins `postgres:18.6`. AGENTS.md §2 test commands updated.
  - **B1:** `countLiveVideosByAccount` also filters `video.creator_id` (equal to the posting's by the composite FK), so `video_creator_status_published_idx` can start the join from the creator's own published videos.
  - **C1:** `StorageDriverName` (unused) removed; `unrs-resolver` (not in `bun.lock`) dropped from `ignoreScripts`; the five test fixture modules under `src/` (two of which import vitest and call `vi.mock`) moved to `tests/helpers/` (not `tests/fixtures/`, a `forceRerunTriggers` path).
  - **Mutation checks:** the old `startCheckout` fails `start-checkout-action.test.ts` (the DrizzleQueryError reaches Next); six planted violations (three payments calls in a transaction, a literal and a non-literal status write, a fetch in postings) each fail `lint:invariants`, while a payments call after the transaction and a session-id update pass; a planted schema index with no migration fails the drift check.
  - **Tests added:** unit `src/server/action-errors.test.ts` (2), `src/server/storage/upload-http.test.ts` (1); [int] `tests/integration/start-checkout-action.test.ts` (2), `db/pool-errors.test.ts` (+1, fake timers), `authorization.test.ts` (+3).
- Verified: `bun run typecheck` ✅ · `bun run lint` ✅ (698 files) · `bun run lint:tokens` ✅ (prints nothing) · `bun run lint:invariants` ✅ (prints nothing) · schema drift ✅ ("No schema changes") · `bun run test` ✅ (159 files, 3345 tests) · `bun run test:int` ✅ (37 files, 665 tests) · the three concurrent-delivery tests 10/10 runs ✅ · `bun run check:full` ✅ in 4 min 31 s (lint 698 files; 3345 unit; 665 integration in 37 files; 255 e2e passed, 3 skipped by project), recorded in `.data/last-green`. The first `check:full` lost one e2e test, `upload.responsive` G.6 on webkit-iphone, in the sign-in helper before anything this batch touched: the page showed the email field's own "Enter an email address like name@example.com." (a fill before hydration), not a server error; the rerun passed.
- Decisions: see Decisions (2026-10-29, Review).
- Open questions: none.
- Follow-ups for later prompts: **P19**: write the scripted double's capture/cancel outcomes consistent with Stripe's state rules (no successful capture of a canceled PaymentIntent; audit AUDIT-001). **P19f**: re-read the video's status, `disabled_uses` and base price under `lockVideoForLicensing` in T1 and re-price before the insert (audit A6, AUDIT-004). **P25**: a lease on the payment-event claim and an `in_progress` answer the webhook route returns as non-2xx (AUDIT-014). **Before P26**: back off email retries (A9). **Before P27**: abort signals through the sync contract and a body cap in `fetchJson` (A8). **Before P30**: Neon role `statement_timeout` / `idle_in_transaction_session_timeout` (owner, A3). **Tests**: `tests/e2e/helpers/sign-in.ts` `requestCode` can fill the email before hydration on WebKit (seen once here); wait for the field to hold the value before Email me a code.

### Review — Audit batch 2 ✅ (2026-10-29)
> Not a plan prompt: the owner said "Do batch 2" (the audit's batch 2: B2, B3a/b, B4, A7, A9, C2, C3 and the stream fixes), then answered Q-130 (B4: pause while hidden) and Q-131 (A9: defer to P26). Nothing in P18's scope was started. Status line unchanged.
- Done:
  - **B2, in-app links:** the Library tile's link and its tertiary action, the Library empty state's "Or upload a video" and the IG explainer's upload link are `next/link` (the tiles with `prefetch={false}`: a grid holds dozens), so an upload running in the tab carries on (owner answer Q-42) instead of a "Leave site?" and a reload; the P14b follow-up about a plain-`<a>` tile tap lost during hydration goes with it. `SHELL_PREFETCH` (off since P02, "until every route exists") became `shellPrefetch(key)`: Next's default for every shell link, none for Licenses until P20 builds `/dashboard/licenses`; Wordmark's unused `prefetch` prop removed.
  - **B3, client bundles:** `src/lib/upload/resume.ts` checks the resume hint by hand (`isResumeHint`: exactly the four fields, the same rules) instead of a Zod schema, the only Zod import the dashboard layout's client graph had; `SessionRefresh` and the Sign out controls `import()` the Better Auth client when they use it.
  - **B4, hidden tabs (Q-130):** `useAutoRefresh` skips its 30 s tick while `document.visibilityState` is `hidden`; focus and visibilitychange already refresh on return.
  - **A7, Disconnect during a posting check or write (03 §9.3):** `lockConnectedAccounts(tx, ids)` (`src/server/postings/ownership.ts`, `FOR SHARE`, still `connected`). `verifyPostingLink`'s post write runs in a transaction under it (a Disconnect during the platform call leaves the link `check_failed`, its post no longer comes back `available` in the Library); the save and Check again transactions take it after the video lock and turn a fresh Verified check through an account disconnected since into `check_failed` (no FK error on a post Disconnect deleted); Make licensable takes it first and refuses with `NeedsReconnectError`. Lock order video → account → post, as sync and Disconnect take account → post.
  - **C2:** `ownedVideo(creatorId, videoId)` (`src/server/videos/scope.ts`) replaces the 14 written-out `and(eq(video.id, …), eq(video.creatorId, …))` and lifecycle's local `own`.
  - **C3:** `EMAIL_RE`, `EMAIL_MAX` and `EMAIL_MESSAGE` live in `src/lib/validation/email.ts`; the license page's details, StartCheckoutSchema and `SIGN_IN_COPY` read them, and the sign-in form tests `EMAIL_RE` instead of `zod/mini`'s `z.email()` (the same pattern, so no behavior change; details.test still compares the two).
  - **Streams:** `readCapped` cancels the reader when a read or `onChunk` fails; the local driver's `receivePart` cancels a refused part's body (an unknown upload, a bad key or part number); the dev storage route treats HEAD as GET and answers 405 to any other method instead of reading it as a PUT.
  - **A9 deferred (Q-131):** email retry spacing goes to P26 (follow-up below).
  - **Found on the way (B2):** the first `check:full` lost `make-licensable` J5.1–J5.5 (chromium-desktop, then 1 in 9 to 5 in 30 when repeated). With the tile a client link, the connect step's "Demo connected." toast (Radix Toast, in the root layout) is still up on the Source page, and an Esc pressed within milliseconds of the explainer sheet opening reaches the toast, whose Esc listener Radix removes one render later, so the toast closed and the sheet stayed. A temporary probe (deleted) showed the toast closing in 16 of 30 runs; Esc 300 ms after the sheet opened closed the sheet 20 of 20. No person presses that fast, so the spec now closes the leftover toast with Esc first (deterministic, no wait) and then checks the sheet's Esc; 30 of 30 runs passed.
  - **Mutation checks:** without A7's four source changes the three new Disconnect tests fail (a verified posting and an `available` post; a 23503 FK error; a draft written).
  - **Tests added:** unit `auto-refresh.test.tsx` (+1, hidden then shown), `read-capped.test.ts` (cancel after an `onChunk` error), `dev-route.test.ts` (+1, 405), `local.test.ts` (+1, refused part bodies cancelled); [int] `postings.test.ts` (+3, Disconnect during the check, between the check and the save, during Make licensable); e2e `upload.spec.ts` (+1, the Library's in-app link keeps the upload: no dialog, the card carries on to Upload complete).
- Verified: `bun run typecheck` ✅ · `bun run lint` ✅ (699 files) · `bun run lint:tokens` ✅ · `bun run lint:invariants` ✅ · schema drift ✅ · `bun run test` ✅ (159 files, 3348 tests) · `bun run test:int` ✅ (37 files, 668 tests) · the new Disconnect tests fail without A7's source changes ✅ · `make-licensable` J5.1–J5.5 30/30 runs ✅ · `bun run check:full` ✅ in 4 min 39 s (3348 unit; 668 integration in 37 files; 257 e2e passed, 3 skipped by project), recorded in `.data/last-green`, after a first run lost J5.1–J5.5 (Found on the way). Bundle, from that build's client-reference manifests: the dashboard layout's entry (8 files, 91 KB gzip) holds no Zod and no Better Auth client chunk; Zod now loads only on pages whose own client components import it (Library, Connections, Pricing, Videos, a video, the title page, onboarding), and no longer on the Inbox, a request, Settings or sign-in.
- Decisions: see Decisions (2026-10-29, Review batch 2).
- Open questions: none (Q-130, Q-131 answered).
- Follow-ups for later prompts: **P26**: space out email retries, e.g. `failed` rows due again only `attempts` minutes after their last try, and write the retry test around it (Q-131; audit A9). **P20**: when `/dashboard/licenses` exists, `shellPrefetch` can drop its Licenses exception. **Later (audit B3)**: the Library, Connections, Pricing and Videos pages still load Zod through their own client components; worth a look when those forms are next touched.

### Review — Audit batch 3 ✅ (2026-10-29)
> Not a plan prompt: the owner said "Do the last batch" (the audit's batch 3: C6, B3c, B6, D5 and the Neon timeouts), then answered Q-132–Q-135. Nothing in P18's scope was started. Status line unchanged.
- Done:
  - **Zod 4.6.6 (Q-132):** `package.json` and `bun.lock` (the patch for GHSA-mrhx-c7xc-m3w5, published 2026-10-11; `bun pm untrusted` lists nothing). 02 §1 still says 4.6.5. `bun audit` still lists the advisory for the zod 4.1.11 that better-auth's `@better-auth/core` and `@vercel/functions` bring with them: an `overrides` entry would lift those too (not done: not asked).
  - **tsconfig (Q-132):** `target` ES2022 and `allowJs` false (create-next-app leftovers; no JS file exists). Next keeps both (it adds only missing suggested options).
  - **`bun run email:dev` (Q-132; 02 §11.1, P33b):** `email dev --dir src/emails/previews --port 3001`. The templates have named exports and no sample props, so `src/emails/previews/` holds one default-export preview per template (sign-in code, request-new with payouts not set up, request-received; the demo request's values, placeholder links). Checked in the browser pane: all three render, no console errors.
  - **B3c, class merging compiled ahead (Q-133):** `bun run cn:tables` (`scripts/cn-tables.ts`, `cn/build` with `--full`, no stylesheet, the type scale as font sizes: exactly cn/config's runtime config) writes `src/lib/cn-tables.ts` (generated, 14 KB, excluded from Biome); `cn` is `createCn(tables)` from `cn/engine`; `TYPE_SCALE` moved to `src/lib/type-scale.ts`. Same merges: 40,000 random combinations of the 24,292 class names in `src` gave 0 differences from the runtime cn. `cn-tables.test.ts` fails when the committed tables differ from a fresh build (Vitest re-runs everything when the file changes). Seen on the way: tables that also read globals.css' theme would merge `max-w-app`/`max-w-reading` and `shadow-overlay`/`shadow-none`, which cn keeps both of today; not taken (a behavior change).
  - **D5, PROGRESS.md (Q-135):** 600 KB → 108 KB. Finished logs P00–P16 (and the reviews among them) moved word for word to `progress/log-P00-P16.md`, the Decisions table to `progress/decisions.md`; their 27 "Follow-ups for later prompts" lines are copied under "Follow-ups from archived logs". AGENTS.md §2 Step 0 and §6, and this file's header, say where things are.
  - **B6 deferred (Q-134):** the `social_post.fetched_at` index stays until P27 (follow-up below).
  - **Neon timeouts (A3):** not applied (the owner's Neon project); the SQL is a P30 follow-up below.
- Verified: `bun run typecheck` ✅ · `bun run lint` ✅ (705 files) · `bun run lint:tokens` ✅ · `bun run lint:invariants` ✅ · schema drift ✅ · `bun run test` ✅ (160 files, 3349 tests) · `bun run test:int` ✅ (37 files, 668 tests) · `bun run check:full` ✅ in 4 min 59 s (3349 unit; 668 integration in 37 files; 257 e2e passed, 3 skipped by project), recorded in `.data/last-green`; Next's build left tsconfig.json as written · `bun run email:dev` in the browser pane: the three previews render, no console errors · `bun audit`: the direct zod is clean; the advisory remains for the transitive 4.1.11 · First-load client JS, gzip, measured on two builds that differ only in `src/lib/utils.ts` (cn/config before, the prebuilt tables after): the license page 99.9 → 68.7 KB, the Inbox 122.6 → 90.8 KB, the Library 154.3 → 122.4 KB, `/` 67.4 → 36.1 KB, sign-in 83.7 → 69.3 KB (sign-in, /admin and the fake checkout load two chunks that each carry the tables; the other 21 routes one); no chunk contains the cn compiler.
- Decisions: see Decisions (2026-10-29, Review batch 3) in `progress/decisions.md`.
- Open questions: none (Q-132–Q-135 answered).
- Follow-ups for later prompts: **P27**: replace `social_post_fetched_at_idx` (btree) with a BRIN index or none when the 30-day purge is built: today 0 of 22,135 test-DB updates of `social_post` are HOT because every sync rewrites `fetched_at` (audit AUDIT-010, Q-134). **P30**: before the deploy, on Neon, per app role: `ALTER ROLE <app_role> SET statement_timeout = '15s'; ALTER ROLE <app_role> SET idle_in_transaction_session_timeout = '30s';` (both above the token refresh's 12 s lock wait plus its 10 s call; migrations through the unpooled URL need `SET statement_timeout = 0` or another role; confirm Neon's pooler passes role settings), audit A3. **Any time (owner)**: an `overrides` entry for zod 4.6.6 would clear `bun audit`'s remaining high advisory (better-auth's and @vercel/functions' copies).

### Review — Simplify pass over the audit batches ✅ (2026-10-29)
> Not a plan prompt: the owner ran `/simplify` on the uncommitted batches 1–3, then asked for the `audit/` folder to be deleted. No behavior or copy change. Status line unchanged.
- Done:
  - **Review:** 4 reviewers (reuse, simplification, efficiency, altitude) over the batches' code diff (92 files).
  - **Redaction at the right depth:** the session reads (`readSession`, `getCreatorContext` in `src/server/auth/session.ts`) rethrow a failed query through `rethrowRedacted` (renamed from `action-errors.ts` to `src/server/rethrow-redacted.ts`; it lets Next's redirect, notFound and dynamic-rendering errors through), so every page, action and route that reads the session is covered and the two per-route catches batch 1 added (image proxy, connect start) are gone. `startCheckout` and the fake Pay use `.catch(… rethrowRedacted …)`. Onboarding's `checkHandle` schema falls back with `.catch({ handle: "" })` instead of a hand-built answer.
  - **Simpler:** `scripts/cn-tables.ts` compiles in memory (`cnTablesSource()`: `compileToSource(mergeConfigs(defaultConfig(), …))`, the same compile `cn build` runs) instead of a temp config file, and the drift test compares strings (no temp dir; it imports the tables, so the Vitest re-run trigger is gone; 40,000 merges still identical). `save.ts`' lock-and-settle glue is one `settleDisconnects(tx, checks)`, using verify's `unverified()`. The resume-hint guard counts four keys. `lint:invariants` skips files without any rule's word before parsing and builds each line in one place (the planted-violation check passes again). `POOL_MAX` is gone (`max: 10` inline; the pool test reads `pool.options.max`).
  - **Test migrate:** `startTestRun` (`tests/helpers/test-run-lock.ts`) applies pending migrations with drizzle's node-postgres migrator on the lock's connection before emptying the database, so every `test:int` and `test:e2e` run is on the current schema; `check.sh`'s own migrate step is removed (AGENTS.md §2 updated).
  - **Tests:** reuse `captureLogEvents`, `pgError`/`wrapped` (now taking a query and its values), the demo request fixture, `postsOf`, `CONNECTED_TOAST` (exported) and one `bothQueuedOnRow` helper for the two lock-ordered event races. The batch 2 upload e2e test is folded into the Q-42 test it repeated (one setup fewer). make-licensable no longer asserts the toast is still up before its Esc (the toast can time out first). A unit test fails when `shellPrefetch` and the pages under `src/app/(dashboard)` disagree, so P20 has to drop the Licenses exception.
  - **Skipped, with reasons:** an `instrumentation.ts` console patch redacting every error (global, risky in dev and prod output); `upsertPosts` returning ids (changes the shared sync contract and its test for about 1 ms per verified link); writing a verified post inside the save's own transaction (restructures verify); one `whileConnected` shared with sync's `whileStillMine` (different checks); Biome rules for two invariants (keeps the §5 rules in one script); a runtime AsyncLocalStorage guard for payments calls in transactions (optional).
- Verified: `bun run typecheck` ✅ · `bun run lint` ✅ (706 files) · `bun run lint:tokens` ✅ · `bun run lint:invariants` ✅ (and the seven planted violations still each fail it) · schema drift ✅ · `bun run test` ✅ (161 files, 3350 tests) · `bun run test:int` ✅ (37 files, 668 tests, the test database migrated by startTestRun) · the cn tables still merge as the runtime did (40,000 combinations, 0 differences) · `bun run check:full` ✅ in 4 min 41 s (3350 unit; 668 integration in 37 files; 255 e2e passed, 3 skipped by project: two fewer, the folded upload test ran on two projects), recorded in `.data/last-green`. `audit/` deleted afterwards (owner).
- Decisions: see Decisions (2026-10-29, Simplify) in `progress/decisions.md`.
- Open questions: none.

### Review — Code review of M4 and the audit fixes ✅ (2026-10-29)
> Not a plan prompt: the owner ran `/code-review` at max effort over P14a–P17 and the audit commit (f158298..016d578): 15 findings, 11 confirmed and 4 plausible. They then asked for them fixed, asking first about the licensee name in the email subject and any copy change (Q-136–Q-138, all a). Nothing in P18's scope was started. Status line unchanged.
- Done:
  - **check.sh:** the schema-drift check requires drizzle-kit's "No schema changes" line (without a terminal a rename prompt wrote nothing and exited 0, so the check passed). `full` records the environment (the test env files, Node and Bun) on its own line, and step0 runs every integration test when it changed (vitest `--changed` sees only git, so it ran none). AGENTS.md §2 says so.
  - **lint:invariants:** reads only files on disk (a tracked file deleted but not staged crashed it). `payments-in-tx` also sees a driver held in a variable set from `paymentsDriver(…)` or typed `PaymentsDriver`. `status-write` also sees the table under an import alias or as `schema.licenseRequest`. New rule `redacted-action`. `violationsIn` is exported and unit-tested.
  - **Redaction in every action (Q-138 a):** the 23 Server Actions in 10 files each have the body `return redactErrors(event, …)` (`src/server/rethrow-redacted.ts`). `rethrowRedacted` lets an error it already redacted through (no second log line), and with APP_ENV=development the original error. The session-read comments no longer say the query error holds the token: Better Auth logs it through the redacted logger and throws its own.
  - **Live videos no buyer can license (Q-137 a):** `isLicensable` (selection.ts), `videoFromPrice(…).licensable`. `listPublicVideos` leaves them out, since their license page 404s. `latestLiveShareUrl` moved to `public.ts` as the grid's first, which also skips a Demo-posting video while Demo is off. The video page and the Videos card show `UnlicensableNotice` ("Buyers can't license this video right now." and the blocker's "Turn on at least one use, term and territory" link to Prices) in place of the share link.
  - **Licensee names (Q-136 a):** `WEB_ADDRESS_RE` (a scheme, "www." or a domain followed by a path) refuses a licensee name on blur, on submit and in `StartCheckoutSchema` with "Enter a name without a web address.". "Booking.com B.V." passes. The subject's wording is unchanged.
  - **Races:** `lockConnectedAccounts` takes each account with the `connected_at` its caller read, so a Disconnect followed by a Reconnect counts as the Disconnect. Make licensable then refuses with needs_reconnect, and a save's or a check's verified link becomes check_failed; before, the insert referenced the deleted post (FK 23503). The webhook catch's `last_error` update is fenced on `processed_at IS NULL`; the claim's lease stays P25's.
  - **Smaller fixes:**
    - The Inbox badge takes every layout render's count (a per-render `readId`), not only a changed one.
    - `repairSelection` keeps the buyer's country or region when the first load's choice keeps their territory.
    - The request DTOs carry `scope`, built on the server, so the Inbox's client code no longer loads selection.ts and the countries.
    - request-received's body is `REQUEST_STATUS_COPY.waitingBody` (05 §8 callout 3; the words were already the same).
    - The scripted payments double logs every driver method.
    - `startTestRun` empties the database before it migrates (`emptyPublicTables` `ifAny`).
  - **Tests, new or extended:**
    - Unit: `tests/unit/lint-invariants.test.ts` (8), `rethrow-redacted.test.ts` (+4), `inbox-count.test.tsx` (new), `video-card.test.tsx` (+2), `video-page.test.tsx` (+1), `selection.test.ts` (+1), `details.test.ts` (+1), `checkout.test.ts` (+1), `test-database.test.ts` (+2).
    - Integration: `postings.test.ts` (+3 Disconnect-and-Reconnect races), `authorization.test.ts` (+1, a delivery finished meanwhile), `publish.test.ts` (+1), `inbox-queries.test.ts` (+1).
    - Each fix was checked against the old code: the three race tests fail with the old account check, the fenced-catch test fails unfenced, and a column rename fails the drift check (it passed before). The lint runs clean with a tracked file deleted but not staged.
- Verified: `bun run typecheck` ✅ · `bun run lint` ✅ (709 files) · `bun run lint:tokens` ✅ · `bun run lint:invariants` ✅ · schema drift ✅ · `bun run check:full` ✅ in 4 min 39 s (3371 unit in 163 files; 674 integration in 37 files; 255 e2e passed, 3 skipped by project), recorded in `.data/last-green` with its new `environment=` line. The first run failed one integration test, which pins every field /r gets and lacked the new `scope`; the test was updated. Not seen in a browser: the notice's state (a live video with nothing to buy) has no e2e test; the page and card render tests cover it.
- Decisions: see Decisions (2026-10-29, Code review) in `progress/decisions.md`.
- Open questions: none.
- Follow-ups for later prompts: none new (P25's lease on the event claim stands).

### Review — Simplify pass over the code-review fixes ✅ (2026-10-30)
> Not a plan prompt: the owner ran `/simplify` on the uncommitted fixes above. No behavior or copy change. Status line unchanged.
- Done:
  - **Review:** 4 reviewers (reuse, simplification, efficiency, altitude) over the fixes' diff (57 files, 3 new). All four found the same duplicate first: `licensable` restated the From price.
  - **One rule for "can be licensed":**
    - `isLicensable` and the `licensable` fields are gone. `fromPriceCents` is null exactly when no combination fits, because the cheapest combination takes each group's lowest multiplier.
    - The public side asks one `licenseOffer` in `src/server/videos/public.ts`: published, visible, a poster and a first selection. `readLicensePageData`, `listPublicVideos` and `latestLiveShareUrl` all use it.
    - `latestLiveShareUrl` reads only what `licenseOffer` needs: no postings join and no badges, since the empty Inbox asks again on every refresh.
    - The creator side asks `isUnlicensable(status, fromPriceCents)` (`src/lib/videos/video-page.ts`) on the page and the card.
    - The notice is a `Notice` (04 §9.21). Its link is `TURN_ON_AN_OPTION` (label and href), shared with the blocker row.
  - **Leaner:**
    - The request DTOs drop `useKey`, `termKey`, `territoryKey` and `territoryCode`, which nothing read once `scope` came.
    - `emptyPublicTables` returns on a database with no tables, so the `ifAny` flag and its refusal are gone.
    - `lockConnectedAccounts` keeps one Set.
    - The invariant lint reads the imports once (`importsOf`, `paymentExport`), and walks a file for drivers only when a method call sits inside a transaction.
    - check.sh hashes the environment once per use; the recorded fingerprint's input is unchanged.
    - Five refusals use `formError`.
    - The scripted double logs its two scripted reads through `logged`, and its `key` field is documented as a cancel's.
  - **Tests:**
    - The Disconnect and the Disconnect-and-Reconnect races are one `describe.each`; both now also check the Library.
    - The music fixtures use `MUSIC_DISABLED_USES`, and `publishVideo`'s `extra` backdates.
  - **Skipped:** one validator for the license form's rules (the Zod schema calling `detailsFieldError`). The parallel rules predate these fixes, and the page loads no Zod.
- Verified: `bun run typecheck` ✅ · `bun run lint` ✅ (709 files) · `bun run lint:tokens` ✅ · `bun run lint:invariants` ✅ · `bun run check:full` ✅ in 4 min 43 s (3371 unit in 163 files; 674 integration in 37 files; 255 e2e passed, 3 skipped by project), recorded in `.data/last-green`.
- Decisions: see Decisions (2026-10-30, Simplify) in `progress/decisions.md`.
- Open questions: none.

**M5 Approve, decline, deliver** · P18–P20b · 17.5 h

### P18 — Approve: capture and issue the license ✅ (2026-10-30)
> 120 min · Depends on: P17 · Record: the `original_missing` copy, where `maxDuration` and `reconcileStuckClaims` live, how the snapshot picks the primary posting (OQ-12 is an owner answer)
- Done:
  - **Step 0** (Q-88): `bun run check:step0 tests/e2e/request-received.spec.ts tests/e2e/inbox.responsive.spec.ts` → typecheck, lint, token lint, invariant lint and unit (3371) green; integration and e2e not re-run (the code was that of the last green `check:full`). P17's files and exports exist (`TRANSITIONS`, `nextStatus`, `effectiveStatus`, `applyTransition`, `runEffects`, `sendQueuedEmails`, `paymentsDriver`, `captureKey`/`cancelKey`, the `capture`/`cancel`/`getAuthorization` wrappers, `markAuthorized`, `onWebhookEvent`, `revealBuyerToken`, `findRequestForBuyer`, the Inbox row, /r, the request page); `formatEmailDateTime` exists; `rg guardian src/server/email src/emails` and `rg "paymentsDriver\(\)" src` print nothing; the dev env is `APP_ENV=development`, `PAYMENTS_DRIVER=fake`, `STORAGE_DRIVER=local`, no `RESEND_API_KEY`.
  - **Audit:** a workflow of 5 area readers (money path, license issuing, email, UI, downstream contracts and the test plan), each checked by a skeptic, then a completeness critic, over the prompt, 01–08, research/license.md, later prompts' Step 0 greps and the code: about 120 findings, most confirmed and adjusted into the build below; owner answers Q-139–Q-141 in chat, all a.
  - **Pure helpers:** `src/lib/licensing/ends-at.ts` `computeEndsAt` (UTC fields only; 6/12 calendar months clamped to the month's last day, keeping the time and the milliseconds; d30 = 30 × 86 400 000 ms; perpetual null). `src/lib/licensing/public-status.ts` `publicStatus` exactly as research/license.md §6.2 with `PublicLicenseStatus` (07 D117's `startsAt`/`upcoming` is P22b's, as D117's prompt column and P20/P20b/P22b expect). `src/server/codes/license-code.ts` `LICENSE_CODE_ALPHABET`, `generateLicenseCode` (`crypto.randomInt(32)` × 8), `normalizeLicenseCode` (07 D101: the `CL` prefix stripped only at 10 characters).
  - **Snapshot** (`src/lib/licensing/snapshot.ts`): `LicenseSnapshotV1` kept as 03 §3.7.2; `LicenseSnapshotV1Schema` (Zod 4, `exclusive` and `renewalOfCode` included, a compile-time check that schema and type are the same both ways); `LICENSE_CODE_PATTERN` (client-safe, for P19g); `buildLicenseSnapshot(LicenseSnapshotInput)`: postings verified first then by position; the primary verified posting through `primaryVerifiedPosting` (verified `is_source`, else the lowest-position verified one, the badge's rule) gives `ownership` and, through `creditLine`, the credit line; `postingPlatformLabel` labels ("Demo" for mock); a posting's `url` and `sourcePermalink` are null when `show_link` is off or the verified post was removed (07 D70); scope labels from `rateOptionLabel`, `territoryDetail` the country or region name (`territoryLabel`), null worldwide; `exclusive: false`, `renewalOfCode: null`.
  - **`issueLicense(tx, requestId, startsAt, { actor })`** (`src/server/licensing/issue.ts`, 02 §5.7): returns `{ licenseId, code }`, the existing license first (idempotent); reads the request (FOR UPDATE of license_request), its video, creator and every posting in `tx` with no status filter (a waiting request stays approvable after Unpublish), narrows the scope keys and requires a ready original and answered rights; `issued_at` = `created_at` = `snapshot.issuedAt`; up to 5 attempts, each its own savepoint (`tx.transaction`), `INSERT … ON CONFLICT DO NOTHING RETURNING` with the snapshot rebuilt for that attempt's code and parsed by the schema; an empty result re-checks by request first; after 5 it throws. Audit `license.issued` `{ code }` as the T5 actor, only on an insert. No status read, so P22e/P22g can call it after their own transition; the word "exclusive" stays out of the file (P19g's Step 0).
  - **Payments wrappers** (`src/server/payments/index.ts`): `capture` and `cancel` never throw: the driver is resolved first (a currency not enabled still throws), and a thrown call becomes `{ ok: false, kind: "transient", code: errorName(error) }`. `releaseHold`'s catch went with it; P16b's thrown-cancel test now expects `transient`.
  - **State machine** (`src/server/licensing/state-machine.ts`): `LicenseRequestPatch` gains `approvedAt`, `declinedAt`, `expiredAt`, `captureFailedAt`; `patchProblem` is exhaustive over the 10 events (captured needs `approvedAt`; declined `creator`|`video_disabled`; expired `deadline`|`hold_released`; capture_failed `pi_canceled_during_capture`|`capture_error:<code>`). `claimPaymentAction(requestId, action)` (stuck claims first, one conditional UPDATE … RETURNING with a JS `Date`, `stripe_attempt + 1`, capture before / expire at or after the deadline; returns `ClaimedRequest` or null). `releaseClaim(requestId, claim)` fenced on the claim **and** `status = 'awaiting_approval'` (finished rows keep their claim), returns whether it released. `reconcileStuckClaims({ requestId?, olderThanMinutes, limit = 50, actor })` (the cutoff on the JS clock, oldest first, a row whose retrieve fails logged and skipped; returns the claims resolved). `reconcileFromStripe(requestId, { actor?, claim? })` → `"finished" | "released" | "unchanged"`: succeeded on a waiting row → `finishCapture`; on declined/expired/capture_failed/abandoned → audit `license_request.money_moved_late` `{ piStatus, status }` and nothing else (OQ-12); on approved → nothing (P19b's hook); canceled → `finishCanceled` by the claimed action (decline → declined with `video_disabled` or `creator`; capture → `capture_failed`/`pi_canceled_during_capture`; expire → expired/`deadline`; no claim → expired/`hold_released`); requires_capture → releases only the caller's own `claim`; a retrieve that throws throws. `finishCapture(requestId, { claim, actor })`, the one T5: its own transaction, the fenced lock first (`lockHeld`), then `issueLicense`, `applyTransition('captured', { approvedAt })` (must change), `license-approved` queued with `queueEmail` after the license (`license-approved/<requestId>`); `runEffects` after the commit; a finish that throws is audited `license_request.issue_failed` and rethrown. `startsAt` = the capture claim's time, else one JS `Date`.
  - **Approve** (`src/server/licensing/approve.ts`): `approveLicenseRequest(requestId, actor)` → `ApproveResult` (`src/lib/licensing/request-dto.ts`): creator actors only, scoped by `creator_id` (else `not_actionable` with `status: null`, nothing told); stuck claims reconciled; a decided or claimed request → `not_actionable` with its status, an unclaimed overdue one (DB clock) → `expired`; original not ready → `original_missing`; `refreshPayoutsStatus(creatorId, { maxAgeMs: 600 000 })` that throws → `retry`, not active → `payouts_not_active`; then the claim, `capture` under `pi-capture:<id>:<attempt>`, the T5 finish. A capture that isn't ok → `reconcileFromStripe` with the claim → approved (ok), released (`retry`), `capture_failed`, else `not_actionable` (Processing…). Only the tap whose claim captured answers ok; after an ok capture never `retry`. The action `approveRequest` (`src/app/(dashboard)/dashboard/actions.ts`): Zod, `requireCreator`, `toActor`, `refresh()`, `ActionResult<ApproveResult>` inside `redactErrors`.
  - **Webhook:** `payment_intent.succeeded` re-reads the PaymentIntent: a request still in checkout goes to `markAuthorized` (which records Q-123 a's charge-before-approval audit), every other to `reconcileFromStripe` as the webhook actor; a retrieve that throws fails the delivery, so Stripe sends it again. `payment_intent.canceled` stays P19's.
  - **Email** (`src/emails/license-approved.tsx`, `src/server/email/license-emails.ts`): 05 §8's frame: headline = subject "Approved: your license {code} is ready" (`licenseApprovedSubject`), /r's approved body word for word, "Amounts in Canadian dollars (CAD)." (`currencyLabel`), the context (title, `scopeLabel`, "License {code}"), **Get file and license** → `{APP_URL}/l/{token}` (revealed at send time), and after the hairline "Anyone can check this license at {APP_URL}/verify/{code}." (the link, the period outside it; `EmailLayout` gains `footerLines`). No date, no posting link. `compose()` has its `license-approved` case; `licenseApprovedEnvelope` gives the queue its recipient and subject; `licensePath`/`verifyPath` in `src/lib/urls.ts`; a preview for `bun run email:dev`.
  - **UI:** `ClearedSeal` (`src/components/cleared/cleared-seal.tsx`: static, `aria-hidden`, viewBox 0 0 100 100, disc `fill-cleared`, check `M29 52 L44 66 L72 36` stroked `stroke-cleared-ink` at 8, round caps, `pathLength` 1, sizes 16/40/72/88 plus `className` for P20's tier sizes). `toast(message, { seal })` leads with the 16 px seal. `approveOutcome(result, request)` and `RowOutcome`/`ResultLine` in `src/lib/licensing/inbox.ts` (every reason mapped; P19 adds Decline's). `InboxRow`: Approve (`primary sm`) in the Disclosure's actions only while `displayStatus` is `awaiting_approval` (half width on the right below md, rightmost from md, "Approving…" with the width locked); a held row keeps its waiting layout, the result's pill (cross-fade) or its countdown, the 16 px seal before "You get", the line in the text column, no Details; non-deciding results keep the row live with their line; the focus moves to `[data-row-status]`, described by the line (`aria-describedby`); a held row that leaves with the focus hands it to the Inbox title (`useFocusOnRemove`). `InboxList` holds a row from the tap (`outcome: null` while in flight) at its index, `mergeSettledRows`/`dropDecided` (`src/components/inbox/settled-rows.ts`), lets decided rows go on the next AutoRefresh and restarts its 30 s when one settles. The request page: the status block `#request-status` (pill without the code chip, "License {code} issued", the stored line), `RequestActions` (`lg` Approve at its own width under the card, mounted across `refresh()`, only the lines the stored page lacks, the focus to its line or the status block). `RequestStatus` takes a result's `status` and `showCode`. /r's approved view has the 40 px seal above its title. `maxDuration = 60` on `dashboard/page.tsx` and `dashboard/requests/[id]/page.tsx`.
  - **Invariant lint:** `payments-in-tx` also flags a call, inside a transaction, to any function that reaches Stripe (see Simplify).
  - **Simplify (owner request, before this commit):** 4 reviewers (reuse, simplification, efficiency, altitude) over the P18 diff (52 files): about 50 findings, deduped and applied with no behaviour or copy change.
    - Fewer round trips per Approve (5 of about 20): the stuck-claim reconcile runs only for a stuck claim (`isStuckClaim`); `claimPaymentAction` claims first and reconciles only on a refusal, then tries once more; the payouts check reads the session's creator row (`payoutsRow`) with `refreshPayoutsStatus`'s own 10-minute default; `finishCapture` queues license-approved from the transition's row and the issued code (`licenseApprovedEnvelope` is gone). `dropDecided` returns the same map when nothing is decided, so a refresh renders the Inbox once.
    - One rule each: `buyerPostingOrder` and `shownPostingUrl` (src/lib/videos/ownership.ts) for the license page and the license record; `settled` (driver.ts) for every money call that throws (`ensureNegativeBalanceDebits` too); `LICENSE_CODE_PATTERN` for the normalizer, the tests and the factory (`insertLicense` uses `generateLicenseCode`); `LAZY` and `WEBHOOK` in actor.ts; `PAYOUTS_SETTINGS_PATH`, `SetUpPayoutsLink` and `SupportEmailLink` (the Banner, the request page, a row's line, the payouts line, the onboarding route); `LicenseIssuedLine`; `useFocusAfterRender`.
    - Simpler: `RowOutcome` has no `seal` (`showsSeal`: an Approved pill); `RequestStatus` shows only the countdown or the pill (History renders its code; no `showCode`); the request page's line rule is the pure, tested `requestPageLine` (a recorded line, or one the refreshed record shows, is left to the record; a line the record never carries, such as P19's plain decline, stays); `buildLicenseSnapshot` maps the postings once (`entryOf`); the schema/type check is a test (`expectTypeOf`); `issueFacts` returns `creatorId` and no SQL order; `finishCanceled` throws like `finishCapture`; dead props and columns are gone.
    - The invariant lint computes the functions that reach Stripe (`callsOutIndex`: a fixed point over src through local and imported calls) instead of a hand list, which had already missed `markAuthorized`, `createLicenseRequest`, `reconcileCheckoutReturn` and `onWebhookEvent`; a planted `markAuthorized` call in a transaction fails it.
    - Tests: `tests/helpers/inbox-fixtures.ts` (`WAITING_REQUEST`, `pressApprove`) for both component tests, `requestRow` in factories, `pastDeadline` and `takenCode` in approve.test.ts.
    - Skipped: one Approve/Decline hook and refusal mapper (P19 builds Decline), `claimPaymentAction` returning `{ row, claim }` (02 §5.7 and P19g extend the row union), one footer line instead of `footerLines` (P20b adds a second), license-approved in the `EMAILS` table (the prompt and P17 queue it after the license), the email's scope line from the snapshot (P20 needs that helper first).
    - Then, at the owner's request, the two older-test cleanups first skipped: `BARE_DOLLAR` (07 D98) lives once in `tests/helpers/money.ts` for the two email unit tests, approve.test.ts and request-received.spec.ts; `tests/helpers/approval-fixtures.ts` splits into `pendingCheckoutRequest` and `authorizeRequest` (`waitingRequest` is the two, now also returning the transition's result), and `email-outbox.test.ts` builds on them instead of its own copies. `authorization.test.ts`'s `pendingRequest` stays: its rows keep the default UTC zone, where the shared one sets America/Toronto.
  - **Tests:** unit `ends-at.test.ts` (07 D33 goldens, ms), `license-code.test.ts` (07 D101 goldens, 1,000 codes), `public-status.test.ts`, `snapshot.test.ts` (22), `cleared-seal.test.tsx`, `settled-rows.test.ts` (8), `license-approved.test.tsx` (5), `inbox.test.ts` (+9 approveOutcome), `inbox-row.test.tsx` (+8: Approve per state, held rows, retry/payouts/missing original lines, focus and description, the list's hold through refresh and focus), `request-actions.test.tsx` (4), `request-status-view.test.tsx` (+1), `toast.test.tsx` (+1), `payments/index.test.ts` (+2), `lint-invariants.test.ts` (+1); [int] `tests/integration/approve.test.ts` (29: the happy path with the sent email's `/l` token and `/verify` link, a verified owner's snapshot, double tap, payouts, missing original, deadline, foreign and unknown ids, an approved row tapped again, transient capture then key `:2`, a capture whose license can't be written (`issue_failed`), J4.7, every reconcile branch, money moved late, approved + succeeded, stuck claims, J9.7 in both orders and at once, an unread webhook, the code collision, five collisions, idempotent issue) with `tests/helpers/approval-fixtures.ts`; `authorization.test.ts` (succeeded during checkout from either event, `transient` cancel); e2e `inbox.responsive.spec.ts` (approve on the request page with the toast above the TabBar and the email; Approve's box at every width; History; the approved /r with its seal; the row approve that stays, drops the counts, takes the focus and leaves on focus).
- Verified: `bun run typecheck` ✅ · `bun run lint` ✅ (733 files) · `bun run lint:tokens` ✅ (prints nothing) · `bun run lint:invariants` ✅ (prints nothing) · `bun run test` ✅ (171 files, 3466 tests) · `TZ=America/Los_Angeles bun run test ends-at` ✅ and `TZ=Pacific/Auckland bun run test ends-at` ✅ (7 each) · `bun run test:int` ✅ (38 files, 704 tests; `approve.test.ts` 29) · one `bun run test:e2e tests/e2e/request-received.spec.ts tests/e2e/inbox.responsive.spec.ts` ✅ (6 passed: request-received on both behavior projects, the extended inbox.responsive on all four, 07 D154) · `bun run check:full` ✅ in about 5 min (lint 733 files; 3466 unit in 171 files; 704 integration in 38 files; 255 e2e passed, 3 skipped by project), again after the simplify pass (lint 737 files; 3472 unit in 171 files; 704 integration in 38 files; 255 e2e passed, 3 skipped by project), and after the two test cleanups (lint 738 files; 3472 unit; 704 integration; 255 e2e passed, 3 skipped by project), recorded in `.data/last-green`.
  · Verify on the dev server (`--demo`, maya): a logged-out request at 375 × 812 (Paid social ads · 1 year · Worldwide, CA$1,732.50, fake Pay) → /r "Waiting for @maya". Signed in as maya at 375: Approve in each row's right half; tap → the row stays with the seal before "First snow · You get CA$1,575.00", "License CL-ETHB-DP51 issued" and the filled Approved pill, "Waiting 2" at once; a window focus → the row leaves Waiting (focus to the Inbox title). At 1280: Approve rightmost after Details; tap → "Approving…", the toast "Approved. CA$1,575.00 is on its way to your Stripe balance." with its seal at the bottom, the row in place with the pill top-right, "Inbox. 1 waiting for you." and "Waiting 1" at once, the focus on the row's status described by "License CL-17BH-73B9 issued". Dark mode at 1280: History lists both Approved with their codes. At 768, keyboard only on the request page: focus Approve, Enter → "Approving…", then "Approved · License CL-1GDT-5BCA issued", the focus on the status block, the action row gone, the badge cleared. /r for the first approval at 375: the 40 px seal centered above "Approved" and the 01 §4.8 body. No page console errors (only Node's Postgres SSL-mode warning Next forwards from the server). The newest `.data/emails/*license-approved.json`: subject "Approved: your license CL-1GDT-5BCA is ready" (no link or key), the `/l/` link with a 43-character key, `/verify/CL-1GDT-5BCA`, CA$1,732.50, "Amounts in Canadian dollars (CAD).", no bare `$`. SQL (dev DB): the three licenses `CL-1GDT-5BCA`, `CL-17BH-73B9`, `CL-ETHB-DP51` each have `starts_at = approved_at = payment_action_at`, `ends_at = starts_at + 1 year`, `stripe_attempt = 1`, `payment_action = 'capture'`, `snapshot.code = code`, `snapshot.amounts.currency = 'cad'`; their `license-approved` rows are `sent` with 1 attempt. The Verify grep (`grep -rn -A25` on `db.transaction`/`.transaction(` in src/server/licensing, filtered for `capture(`, `cancel(`, `getAuthorization(`, `reconcileFromStripe(`, `claimPaymentAction(`, `refreshPayoutsStatus(`) prints nothing.
- Decisions: see the Decisions table (2026-10-30, P18) in `progress/decisions.md`.
- Open questions: none (Q-139–Q-141 answered).
- Follow-ups for later prompts: **P19**: Decline in `InboxRow`'s actions grid (`col-start-1` below md, left of Approve from md) and in `RequestActions` (`secondary lg`); its outcomes in `approveOutcome`'s sibling and `RowOutcome`; `declineLicenseRequest` and the expire path use `claimPaymentAction`, `releaseClaim` and `reconcileFromStripe(id, { actor, claim })` (P19's `captureOutcome` joins that options object); `finishCanceled`'s `declineReasonFor` is P19g's to replace; the T7 permanent branch, `handlePaymentIntentCanceled`, the scripted double's capture outcomes and the D25 matrix; page-level `reconcileStuckClaims` on /r, the Inbox and the request page, and lazy expiry; the approve-after-deadline line says only "This request expired." until the expiry is stored (Q-140, 07 D25), so P19's question 1 covers this surface too; `retryEmailOutbox` and `reconcileStuckClaims({ olderThanMinutes: 10, actor: cron })` in the cron (it returns the claims resolved). **P19b**: the `creator_transfer` insert in `issueLicense`'s shared tail (both the insert and the existing-license path) and `after(sendCreatorTransfer)` in `finishCapture` after the commit, and in `reconcileFromStripe`'s approved + succeeded branch; on History, "under License {code} issued" means under the pill-and-code line (05 callout 12). **P19c**: auto-approve passes the system actor to `approveLicenseRequest` (today a non-creator actor gets `not_actionable`/null) and uses `finishCapture`; `not_actionable` with `awaiting_approval` means a claim is running. **P19g**: the claim's video lock and `assertStillLicensable` (Q-122 a), `exclusive_conflict` in `ApproveRefusal` and `approveOutcome`, the snapshot's `exclusive` from the request (`LICENSE_CODE_PATTERN` is in snapshot.ts). **P20**: /r's Get file and license button (Q-141), " · View license" after "License {code} issued" on held rows and the request page, History's View license; `licensePath`/`verifyPath` exist; /l, the PDF and /verify map snapshot postings with `hasLink: url !== null`, `removed: false`, `noLongerLinked: false` (the record keeps neither a hidden link nor a disconnect); the summary's territory sentence reads `license_request.territory_code` (the snapshot keeps the label and detail only). **P21**: Events highlights `license_request.money_moved_late` and `license_request.issue_failed`. **P22b**: `publicStatus` gains `startsAt`/`upcoming` (07 D117); `createRenewalPlan` in `issueLicense`'s shared tail with its actor. **P22c**: `issueLicense`'s `saved` joins its options object. **P25**: the real branch for a PaymentIntent that succeeded during checkout (Q-123 a still records it; P25's stop-and-ask). **Plan-kit fixes:** P18 says "per your answer to Q1" and the AC "matches the Q1 answer" for money_moved_late (OQ-12, an owner answer) and "the Q2 string" for `original_missing` (question 1); "keep P17's Get file and license link" (P17 renders none); the out-of-scope line puts `tests/helpers/scripted-payments.ts` in P19 (it exists since P16b; P19 extends it); P18's Step 0 and Verify run commands AGENTS §2 replaces; 02 §5.7/§8.2 give `reconcileFromStripe(requestId)` and `issueLicense(tx, id, startsAt)` without the actor their audits need, `ON CONFLICT (code)` where the prompt has none, and `applyTransition` before `issueLicense`; 02 §6.1 and 06 §7 say the actions file exports `maxDuration` (a "use server" file can't); 06 §7 says the license starts now; 07 D15 cites D51 and `show_platform_link` (D43, per-posting `show_link`); 07 D49 prints a bare `$` in the toast (D98/D99); P19g's greps use single quotes (`'capture'`, `'auto_approve'`) where the code has double; P20b expects `http://localhost:3000` in a test (the test APP_URL is 3100).

### P19 — Decline, expiry and the money-safety matrix ✅ (2026-10-30)
> 120 min · Depends on: P18 · Record: the overdue-copy answer, any additive `reconcileFromStripe` argument, the money-matrix row count, the hand-offs to P21 and P22 (OQ-31 is an owner answer)
- Done:
  - **Step 0** (Q-88): `bun run check:step0` on P18 → typecheck, lint (738 files), token lint, invariant lint, schema drift and unit (3472) green; integration and e2e not re-run (the code was that of the last green `check:full`). Also green: `ends-at` in both test zones, `settled-rows` (8) and `bun run test:int approve` (29). The no-money-call-in-a-transaction grep printed nothing. In the dev DB the newest licenses have `starts_at = approved_at = payment_action_at` and `stripe_attempt = 1`.
  - **Audit:** a workflow of 5 area readers (money path, expiry layers and cron, creator UI, buyer and email, test plan), each checked by a skeptic, then a completeness critic. It read the prompt, 01–08, later prompts' Step 0 greps and the code, and produced about 90 findings, nearly all confirmed or adjusted into the build below. The owner answered Q-142–Q-144 in chat, all a.
  - **Money core** (`src/server/licensing/state-machine.ts`, `requests.ts`, `approve.ts`):
    - `declineLicenseRequest(id, actor, reason = "creator")` returns `DeclineResult` (`src/lib/licensing/request-dto.ts`). Steps: scope check, stuck claim reconciled, an overdue request expired as the system, the `decline` claim, cancel `pi-cancel:<id>:decline:<n>` (`requested_by_customer`), then `finishCanceled`.
    - `expireLicenseRequest(id, actor)`: the `expire` claim (guard `now() >= expires_at`), cancel `pi-cancel:<id>:expire:<n>` (`abandoned`), then `finishCanceled` with `deadline`.
    - `expireDueRequests({ requestId?, creatorId?, limit, actor, stopAt? })`: due rows are waiting, unclaimed and overdue on the DB clock, oldest deadline first, each in its own try/catch.
    - `handlePaymentIntentCanceled(id)`, routed from `payment_intent.canceled` (a request still in checkout stays "ignored").
    - A cancel that isn't ok goes to `reconcileFromStripe` with its claim, so the claim is released while Stripe still holds the card.
    - `finishCanceled` is exported, takes `statusReason` and returns null when its fence is lost.
    - T7: `reconcileFromStripe(id, { actor?, claim?, captureOutcome? })` takes the caller's permanent capture failure. It re-fences the claim (`refenceClaim`), cancels under `pi-cancel:<id>:capture_failed:<n>` and finishes `capture_failed` with `capture_error:<code>`.
    - `reconcileStuckClaims` gains `creatorId` and `stopAt`.
    - Approve schedules the expiry in after() on an `expired` answer.
    - `afterResponse` logs a task's rejection (`effects.after_failed`).
    - New actor `CRON`.
    - The request-declined email in `EMAILS.declined`.
  - **Display:**
    - `displayStatus({ status, paymentAction, overdue })`, with `overdue` from the queries' SQL on the database's clock (Q-142 a). The request page's payouts Notice and `RequestFacts` key on it.
    - `waitingSummary`'s soonest deadline counts only deadlines still ahead, so the payouts Banner never names a passed one.
  - **Lazy layers** (`src/server/licensing/lazy.ts`):
    - `settleCreatorRequests` runs on /dashboard and /dashboard/requests/[id]: it awaits the stuck-claim reconcile with a 5 s budget, then runs `expireDueRequests` in after().
    - `settleBuyerRequest` runs in `getBuyerRequest` after the key check, on a waiting request that reads Processing… or Expired, which is then read again. So /r awaits its own expiry and its title and body agree.
  - **Email:**
    - `src/emails/request-declined.tsx` with its preview; subject "Not approved: you weren't charged" (`requestDeclinedSubject`); /r's body through the shared `declinedView` (`src/lib/licensing/request-status.ts`).
    - `REQUEST_EMAIL_COPY.declinedBody` for both bodies (`creator`, `video_disabled`).
    - Exhaustive template switches.
    - No expiry email.
  - **Cron:**
    - `GET /api/cron/expire-requests` (`src/app/api/cron/expire-requests/route.ts`): `maxDuration = 60` and a 45 s budget.
    - Steps reconcile (10 min, `CRON`) → expire (100) → email retry (50). A step reruns only after a full batch, and none starts a row after `stopAt`.
    - Answers: 401 without `Bearer <CRON_SECRET>`; 200 `{ expired, reconciled, emailsSent }` with `no-store`; 500 `cron_failed`.
    - `isCronAuthorized` (`src/server/cron/auth.ts`, constant-time).
    - `retryEmailOutbox({ limit, stopAt? })`.
  - **Dev clock:** `scripts/dev-expire-request.ts <requestId> [--no-cron]`, development and test only. It moves `expires_at` to 1 ms after the authorization, calls the cron route and prints one JSON line. README "## Local development".
  - **UI:**
    - Decline (`secondary sm`) in `InboxRow`'s actions grid: `col-start-1` and half width below md; Details · Decline · Approve from md.
    - Decline (`secondary`) left of Approve in `RequestActions`.
    - `useRequestActions` (`src/components/inbox/use-request-actions.ts`, was `use-approve.ts`) holds one pending state for both buttons.
    - `declineOutcome`, and the refusal helpers shared with `approveOutcome` (`src/lib/licensing/inbox.ts`).
    - The `declineRequest` Server Action (`redactErrors`, `refresh()`; it never takes a reason).
    - A settled declined, expired or failed row and an overdue row drop "You get".
    - A late Approve settles with the «Expired» pill.
    - A kept line (retry, payouts, missing original) shows only while the request still waits.
  - **Invariant lint:** `payments-in-tx` also follows same-file functions that reach Stripe (`markReachers`).
  - **Review:** a workflow of 5 dimension reviewers (money, security, UI, email, cron), each checked by a skeptic, found 9 low findings. All 9 are applied:
    - the settle budget;
    - README's `env -u CRON_SECRET` for the test-database run;
    - the late-Approve pill;
    - the kept-line guard;
    - the claim comments;
    - the Banner's soonest deadline;
    - the email retry's `stopAt`;
    - the reconcile-first cron order;
    - the cron hand-off under Follow-ups.
    Also renamed: `capture_cancel_failed` logs Stripe's code as `stripeCode`, since log lines redact `code`.
  - **Simplify (owner request, before this commit):** 4 reviewers (reuse, simplification, efficiency, altitude) over the P19 diff (61 files), each checked by a skeptic. They raised 48 findings; the skeptics kept 27, which I deduplicated across angles. Applied with no behaviour, copy or assertion change:
    - The deadline expression is written once (`src/server/licensing/deadline.ts`).
    - `reconcileIfStuck` serves Approve and Decline.
    - /r reads through the keyed query and settles only what reads Processing… or Expired: a waiting tick costs 2 round trips instead of 4.
    - Decline answers from its own finish.
    - `finishCanceled` builds its patch in one exhaustive switch.
    - `handlePaymentIntentCanceled(requestId)` has the spec's signature.
    - Two dead exports are gone.
    - The test suites share their scripted-double harness (`tests/helpers/scripted-suite.ts`), their request-outcome readers (`tests/helpers/request-outcomes.ts`), the stderr recorder (`tests/helpers/logs.ts`), `scripted.cancels()`, `overdue(id, minutes)` and `piEvent`.
    - The displayStatus cases are one table.
    The skips and their reasons are in the decisions table (P19 (simplify)).
  - **after() failures (owner request, before this commit):** approve, authorization and email-outbox now record stderr from beforeEach and fail a test whose after() task failed. Since P19, `afterResponse` logs such a failure instead of rejecting, so `flushAfter` alone no longer shows one. `captureLogEvents` became nest-safe, so the suites' own captures run inside that recording (`tests/unit/log-capture.test.ts`). With every after() task made to fail, 26 of their 99 tests go red.
  - **Tests:**
    - Unit:
      - `src/server/cron/auth.test.ts` (12), `src/app/api/cron/expire-requests/route.test.ts` (6), `tests/unit/dev-expire-request.test.ts` (15), `src/emails/request-declined.test.tsx` (8), `tests/unit/lint-invariants.test.ts` (10 → 12) and `tests/unit/log-capture.test.ts` (4: a capture nested in a recording).
      - Extended: `inbox.test.ts` (declineOutcome; the late-Approve pill; the kept line), `inbox-row.test.tsx`, `request-actions.test.tsx`, `transitions.test.ts` (displayStatus as one table: every claim × overdue), `request-status.test.ts` and `request-status-view.test.tsx`.
    - Scripted double (`tests/helpers/scripted-payments.ts`, additive): per-PaymentIntent state, queued outcomes, hooks, holds and the 07 D25 invariant, checked at every money call, with `cancels()`. New helpers: `tests/helpers/pi-events.ts`; `overdue(id, minutes)` and `claimedMinutesAgo` in approval-fixtures; `tests/helpers/scripted-suite.ts` (the registry seam, the install, the per-test checks and the shared teardown); `tests/helpers/request-outcomes.ts` (licenses, endings, outcome emails, Stripe events); and the stderr recorder with `AFTER_FAILED` in `tests/helpers/logs.ts`.
    - [int] `money-matrix.test.ts`: **42 tests**, made of 24 matrix rows, 6 named cases and 12 extras.
      - Matrix rows: {capture, decline, expire} × {ok, transient, permanent, ambiguous} × webhook {after, during}.
      - Named cases: J8.14's capture that times out but succeeded, a capture after an expire claim, and a decline racing a late succeeded, each with the webhook after or during.
      - Extras (E1–E8): retries under their own keys, the stuck-claim releases, T7, a stale claim, `money_moved_late`.
      - Planned: 38.
    - [int] `decline-expiry.test.ts` (53): Decline incl. J8.5; past the deadline; the J8.8 races; expire and the sweep incl. J8.15; `payment_intent.canceled` incl. J8.7 and `money_moved_late`; /r; the creator layers; `forceOverdue`; the action.
    - [int] `expire-requests-cron.test.ts` (7): 401s, the D/S/F/E run, the no-spin run, reconcile-then-expire in one run.
    - [int] `approve.test.ts` 29 → 33 (T7; the scheduled expiry). `email-outbox.test.ts` 16 → 25 (request-declined; the retry's `stopAt`). `inbox-queries.test.ts` 14 → 17 (overdue reads; the soonest deadline). `authorization.test.ts` (one test retitled).
    - e2e `inbox.responsive.spec.ts`:
      - Its first test now also declines the second waiting row, checking the line, toast, pill and focus; Decline's box at every width; the row keeping its place until a focus refresh; History; the declined /r with a neutral heading; and the request-declined email.
      - New test: an overdue request's /r expires it before rendering and reads "No answer in time" at every width.
    - Mutation checks, each restored and byte-compared afterwards: 3 + 20 + 22 product mutations caught by the [int] slices, 4 by the e2e spec, and 3 (one per review fix) by the new tests.
- Verified:
  - `bun run typecheck` ✅ · `bun run lint` ✅ (756 files) · `bun run lint:tokens` ✅ (prints nothing) · `bun run lint:invariants` ✅ (prints nothing) · `bun run test` ✅ (176 files, 3562 tests).
  - `bun run test:int` ✅ (41 files, 822 tests: decline-expiry 53, money-matrix 42, approve 33, authorization 41, email-outbox 25, inbox-queries 17, expire-requests-cron 7). Also green on repeated runs: money-matrix 5×, decline-expiry 15×, the whole suite twice.
  - One `bun run test:e2e tests/e2e/request-received.spec.ts tests/e2e/inbox.responsive.spec.ts` ✅ (10 passed: request-received on both behavior projects, inbox.responsive's 2 tests on all four, 07 D154).
  - `bun run check:full` ✅ before the simplify pass (lint 752 files; 3553 unit in 175 files; 822 integration in 41 files; 259 e2e passed, 3 skipped by project), again after `.env.test`'s test-only CRON_SECRET was rotated, after the simplify pass (lint 755 files; 3558 unit in 175 files; 822 integration in 41 files; 259 e2e passed, 3 skipped by project), and after the after()-failure watch, the last change (lint 756 files; 3562 unit in 176 files; 822 integration in 41 files; 259 e2e passed, 3 skipped by project), recorded in `.data/last-green`. The simplify pass's test refactor was diff-checked against a snapshot: same test titles and counts in every [int] file, same pi-cancel/pi-capture literals, same expected values.
  - Verify greps:
    - `grep -rn -A25 "db.transaction" src/server/licensing` has no capture/cancel/getAuthorization hit. A balanced-paren scan of all 7 `.transaction(` callbacks in src/server/licensing and src/server/payments finds no driver, reconcile, claim, expire or decline call.
    - `grep -rn "scripted-payments" src` prints nothing.
    - `rg request-expired src` prints nothing.
  - Verify on the dev server (maya, the fake driver):
    - **Requests:** signed out, three requests at 375 × 812 (Organic social repost · 30 days · Worldwide, CA$288.75, fake **Pay**), each → /r "Waiting for @maya".
    - **Cron and the dev clock:**
      - `curl` without the bearer → 401.
      - `bunx tsx scripts/dev-expire-request.ts <the third>` → one JSON line ending `"cron":{"expired":1,"reconciled":0,"emailsSent":0}`.
      - The bearer curl (the secret read from `.env.local`, never printed) → `{"expired":0,"reconciled":0,"emailsSent":0}`, HTTP 200.
      - That request's /r → "No answer in time" and "@maya didn't answer by Fri 30 Oct, 7:44 PM EDT. You haven't been charged, and the hold on your card has been released.", with no countdown and no back link.
    - **Tap decline at 375** (signed in as maya):
      - "Inbox. 2 waiting for you.", Decline the left half beside Approve.
      - Tap → "Declining…" with Approve disabled.
      - Then the row stays in place: "First snow · CA$262.50" (no You get), "Declined. The buyer wasn't charged." wrapping inside the row, and the «Declined» pill. "Waiting 1" updates at once. The focus is on the row's status, described by the line, with no horizontal scroll.
      - A window focus → the row leaves Waiting.
      - History: it reads «Declined», and the expired one «Expired» with "Expired. No answer by Fri 30 Oct, 7:44 PM EDT. The buyer wasn't charged."
    - **Keyboard decline at 768** (the second request's page): Tab order Decline → Approve. Enter on Decline → the focus on the line "Declined. The buyer wasn't charged.", the toast with the same sentence, then the «Declined» pill, the facts without You get / Payment / Answer by, and no buttons.
    - **The declined /r** (from its email's link):
      - "Not approved" with the 01 §4.8 body, the heading in `--ink` (#111 light, #f5f5f5 in dark at 1280), no countdown and no back link.
      - No horizontal scroll at 320, 375, 1280, 1920 or 2560; the summary column is 640 px from 1920.
    - **A fourth request, Inbox at 1280 dark:**
      - Details · Decline · Approve on one line, Approve rightmost with 12 px gaps, at 768, 1024, 1280, 1920 and 2560; half widths at 320; no horizontal scroll at any of them.
      - Decline → the row stays with the line and the pill top-right. History in dark mode lists all of them.
    - **Emails:** one `request-declined` file per declined request (`grep -l <id>` finds exactly one each; none for the expired one). Subject "Not approved: you weren't charged", /r's body, the title and scope, the buyer's /r link, no bare `$`.
    - **SQL** (dev DB, newest first): `expired`/`deadline`/`expire`/`1`, `declined`/`creator`/`decline`/`1`, `declined`/`creator`/`decline`/`1`.
    - **Errors:** no page console errors (only Node's Postgres SSL-mode warning Next forwards from the server), and no server errors.
- Decisions: see the Decisions table (2026-10-30, P19) in `progress/decisions.md`. The overdue copy is Q-142 a. The additive argument is `reconcileFromStripe(id, { actor?, claim?, captureOutcome? })`. OQ-31 is an owner answer (Decline is one tap, no confirm). There are no creator-fixable capture codes (07 D74), so every permanent capture failure ends in T7.
- Open questions: none (Q-142–Q-144 answered).
- Follow-ups for later prompts:
  - **P19b, P19c, P19g, P21, P22e** (suites on the scripted double):
    - Install it with `tests/helpers/scripted-suite.ts`: the one-statement registry `vi.mock` in its header, then `scripted = installScriptedPayments()` in beforeEach.
    - Then `afterEach(finishScriptedTest)`, with `recordStderr(AFTER_FAILED)` in beforeEach; or call `expectScriptPlayed()` and `expectInvariant(id)` yourself.
    - Read endings with `tests/helpers/request-outcomes.ts` and cancels with `scripted.cancels()`.
    - Any [int] suite whose code schedules after() work should watch for a failed task, as approve, authorization and email-outbox do: `recordStderr(AFTER_FAILED)` in beforeEach, then `endStderr()` after `flushAfter()` and `dropStderr()` in afterEach's finally. Its own `captureLogEvents` calls nest inside that recording.
  - **P19b, P19c, P33a** (cron):
    - Each new step goes after the reconcile and expiry steps (02 §8.4) and takes `stopAt`:
      - P19b: `sweepMoneyMovements`, `moneyMovements`.
      - P19c: `retryAutoApprovals`, `autoApprovals`, before the email retry.
      - P33a: `abandonStaleCheckouts`, `abandoned`, before the email retry, with its one-shot `cleaned` after the loop.
    - Each also updates `src/app/api/cron/expire-requests/route.test.ts`: a `vi.mock` for the step's module; its key in the exact JSON text, both `toEqual` objects and the call-order list; the 401 not-called checks.
    - Each also updates the one `toEqual` in `tests/integration/expire-requests-cron.test.ts`. Its other runs assert zeros with `expectNothingDone` or a sum, so a new key must be 0 there.
    - "Nothing is due" means every step returned less than its limit.
  - **P19c:**
    - `displayStatus`'s `overdue` input is where "processing for auto rows that aren't overdue" goes.
    - The /dashboard lazy call is `settleCreatorRequests`.
    - Auto-approve passes the system actor (`approveLicenseRequest` answers a non-creator `not_actionable`/null today).
  - **P19g:**
    - Keep the decline reason inside `finishCanceled`'s transaction, before `lockHeld`.
    - Extend `declineScope` with the system actor and the exclusive conflict.
    - `declinedView` and `REQUEST_EMAIL_COPY.declinedBody` gain the exclusive body.
    - `inbox.responsive.spec.ts` now pins two waiting rows: h1 2 → 1, "Waiting 2" → "Waiting 1", the `[data-licensee]` order and History 2. An exclusive row bought before the first Inbox visit changes those.
  - **P21:**
    - `declineLicenseRequest(id, admin, "video_disabled")` needs `declineScope` extended.
    - `expireLicenseRequest` takes any actor and never throws after its claim.
    - A declined row keeps `payment_action = 'decline'`: finished rows keep their claim, so A.4's "claim cleared" doesn't hold.
  - **P22:**
    - `expiry.spec.ts` reuses the dev clock: `dev-expire-request --no-cron` prints one JSON line `{ requestId, expiresAt, cron: null }`, and "nothing to do" exits 1. Run it with `NODE_ENV: "test"`, as `inbox.responsive.spec.ts` does, then call the cron route itself.
    - `decline.spec`: assert the line inside `<main>` (exact) and the toast as `ol > li`, because the line, the toast and Radix's announcer share the sentence.
    - Any spec that dispatches a focus refresh (or waits for the 30 s tick) and then navigates must first await `requestEnded(page, isRouterRefresh)` (`tests/e2e/helpers/press.ts`). WebKit cancels the in-flight refresh, and Next falls back to a hard navigation that interrupts the goto.
  - **P24/P25:**
    - Give the Stripe client an explicit `timeout`. Size it so timeout × (maxNetworkRetries + 1) plus backoff fits the pages and their actions (60 s, including the re-render that `refresh()` runs inside the action), the cron's 45 s budget, and /r (no maxDuration).
    - Map an "already canceled" cancel error to ok only when Stripe reports the PaymentIntent canceled. Any other unexpected state is permanent and goes to the reconcile, so a decline racing a late capture never stores `declined`.
  - **P26:**
    - A request-received or request-new retried after a decline or expiry still says "hold"; skip obsolete ones then.
    - Give the Resend driver a per-send timeout well under the cron's 15 s reserve.
  - **P33a:** `abandonStaleCheckouts` uses `CRON`; add a `--checkout` flag on the dev script's parser.
  - **P33b:** `request-expired-buyer` makes "We'll email you either way." true for expiries. CORE sends none, and J8.6 accepts /r.
  - **Later, layout polish:** from md, the Decline column narrows the row's text column (about 218 px at 768). A grid split would keep 05's Tablet frame on one line.
  - **Known:**
    - The Inbox's counts can trail the list by one refresh after a stuck claim resolves (the layout's cached summary).
    - After an expiry whose cancel failed transiently, /r keeps the stored waiting view ("Expires in 0 min" plus AutoRefresh, 04 §9.10) until a later expiry succeeds.
  - **Plan-kit fixes:**
    - P19:
      - Task 1's `reconcileFromStripe(id)` and Task 5's `{ captureOutcome }` drop the actor and the claim.
      - `cancel(row.currency, …, row.stripeAttempt)` must be the claimed row's.
      - Task 1's "the claim stays" holds only when Stripe can't be read.
      - Task 4's "if P17 didn't write it" (`retryEmailOutbox` exists), its expire-first step order (06 §9 reconciles first) and "loop until 60 s" under `maxDuration = 60`.
      - Task 7 omits J8.15 (P19b's Step 0 needs it), J8.8 Approve-vs-Decline, J8.7 and J8.5.
      - Step 0 and Verify run commands that AGENTS §2 replaces (two `test:e2e` invocations).
      - Verify's `ls .data/emails | grep request-declined` "one file" can't hold: the folder is shared with the e2e app, and file names carry no request id. P19b's Step 0 has the same problem.
      - The Verify grep misses `db` and `.transaction(` split over lines.
      - Question 1 (a) says "from effectiveStatus", which 02 §4.4 rule 3 forbids.
    - P19b:196, "Update only the key assertion in P19's cron [int] test", misses the route's unit test.
    - P19g: its Step 0 glob should be `'!**/*.test.ts*'` and ignore comments.
    - P21: its Step 0 grep path misses `src/lib/licensing/request-status.ts` and `src/emails`.
    - 02 §5.7:
      - `declineLicenseRequest`'s status non-null.
      - `reconcileFromStripe(requestId): Promise<TransitionResult>`.
      - `expireDueRequests` without actor or `stopAt`.
      - `reconcileStuckClaims` without `creatorId` or `stopAt`.
    - 02 §5.10's `retryEmailOutbox` has no `stopAt`.
    - 02 §5.11 says "false if unset" (env requires CRON_SECRET).
    - 03 §7.10's expire query lacks `payment_action IS NULL`.
    - 03 T7 says "Cancel claim".
    - 06 §9 says "the claiming path finishes" decline and expire claims; the webhook does too.
    - 07 D57 and §11 say "P19" for purge-social-cache (old number; now P27).

### P19b — Pay the creator: transfer after approval (separate charges and transfers) · [ ] to do
> 90 min · Depends on: P19, P18 · Record: Q1–Q4 answers, the `sendCreatorTransfer` second argument, `maxDuration = 60` on Settings, where `CREATOR_FIXABLE_TRANSFER_CODES` lives
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P19c — Creator settings: approval window and auto-approve · [ ] to do
> 105 min · Depends on: P19b, P17, P15 · Record: the Ask 1 wording and Ask 2 rule, the fallback reason values, the nested `after()` finding, the follow-up "P19d adds the per-video price editor"; status line "Current prompt: P19d · Last verified: P19c"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P19d — Per-video base price and music re-enable · [ ] to do
> 90 min · Depends on: P19c, P13, P15, P12 · Record: questions 1–2 answers, the `effectiveOptions` callers; status line "Current prompt: P19e · Last verified: P19d"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P19e — Offer exclusive licenses: rate card, per-video setting and the exclusive price · [ ] to do
> 105 min · Depends on: P19d, P12, P13, P05 · Record: the copy answer; migration `0001_exclusive_licenses`; the `computeQuote` / `effectiveOptions` caller lists; status line "Current prompt: P19f · Last verified: P19e"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P19f — Exclusive requests: availability, the reserved state and the video lock · [ ] to do
> 105 min · Depends on: P19e, P15, P16a, P16b, P14a · Record: Ask 1–3 answers (Perpetual → exclusive term, copy, date format), `assertStillLicensable` for T2, the lock order video → `license_request`, `availabilityRefusal`, the factory overrides; status line "Current prompt: P19g · Last verified: P19f"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P19g — Approve an exclusive license: the lock re-check and the exclusive record · [ ] to do
> 90 min · Depends on: P19f, P18, P19, P19c, P17 · Record: the copy answer, how the snapshot handled `exclusive` / `renewalOfCode`, the `exclusive_conflict` decline path; status line "Current prompt: P20 · Last verified: P19g"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P20 — Buyer delivery, license PDF and public verification (J9, J10) · [ ] to do
> 120 min · Depends on: P19g, P19b, P19, P10a · Record: Q1, Q2 answers, Helvetica limits, e2e helpers added; the exclusive rows on `/l`, the PDF and `/verify`; `publicStatus` with `upcoming`; status line "Current prompt: P20b · Last verified: P20"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P20b — Buyer sign-in and My licenses · [ ] to do
> 105 min · Depends on: P20, P04, P16a · Record: Ask 1–3 answers, migration `0002_buyer_licenses` and the backfill counts, the landing rule, the names added; status line "Current prompt: P21 · Last verified: P20b"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

**M6 Admin and Gate A** · P21–P22 · 5.25 h

### P21 — Admin view · [ ] to do
> 90 min · Depends on: P20b, P20, P19g · Record: questions 1–2 answers (the `stillOpen` behavior, disable labels), both e2e admin addresses from `.env.test`, the «Exclusive» columns and the `license_request.exclusive_conflict` Events flag
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P21b — Revoke a license with an automatic refund · [ ] to do
> 105 min · Depends on: P21, P19b, P20 · Record: questions 1–3 answers and the contract deltas they cause; status line "Current prompt: P22 · Last verified: P21b"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P22 — The 5-minute demo end to end (Gate A) · [ ] to do
> 120 min · Depends on: P21b, P21 · Record: the Gate A block below, signed off by the owner (≤ 5:00, ≤ 5 screens, ≤ 13 taps)
- Done:
- Verified: three consecutive runs (pass counts, durations) on `chromium-desktop` and `webkit-iphone`:
- Decisions:
- Open questions:
- Follow-ups for later prompts:
- **Gate A:** owner's timed demo m:ss (≤ 5:00) · S10 screens / taps (≤ 5 / ≤ 13) · manual CORE ACs ticked · `exclusive-offer.spec`, `exclusive.spec` and `my-licenses.spec` green (J12, 07 D128) · sign-off by the owner in chat on YYYY-MM-DD · or "Gate A pending owner"

**M6b Exclusive renewals (fake driver)** · P22b–P22h · 13.25 h

### P22b — Renewal schema, the renewal plan and the renewal state machines · [ ] to do
> 105 min · Depends on: P22, P19g, P20b · Record: Ask 1–2 answers, migration `0003_renewals` (4 migrations applied), the display precedence, the `RenewalView` fields, the renewal constants as built (07 §10.2: `RENEWALS_CRON_UTC`, `RENEWAL_MAX_OFF_SESSION_ATTEMPTS = 2`, `RENEWAL_REMINDER_SLOTS_BY_TERM`, `PRICE_DECLINE_NOTICE_VERSION`; no `RENEWAL_CHARGE_LEAD_HOURS` or `RENEWAL_RETRY_OFFSETS_HOURS`); status line "Current prompt: P22c · Last verified: P22b"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P22c — Auto-renewal opt-in at checkout: verified email, consent and the saved card (fake) · [ ] to do
> 105 min · Depends on: P22b, P20b, P19f, P16b · Record: Ask 1–2 answers, the consent text version, the fake saved-card ids; status line "Current prompt: P22d · Last verified: P22c"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P22d — Renewal schedule: the 45-day price lock, reminders and the renewals cron · [ ] to do
> 120 min · Depends on: P22c, P17, P19 · Record: Ask 1–3 answers, the schedule goldens (two time zones; 30-day, 6-month and 1-year terms anchored to the renewal date), the reminder email keys, the cron JSON keys, the dev-clock script; status line "Current prompt: P22e · Last verified: P22d"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P22e — Renewal charge on the fake driver: new term, creator transfer, retries and recovery · [ ] to do
> 120 min · Depends on: P22d, P19b, P16b · Record: Ask 1–3 answers and the guard codes (incl. `price_change_pending`, `notice_guard`, `not_attempted`), the charge-slot goldens and the attempt rule (one attempt in the charge-day run, a second only before the cutoff), the dev-clock walk that produced `charged: 1` (`--ends-in 44d` → `--ends-in 20d` → `--ends-in 3h`, 07 D134; P25c copies it), the renewal transfer row, the recovery Checkout on the fake driver; status line "Current prompt: P22f · Last verified: P22e"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P22f — Renewal price changes: proposals, acceptance and the price lock · [ ] to do
> 120 min · Depends on: P22e, P20b · Record: Ask 1–3 answers, the decline-notice and unanswered-increase behavior (OQ-53), one email per answer (`renewal-price-response`), the proposal rules inside and outside the lock, `RENEWAL_RECORD_TEMPLATES`; status line "Current prompt: P22g · Last verified: P22f"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P22g — Turn off auto-renewal, manual renewal and the 30-day reservation · [ ] to do
> 120 min · Depends on: P22f, P21, P21b · Record: the Ask 1 answer, the turn-off order and warning text version (no reservation after a buyer turns it off, OQ-47; turning off applies an open proposal, 07 D138), the reservation rules (OQ-46), the disable and revoke hooks; status line "Current prompt: P22h · Last verified: P22g"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P22h — Renewals end to end on the fake driver (Gate R) · [ ] to do
> 105 min · Depends on: P22g, P22, P21 · Record: Ask 1–3 answers, the Gate R block below, signed off by the owner, the cron JSON of the README walk, the J12/J13 checklist; status line "Current prompt: P23 · Last verified: P22h"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:
- **Gate R:** `renewals.spec.ts` three green runs on `chromium-desktop` + `webkit-iphone` (dates, pass counts), incl. the 1-year and the 30-day chain, the decline notice dismissed then acknowledged, and an unanswered increase accepted later · S11 record · the renewal journeys walked by the owner · sign-off by the owner in chat on YYYY-MM-DD · or "Gate R pending owner"

**M7 Real services** · P23–P30 · 20.25 h

### P23 — Swap in Cloudflare R2 storage (incl. multipart) · [ ] to do
> 105 min · Depends on: P22h, P22, P20b, P10a, P10c · Record: R2 manual checks 6a–6e (part PUTs 200 with ETags or the D80 fallback, resume and abort on R2, HEAD + magic bytes, `content-disposition: attachment` on the signed GET, 403 after 5 minutes, the lifecycle rule)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P24 — Stripe test-mode spike and real Connect onboarding · [ ] to do
> 120 min · Depends on: P23, P05 · Record: the "Stripe spike (P24)" block below (CAD account); v2 or v1; the `createOnboardingLink` signature; how `env.ts` names the per-currency variables; the negative-balance setting result (S1). No owner question is asked here (07 §10)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:
- **Stripe spike (P24, CAD account):** S1 v2 or v1 for a Canadian individual account · S2 capability statuses before/after onboarding with the Canadian test values · `capture_before` path · `risk_level` · S3/S4 CAD settlement (`balance_transaction.currency = cad`) + `fee_details` (Canadian and non-Canadian card) · S4 CAD `source_transaction` transfer with no conversion · events for pay, capture, cancel, transfer · S5 creator-fixable transfer codes (or "none") · S6 refund + reversal before/after a payout · S7 what an under-18 DOB shows (recorded only; the app is 18+) · S1 negative-balance setting: `debit_negative_balances` set and read back on the Canadian account (accepted, or refused with the error; `balanceSettings` in the stripe@23 typings yes/no; on refusal the fallback decision of 07 D139)

### P25 — Stripe Checkout, webhooks and capture/cancel (Gate B) · [ ] to do
> 120 min · Depends on: P24, P19, P19b, P19c · Record: the Gate B block below, confirmed by the owner; spike S8
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:
- **Gate B (CAD account):** CA$1,732.50 platform charge captured · no application fee · one CA$1,575.00 transfer to the Canadian test creator with `source_transaction` = the charge · platform net = CA$157.50 minus fees · declined PI Canceled with no transfer · webhooks on `/api/stripe/webhook/cad` · `demo-stripe.spec` (S1b), S6 and S8 green · owner confirmed in chat on YYYY-MM-DD

### P25b — Stripe refunds and transfer reversals (revoke in test mode) · [ ] to do
> 60 min · Depends on: P25, P21b, P24 · Record: the "Stripe refunds (P25b)" block, the 7a negative-balance result, the owner's sign-off; status line "Current prompt: P25c · Last verified: P25b"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P25c — Stripe: save the card at checkout and charge renewals off-session · [ ] to do
> 120 min · Depends on: P25b, P25, P22h · Record: the Stripe renewal spike R1–R4, R10, R12 on the CAD account, the saved-card fields, the off-session PaymentIntent and its transfer; status line "Current prompt: P25d · Last verified: P25c"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P25d — Stripe: renewal recovery Checkout, 3-D Secure and card updates · [ ] to do
> 105 min · Depends on: P25c · Record: spike R5–R9, R11, the S12 Stripe renewal sign-off block below, the owner's confirmation; status line "Current prompt: P26 · Last verified: P25d"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:
- **S12 Stripe renewal sign-off (P25d, not a gate):** off-session renewal PaymentIntent (automatic capture) with one transfer of the renewal license price · 3-D Secure card `4000 0027 6000 3184` recovered through the renewal Checkout · `demo-stripe-renewal.spec.ts` (`@stripe`, local) green · owner confirmed in chat on YYYY-MM-DD

### P26 — Swap in Resend email delivery · [ ] to do
> 60 min · Depends on: P25d, P25b, P25, P17, P22h · Record: which of the 16 CORE templates (the five request emails and the eleven renewal emails, 07 §9.2) arrived in a real inbox with working links, recipient-zone times and CA$ amounts; `ownerEmail()` as the test-sender allowlist (OQ-02, OQ-20 answers)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P27 — YouTube: first real platform (Gate C) · [ ] to do
> 120 min · Depends on: P26, P09 · Record: the Gate C block below; whether the phone and in-app connect checks moved to P28; the new test user (OQ-22 answer; handle only)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:
- **Gate C (S2):** real YouTube channel connected · its posts in the Library · a pasted `youtu.be` link verified · one YouTube video published and sold end to end · owner confirmed in chat on YYYY-MM-DD

### P28 — Instagram via an HTTPS tunnel · [ ] to do
> 120 min · Depends on: P27 · Record: tunnel URL, Instagram spike results (which id equals `owner.id`, `shortcode`, the `permissions` shape), manual checks 7a–7e, the J6 phone-on-mobile-data proof
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P28b — Instagram view counts (optional insights permission) · [ ] to do
> 75 min · Depends on: P28 · Record: the spike table and checks 8a–8e; status line "Current prompt: P29 · Last verified: P28b"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P29 — TikTok sandbox spike and adapter · [ ] to do
> 90 min · Depends on: P28b, P28 · Record: the "TikTok sandbox (P29)" block below
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:
- **TikTok sandbox (P29):** branch taken (A adapter live / B mock-only, per OQ-25) · observed thumbnail hosts shown to the owner (OQ-26) · what `video/query` returns for a foreign id

### P30 — Deploy a Vercel preview · [ ] to do
> 120 min · Depends on: P29, P23, P25, P25d, P26, P22h · Record: the Bun install-check lines from the first build log (`bun install v1.4.x`, no `Ignoring lockfile`) and whether the Install Command override was needed, the three crons (incl. `/api/cron/renewals` at `"30 7 * * *"` = `RENEWALS_CRON_UTC`) and the first observed renewals cron run times (UTC; outside 06:31–08:29 is a stop), deployed URL, Hobby plan (OQ-32 answer), reachability option, env var names (no values), the CAD event destination `${APP_URL}/api/stripe/webhook/cad`, the real-phone demo ending at "Valid" on `/verify`, declined PI Canceled with CA$0 captured; the OQ-36 answer line (no tax line yet) under Decisions if hardening is skipped. Then ask the owner about the optional hardening track
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

**M8 Hardening (optional)** · P31a–P33c · 10.5 h

### P31a — Database CHECKs and checkout throttles · [ ] to do
> 105 min · optional · Depends on: P30 · Record: 0 precheck violations for the 23 `[H1]` CHECKs on the dev copy, the test copy and staging; fixture fixes; the staging build-log lines for the migration (or "P31a skipped")
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P31b — CSP, verify limit, token-key rotation and proxy redirects · [ ] to do
> 120 min · optional · Depends on: P31a · Record: CSP header lines from local and staging, zero CSP violations across e2e, WAF rule status (or "P31b skipped")
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P32 — CI and quality gates · [ ] to do
> 120 min · optional · Depends on: P31b (P31), P22 · Record: PR and run URLs, Lighthouse medians, AC totals, branch-protection status (or "P32 skipped")
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P33a — Stale checkouts, payment flags and log cleanup · [ ] to do
> 120 min · optional · Depends on: P32, P25b, P21b, P26 · Record: OQ-27 as "decided with a lawyer; nothing purged", manual checks a, b, b2, c, d and e (e per question 4) (or "P33a skipped")
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P33b — Deferred emails and a verified sending domain · [ ] to do
> 75 min · optional · Depends on: P33a, P26 · Record: the sending domain (or its deferral), manual inbox results (or "P33b skipped")
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P33c — License PDF upgrade: Inter, QR code and stored copy · [ ] to do
> 90 min · optional · Depends on: P33b, P20 · Last hardening prompt: record which "Later" items the owner wants planned next (prompts/INDEX.md "Not scheduled on purpose" and "Later")
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

## Later prompts

Outside the core and hardening totals (07 §3.5, D105): 2 prompts, 225 min (≈ 3.75 h). They are not part of the Log above and no
core or hardening Step 0 checks them. P34 is the last prompt in build order (its Step 0 verifies P33c, or the latest ✅ prompt and at
least P30 when hardening is skipped). P05b stays "not scheduled" in the MVP (18+ only, 07 D93).

**M9 Later (optional)** · P34 · 2.0 h

### P34 — Add USD with a second Stripe platform account · [ ] to do
> 120 min · later · Depends on: P30, P25b, P25, P24, P12, P05 · Run only when the owner decides to add USD. Record: U7's result, `CURRENCY_ACCOUNT_COUNTRY.usd`, the "Stripe USD spike (P34)" and "USD sign-off (P34)" blocks, the deployed USD destination (or "not done"), the operations note (or "P34 not run")
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

**Later, not scheduled** · P05b · 1.75 h (not counted)

### P05b — Teen creators: guardian consent and payouts in the guardian's name · not scheduled (Later, 07 D93)
> 105 min · later · Depends on: P05, P04 · The MVP is 18+ only. Leave this entry as "not scheduled". Before a teen release, P05b is rewritten for the code as it is then.

**Later items with no prompt** (07 §3.4, §3.5, §9.7; `prompts/INDEX.md` → "Not scheduled on purpose" and "Later"). Nothing builds
these in the MVP; P33c asks the owner which to plan next. Record the answer under Decisions.
- `[H3]` `original_pending_key` and background upload across steps; the rest of `[H7]` and `[H8]`; `[H10]` go-live (the `cliplease.com`
  domain with the `cliplease.ca` 308 redirect, live Stripe, platform app reviews).
- Exclusive and renewal extras (07 §9.7): creator emails for renewals; a setup-mode Checkout to turn auto-renewal back on without
  paying; creator non-renewal or withdrawing a proposal; partial or pro-rata
  refunds after a renewal; French renewal terms and emails for Quebec buyers; buyer account deletion in-app; card-on-file usage
  indicators once GA.
- USD payouts for Canadians who bank in USD: planned as its own prompt only if P34's spike U7 passes (07 D140).
- Elysia and the Bun runtime on Vercel (`bunVersion`), only if the owner revisits 07 D107.

## Follow-ups from archived logs

The "Follow-ups for later prompts" of P00–P16, word for word, for the prompts still to do (their entries are in
`progress/log-P00-P16.md`).

- **From P00 — Repo, scaffold and verification commands:** 
- **From P01 — App constants, env guards, design tokens and static pages:** 
- **From P02 — UI primitives and app shell:** 
- **From Simplify pass over P00–P02:** 
- **From P03 — Database schema, migrations and integration harness:** 
- **From P04 — Passwordless sign-in and route protection:** 
- **From P04b — Responsive tiers: tablet and XL for the shell, primitives and pages built so far:** 
- **From P05 — Onboarding, fake payouts and the public creator page:** 
- **From Simplify pass over P04b–P05:** forms built from P06 on use `useFormAction`; page primaries use `PRIMARY_WIDTH`; reading pages use `READING_COLUMN`; "show a toast on arrival" uses `ToastOnMount`; Server Actions use `fieldError` / `formText`.
- **From P06 — Connect a mock social account (OAuth plumbing):** 
- **From P07 — On-demand sync engine:** 
- **From P08 — Connections screen and account lifecycle (J2):** 
- **From P09 — Library: every post in one grid (J3):** 
- **From P10a — Private storage and the multipart upload API:** 
- **From P10b — Plain upload: title page, File step and poster:** 
- **From P10c — Resumable original uploads: retry, resume and cancel:** 
- **From Review — Full-project code review and fixes:** 
- **From P11 — Make a Library post licensable: Source page and verified File step:** 
- **From P11b — Posting links: parse, normalize and verify (no fetching):** 
- **From P11c — “Where was it posted?” step:** 
- **From P12 — Pricing engine and rate card editor (J4):** P13, P15 and P16a call `effectiveOptions(rateCard, { disabledUses, basePriceOverrideCents })` from `src/server/pricing/rate-card.ts`, and P13 renders `PricePreview` with `readOnly` (it adds "Edit your rate card" → `/dashboard/pricing`; any `EffectiveOptions` is a `PreviewOptions`). P16a snapshots `platform_fee_min_cents = PLATFORM_FEE_MIN_CENTS[currency]` and the request `currency`. P19d adds the per-video price editor. P19e adds the exclusive factor to `QuoteInput`, `licensePriceCents` and `EffectiveOptions` (07 D109) and the exclusive fields to `rateCardInputSchema`, whose refinement runs with `when` (keep it covering the new fields). `SHELL_PREFETCH` stays false until P20 builds `/dashboard/licenses`. P15: one wording for the One region tile and Schedule A. Plan kit fixes for the owner: P12 Step 0's `VIDEO_STEPS` rg quotes; "Stripe's 8-digit limit" in 01 J4.5, 02 §5.5, 03 §3.7.1 and 07 D22, D97 is the non-card limit (Q-90); 04 §11.12's multiplier message gave way to Q-91's three.
- **From P13 — Rights and Review steps:** watch two e2e tests that failed once each under the full run's load (see Verified); if either recurs, give the Library's new-tab wait more time and let `collectConsoleErrors` drop WebKit's aborted-fetch "Load failed" the way it drops the offline RSC error. P14a's `publishVideo` enforces `computePublishBlockers` / `getPublishFacts` (same file) and wires Publish; it can drop `RefreshOnCoverDone` if its own Review refresh covers covers. P14a's Rights and Review are drafts only: `VideoStepFrame` takes `stepper={false}` for a non-draft step if it needs one. P19d adds `VideoPriceEditor` and the music Switches above the Review's `PricePreview` (05 callouts 38, 47; settled by 07). P24 carries `returnTo` into Stripe's `return_url` and `refresh_url`. P19b runs the lazy `sweepMoneyMovements` on the Review's `?payouts=returned` as on Settings. P15 reuses `OptionGroup` / `OptionTile` (adding the tile's description and delta), the badge's line 3 and its explainer; it maps `PublicPostings` to a `BadgeInput` the way `ownerBadge` maps the owner's rows (one shared mapping would keep the two from drifting). Plan kit fixes for the owner: P12's fee-floor grep (formatter line breaks); 02 §6.1's `updateVideoDetails({ videoId, title, slug })` now takes either field alone.
- **From P14a — Publish, share link and the public grid (J5, J6):** watch for a plain-`<a>` tap lost during hydration on a fully loaded page (the Library tiles; seen only in e2e right after `page.goto`): if a real report comes in, make the tile links `next/link` now that their pages exist. P14b builds the full video page over `VideoHeader` (its `Menu`, Turn off / on through `publishVideo`, which already re-runs the checks), and can add the 05 §6.8 "4 card skeletons" loading state (a `videos/(list)/loading.tsx` route group, so it doesn't wrap `[id]` and `new`). P15 serves `/u/[handle]/[slug]` behind the card links and the rewrite, reuses `isPubliclyAvailable` (the D72 404), `posterSrc`, `publicBadge` and `publishDemoVideo`, and may switch the public tile to `next/link` once the page exists. P19d and P19e keep `fromPriceCents`' two arguments (the plan writes one). P19f adds the AvailabilityLine to both cards. P22: the S10 count above. P24: real Stripe's `return_url` keeps the Review's `?payouts=returned` redirect to its plain address.
- **From P14b — Video page, turn off/on, delete draft and the demo video seed:** P15 builds `/u/[handle]/[slug]` behind the card links and the seed's printed `/@maya/first-snow` (404 until then), adds "View license page ↗" beside Share… in the video page's aside, and runs `tests/e2e/video-page.spec.ts` by that name. P19d adds `VideoPriceEditor` and the music Switches to the Prices section (it replaces "From {price} (your rate card)") and calls `publishDemoVideo(page, { containsMusic: true })` then Rights _Edit_ (the non-draft Rights route serves `published` too). P19e adds the ExclusiveOfferEditor there, P19f the AvailabilityLine under the badge and on the cards. P21's Disable/Enable use this page's disabled state; `VIDEO_DISABLED_REASON_LABEL` may need exporting for its select. Turn off isn't always reversible: a live video whose verified account was disconnected, or whose rate card lost every use, stays live, but Turn on then shows the blocker (tested). A public poster may stay in a browser or CDN cache for up to `max-age=300` / `s-maxage=3600` after Turn off (P30). A cover PUT that lands after Delete draft's sweep and is never completed stays in the private bucket (no URL ever names it): a P23 sweep of `posters/` folders whose video is gone would catch it with other stray posters. The 05 §6.7 "section skeletons" and §6.8 "4 card skeletons" loading states are still not built (a route-group `loading.tsx`). Plan kit: 02 §3's `/dashboard/videos` row should list `deleteDraftVideo`; 07 D53's "draft under stripe" and 02's setup step 4 are stale (V1 is published under both drivers, 03 §8.1, the prompt); 02's "Original post was removed" vs 01 J3.9's copy (01 used).
- **From P15 — License page: options and live price (J7 part 1):** **P16a** enables the PriceBar's button (flip `license-page.spec.ts`'s two `toBeDisabled()`; "Choose a country / region" then focuses the select by `TERRITORY_SELECT_ID`, 04 §9.3), reads `territoryCode` "" as null and an empty `timeZone` as absent before `StartCheckoutSchema` (Worldwide must be null), makes the whole right column inert while starting checkout (the tiles sit outside the form), and treats a `submissionId` brought back by Back / bfcache as a resubmit. **P19c** adds `autoApprove` to the DTO and the auto hold copy. **P19d**: the per-video base editor and music re-enable; `publishDemoVideo(page, { music, people })` already passes Rights answers (P19d planned `{ containsMusic }`). **P19f**: License type tiles reuse `OptionTile`'s `reason`; the summary's "You get" group placement (code second, 01 §4.7 before Not included, 04 §9.5 first). **P20** reuses `PostingList` (a snapshot row needs `removed` and `hasLink`, or maps them from `url`), `LicenseSummary` with `licenseSummary({ …, termPhrase: "until {end_date}" })` and `creditLine`. **P27**: the official YouTube icon as its own `<a>` beside "View on YouTube ↗" in `PostingList` (marked in `buyer-rows.ts`, as on the Source page; 04 §8.2). **/@handle**: `listPublicVideos` still lists a video with no From price, whose link 404s (nothing fits); filter it there. **Schedule A**: P01's and P12's "P15: render Schedule A from the options" wasn't in this prompt and is still text; its region sentence ("North America is Northern America (the US and Canada) …") predates Q-106 b (BM, GL, PM in no region, TW in Asia-Pacific): both go on the OQ-28 lawyer list. **Plan-kit fixes:** P15 Step 0's `export function videoUrl` grep (`export const`); 04 §3.1, §5.3 and §9.4's 92 px `--pricebar-h` (108 below lg now); 04 §5.2.5's "5 + 7 of 12" for the license page (D148: 1–5 and 7–12); P15 Task 4's `loading.tsx` (Q-110 a); P15 Task 3's "Create src/server/videos/public.ts" (it existed).
- **From P16a — Fake checkout and payment authorization (part a): server-priced request and checkout hand-off:** **P16b**: Pay and Let it expire in `src/app/dev/fake-checkout/[requestId]/actions.ts` through `openFakeCheckout(...).returnPath(...)` (`{ session_id: "cs_fake_<id>" }` for Pay); `reconcileCheckoutReturn` accepts a return only when `retrieveCheckout(...).status === "complete"` (the fake session is `open` while pending, Q-119 a); `/r`'s `session_id` branch and the `viewOf` switch; re-check that the video is published when the hold is authorized (Q-122 a). Its Step 0 grep for `isFakeCheckoutEnabled` finds the guard and its test; a multi-line grep there needs `rg -U` (Biome's line breaks, Q-71). **P17**: the email sender is `revealBuyerToken`'s other caller (`rg -ln revealBuyerToken src --glob '!**/*.test.ts'` should list only `buyer-token.ts`, `fake-checkout.ts` and the sender); "See request status" links through `requestStatusPath`; `/r`'s other states replace the 404. **P19f**: `lockVideoForLicensing` and `getLicenseAvailability` in `createLicenseRequest`'s transaction (Q-122 a). **P20/P21**: `download_event` rows take `requestContext()` (the IP checked, the agent already cut to 512). **P20b**: matches a signed-in buyer by the stored `normalizeEmail` value. **P22c**: the request context gains the session user. **P25**: `requestStatusPath(id, token, { session_id: "{CHECKOUT_SESSION_ID}" })` stays unencoded for Stripe; the line item reads `CHECKOUT_COPY.serviceFee`. **Plan-kit fixes:** the acceptance grep `rg -n "['\"]usd['\"]" src/server --glob '!**/*.test.ts'` prints nothing (the maps use bare `usd:` keys); 04 §9.4 lists no `not_available` refusal state; 02 §5.11 types `findRequestForBuyer` as `LicenseRequestRow` (the type is `LicenseRequest`); 07 D14, 02 §5.11, §9.5 and 03 DB7, I19 name the email sender as the only decrypter (Q-118 a adds the dev fake checkout).
- **From P16b — Fake checkout and payment authorization (part b): authorization through the event path:** **P17**: `applyTransition`'s `effects` (empty) carry the outbox; `/r`'s other states replace the 404 (an overdue `awaiting_approval` row shows "Waiting" until P17's `displayStatus`); one refresher: `RefreshingMessage` or P17's `AutoRefresh`, not both (P19c); P17 adds `after(() => retryEmailOutbox(…))` to the fake Pay; its Step 0 item 5 expects `72:00:00`, which Postgres prints as `3 days` (check `extract(epoch from expires_at - authorized_at)/3600` = 72). **P18 / P25** (Q-123 a): `markAuthorized`'s `succeeded`-while-`checkout_pending` branch only audits; P18's `reconcileFromStripe` has no `checkout_pending` branch and 07 §2.2 no `checkout_pending → approved` edge, so P18 (or P25, whose [int] at P25:78 expects "the D32/D25 path plus an admin Events flag, never a second license") decides it: asserts → T2 → T5, or the audit plus the Events flag; P33a reuses P25's function and audit name. **P18**: `effectiveStatus` already returns `processing` only for a claimed `awaiting_approval` row; `TransitionResult.row` gives the attempt; a zero-row guarded update returns `changed: false` with no audit (room for P22e's fence). **P19**: extends `tests/helpers/scripted-payments.ts` (`createScriptedPayments`: `driverFor(currency)`, `log`, `callsOf`, `script`; a cancel's log entry has its key and the request's committed status); a thrown cancel is audited `kind: "ambiguous"` until the wrapper stops throwing. A crash between an abandon's commit and its cancel leaves the hold to lapse at `capture_before` (07 D27, uncharged); a sweep re-cancelling with the same key would be [H4]'s or P33a's. **P19c**: schedule auto-approve in `markAuthorized` on `changed: true`; `DEFAULT_APPROVAL_WINDOW_HOURS` is in `expires-at.ts`; "Processing…" can reuse `RefreshingMessage`. **P19f**: `lockVideoForLicensing(tx, row.videoId)` in `decideAuthorization`'s transaction, where `videoAvailable` reads the video, before `applyTransition`. **P22b**: `TRANSITIONS.renewal_pending`, the renewal events, `LicenseRequestPatch`'s renewal columns and their `patchProblem` rules. **P22c**: `authorizationMismatches` is the D32 assert block to extend. **P22e**: the fake checkout's events use `FakeCheckout.sessionId`. **P25**: `onWebhookEvent` stays in `src/server/payments/events.ts`; the Stripe driver re-exports `HOLD_SAFETY_MARGIN_HOURS` (P25 lists no step for it); the route refuses `livemode` before the claim (CHECK `stripe_event_test_mode_only` would throw 23514). **Plan-kit fixes:** P16b's Verify and P17 Step 0 item 5 expect `72:00:00` (Postgres prints `3 days`); P16b Step 0 item 3's wrapper grep needs `rg -U … \(\s*currency`; 05 §10 draws two of the fake checkout's three buttons (Let it expire: 02 §5.8, 07 D35); P25 has no step re-exporting the margin; 02 §8.3 step 5 ends on "We'll email you" where 05 §4.3 and the prompt show the body; 03 §7.10's claim is `DO UPDATE … attempts + 1` where 02 §8.1 and the prompt re-run only unprocessed rows; P16b Task 3's "`license_request_id` when known" at the claim would break the foreign key for an unknown id (set once resolved); 02 §5.8 lists `onWebhookEvent` in `index.ts` (it lives in `events.ts`).

## Decisions

In `progress/decisions.md` (moved 2026-10-29, audit D5): every judgment call, newest last. Add new rows at the end of
that table; a log entry's "Decisions: see Decisions (date, prompt)" points there.

## Owner answers (07 §4.1)

These are final. No prompt asks them again; each states the answer in one line (07 D63). "Changes the plan" rows are built by
D63–D92 (07 §7), for the 2026-10-16 rows (OQ-21, OQ-29 revised; OQ-39, OQ-40 new) by D93–D106 (07 §8), for OQ-41–OQ-48 by
D107–D131 (07 §9), for OQ-34–OQ-38 and OQ-49–OQ-53 by D132–D143 (07 §10; it wins over §1–§9), for OQ-54 by D144–D158 (07 §11; layout only), for OQ-55 and OQ-56 by D159–D160 (07 §12), and OQ-57 needs no decision (07 §12.3: 01 J12.4 and 04 §9.35 already say it). On the exclusive and renewal rules
`docs/08-exclusive-renewals-owner-spec.md` wins.

| ID | Owner's answer | Changes the plan? | Status |
|---|---|---|---|
| OQ-01 | Neon, with `dev` and `test` branches; Postgres 18 (the owner chose 18 over the planned 17 in P03); the tests use a local Postgres 18 instead of the `test` branch (Q-87) | small (P03 Decisions: Postgres 18, RESTRICT = 23001, P32's CI image) | answered 2026-10-15, revised 2026-10-17 and 2026-10-23 (Q-87) |
| OQ-02 | Two admins (owner + helper) in `ADMIN_EMAILS`, comma-separated, owner first | small (D88) | answered 2026-10-15 |
| OQ-03 | The agent generates the fixture with ffmpeg | no | answered 2026-10-15 |
| OQ-04 | Revised: creators always upload the original; ClipLease never downloads or imports video from a platform | no (D64) | answered 2026-10-15 |
| OQ-05 | Creators publish and sell before payouts; Approve needs payouts | yes (D74, D77) | answered 2026-10-15 |
| OQ-06 | Badge names a platform only when verified through it; otherwise "Self-attested by the creator" | clarifies (D89) | answered 2026-10-15 |
| OQ-07 | Dots allowed; handles immutable in the prototype | no | answered 2026-10-15 |
| OQ-08 | ×1.00–×10.00 in 0.05 steps, no discounts; whole-dollar base | no | answered 2026-10-15 |
| OQ-09 | Stripe's limit (CA$999,999.99 total; `MAX_TOTAL_CENTS[currency]`) | no | answered 2026-10-15 |
| OQ-10 | Originals up to 2 GB; multipart, resumable uploads are CORE | yes (D80) | answered 2026-10-15 |
| OQ-11 | Build now: auto-approve, approval window 24/48/72/120 h, per-video base price, music re-enable | yes (D81, D82) | answered 2026-10-15 |
| OQ-12 | "Money moved late" flagged for an admin; manual runbook | no | answered 2026-10-15 |
| OQ-13 | Admin revoke refunds the buyer in full and takes back the creator's share | yes (D86) | answered 2026-10-15 |
| OQ-14 | Keep "Verified" with "· no longer linked" after disconnect | no | answered 2026-10-15 |
| OQ-15 | Several accounts per platform, no cap | no | answered 2026-10-15 |
| OQ-16 | Newest 200 per account plus "Load older" | no | answered 2026-10-15 |
| OQ-17 | Unlisted YouTube allowed (link hidden by default); private blocked | no | answered 2026-10-15 |
| OQ-18 | Fee = max(10 %, CA$2.00) now (`PLATFORM_FEE_MIN_CENTS[currency]`) | yes (D79, D97) | answered 2026-10-15 |
| OQ-19 | Emails show the recipient's local time with a zone label + UTC; zone from the device | yes (D84) | answered 2026-10-15 |
| OQ-20 | Resend test sender, owner only; real domain later | no | answered 2026-10-15 |
| OQ-21 | Revised: CAD and USD, one Stripe platform account per currency, CAD only in the MVP; each creator's `payout_currency` sets their prices, license page, platform account and every money record; USD is the Later prompt P34 | yes (D94–D99; D78 superseded) | answered 2026-10-16 |
| OQ-22 | New test accounts (Instagram Creator/Business, Google test user with a channel, TikTok target users) | small (D90) | answered 2026-10-15 |
| OQ-23 | Cloudflare named tunnel | no | answered 2026-10-15 |
| OQ-24 | Instagram view counts as an optional permission; shown only if granted | yes (D83) | answered 2026-10-15 |
| OQ-25 | Mock TikTok until review if the sandbox returns no videos | no | answered 2026-10-15 |
| OQ-26 | Allow the TikTok thumbnail hosts observed in the spike | no | answered 2026-10-15 |
| OQ-27 | Retention decided later with a lawyer; keep license, payment and download records; no automatic purge | yes (D87) | answered 2026-10-15 |
| OQ-28 | Placeholders + DRAFT banner until the paperwork exists | no | answered 2026-10-15 |
| OQ-29 | Revised: creators must be 18 or older ("I'm 18 or older", `age_confirmed_at`); the teen/guardian flow is Later (P05b not scheduled) | yes (D93; D85 Later) | answered 2026-10-16 |
| OQ-30 | Music/people: notice + license clause; Paid ads stays on | no | answered 2026-10-15 |
| OQ-31 | Signal Green `#1BCB80`; Decline stays one tap | no | answered 2026-10-15 |
| OQ-32 | Vercel Hobby for now | no | answered 2026-10-15 |
| OQ-33 | "Where was it posted?": every place posted is attached, links optional, Verified only by id against linked accounts, never fetched; buyers see all postings | yes (D65–D73) | answered 2026-10-15 |
| OQ-34 | The USD platform account is a second Canadian Stripe account with a USD bank account and USD settlement (P34) | no (D141) | answered 2026-10-16 |
| OQ-35 | Creators with a US bank account may choose US-dollar payouts; Canadians who bank in USD may too, but only if P34's spike U7 shows Stripe pays them in USD without conversion (then planned as its own Later prompt); a creator's currency can't change once their Stripe account exists or a buyer has paid | yes, P34 only (D140) | answered 2026-10-16 |
| OQ-36 | No sales tax line on the service fee in the prototype; the owner's accountant decides before live mode | no (D141) | answered 2026-10-16 |
| OQ-37 | When a revoke's transfer reversal leaves a creator's CAD Stripe balance negative, Stripe may debit the creator's bank account (`debit_negative_balances` on every connected account of the CAD platform, set when it is created); creators are told in the Terms and at payout setup; P24/P25b verify Canadian support in test mode; if Stripe refuses, the admin follows up | yes (D139) | answered 2026-10-16 |
| OQ-38 | A chargeback is flagged for the admin only; the creator's transfer is never reversed automatically | no (D141) | answered 2026-10-16 |
| OQ-39 | The product is ClipLease (`APP_NAME`); `https://cliplease.com` is the one canonical origin and cliplease.ca redirects to it; email from `ClipLease <hello@cliplease.com>` once the domain is verified | yes (D100–D103) | answered 2026-10-16 |
| OQ-40 | The app repo is `/Users/anthonyshadowitz/Documents/ClipLease/App/ClipLease` (package `cliplease`); the kit is `../../mvp-plan` from it | yes (D104) | answered 2026-10-16 |
| OQ-41 | Exclusive licenses are in the MVP: the creator offers them per video or for all videos; buyers see them only when available | yes (D109–D111) | answered 2026-10-16 |
| OQ-42 | Exclusive covers everything for the term (no other license of any kind); buyable only when the video has no running license and no pending request; a pending exclusive request reserves the video | yes (D110, D111) | answered 2026-10-16 |
| OQ-43 | Exclusive terms are at most one year, with buyer-chosen auto-renewal (never default), renewal price changes, the 45-day price lock and the 30-day renewal reservation, exactly as docs/08 (lengths, charge date and declines refined by OQ-49, OQ-51, OQ-53) | yes (D112–D125) | answered 2026-10-16 |
| OQ-44 | Default exclusive premium ×3 the normal price; the creator can change it | yes (D109) | answered 2026-10-16 |
| OQ-45 | Bun 1.4.3 as package manager and script runner only; Node 24 runs the app, tests and CLIs; Vercel stays on Node (no `bunVersion`); Drizzle unchanged; no Elysia (rules R1–R4) | yes (D107, D108) | answered 2026-10-16 |
| OQ-46 | During a renewal reservation every new license (exclusive or not) is blocked | yes (D110, D122) | answered 2026-10-16 |
| OQ-47 | A buyer who turns auto-renewal off gets no reservation and first confirms a clear warning; the reservation applies only when auto-renewal was on and the renewal didn't happen (increase not accepted, payment failed) | yes (D121, D122) | answered 2026-10-16 |
| OQ-48 | Buyers sign in with the same 6-digit email code to "My licenses" (every license, expiry, auto-renewal, agreed price, price changes to accept or decline, reservation, manual renewal); private links keep working | yes (D126) | answered 2026-10-16 |
| OQ-49 | Every exclusive length (30 days, 6 months, 1 year; never Perpetual) can renew; each renewal is a new term of the same length (at most one year); the price lock is 45 days, or the whole term if shorter; reminders adapt to the term (none before the term starts; 7-day and 48-hour always; 30-day only for terms longer than 30 days) | yes (D133, D135) | answered 2026-10-16 |
| OQ-50 | An increase proposed inside the lock never changes the upcoming renewal; the buyer may accept it early, otherwise the 30-day answer window starts on the new term's first day | no (D141) | answered 2026-10-16 |
| OQ-51 | The renewal is charged on the renewal date shown on the license (the end of the current term), in that day's renewals cron run (not 72 hours early); the renewal date and whether auto-renewal is on are shown on the license, in My licenses and in every reminder; if the charge fails or needs the buyer and isn't completed by the end, the 30-day reservation starts (no automatic charges during it; the buyer can renew manually) | yes (D134–D136) | answered 2026-10-16 |
| OQ-52 | The buyer confirms their email with the 6-digit code before turning on auto-renewal | no (D141) | answered 2026-10-16 |
| OQ-53 | Decline shows a notice that auto-renewal turns off right away; acknowledging records the decline and turns auto-renewal off at once; dismissing decides nothing (the proposal stays pending within the 30 days); accept keeps auto-renewal on at the new price; with no answer in 30 days auto-renewal turns off but the proposal stays open (accepting later turns it back on at the new price, declining keeps it off); docs/08 "Owner clarifications" | yes (D137, D138) | answered 2026-10-16 |
| OQ-54 | Fully responsive (2026-10-18): every page also looks right on tablets and XL screens and at any width in between, with the same style, palette and designs; P04b retrofits P00–P04 before P05 | yes (layout only: D144–D158, 07 §11) | answered 2026-10-18 |
| OQ-55 | Fix all four mismatches (2026-10-18, answer 1a) so the prompts match the approved docs: P20's Verify helper quotes `"$1"`; P19f's `LicenseTypeGroup` sits after Territory and before Your details; P19e's `PricePreview` Perpetual line reads "Exclusive: not offered for Perpetual. Exclusive licenses last up to 1 year."; the Inbox row just approved or declined stays in place until the next refresh while the actions keep `refresh()` | small (D160, 07 §12) | answered 2026-10-18 |
| OQ-56 | The buyer NavBar on `/licenses*` (2026-10-18, answer 2a) is 04 §9.30's variant: wordmark → `/licenses`, "My licenses" and the avatar `Menu` (My licenses, Sign out), the same at every tier; it replaces 05's proposed `<Sign out>` text link | small (D159, 07 §12) | answered 2026-10-18 |
| OQ-57 | On the license page, picking Exclusive while Perpetual is selected (2026-10-18) moves the Term to the longest enabled exclusive term (1 year when enabled) and a polite live region says "Term changed to 1 year. Exclusive licenses last up to 1 year."; while Exclusive is selected Perpetual stays disabled with "Exclusive licenses last up to 1 year." (01 J12.4, 04 §9.35, §11.2, DS-30); P19f builds it | small (no new decision; 07 §12.3) | answered 2026-10-18 |

## Open questions

None open: every owner question (OQ-01–OQ-57, Q-01–Q-03 from P02, Q-04–Q-05 from P04, Q-06–Q-11 from P05, Q-12–Q-15 from P06, Q-16 from P07, Q-17–Q-24 from P08, Q-25–Q-33 from P09, Q-34–Q-39 from P10a, Q-40–Q-44 from P10b, Q-45–Q-51 from P10c, Q-52–Q-61 from the full-project review, Q-62–Q-68 from P11, Q-69–Q-72 from P11b, Q-73–Q-81 from P11c, Q-82–Q-86 from the P10–P11 review, Q-87–Q-89 from the test-speed work, Q-90–Q-93 from P12, Q-94–Q-100 from P13, Q-101–Q-104 from P14b, Q-105–Q-117 from P15, Q-118–Q-122 from P16a, Q-123 from P16b, Q-124–Q-129 from P17 and Q-130–Q-131 from the audit's batch 2, Q-132–Q-135 from its batch 3, Q-136–Q-138 from the code review, Q-139–Q-141 from P18 and Q-142–Q-144 from P19) is answered (07 §4.1, §10; Decisions 2026-10-17 and 2026-10-18). Add new questions below the line with the next free
number (Q-25, Q-26, …); when one is answered, set its status to "answered (Pxx)" and add the answer to Decisions.

| ID | Question | Default if unanswered | Asked in | Status |
|---|---|---|---|---|
| | *New questions go below this line.* | | | |
| Q-01 | Sync-time wording between 1 hour and 1 day (04 §4.4 gives only "just now", "3 min", "3 days") | "Synced {n} h ago", then "Synced 1 day ago" / "Synced {n} days ago", rounded down | P02 | answered (P02): the default |
| Q-02 | How the TabBar marks the current tab (color alone breaks 04 §12.1) | A 2 px ink bar above the icon, plus color and `aria-current` | P02 | answered (P02): the default |
| Q-03 | Screen-reader label of the creator avatar menu button | "Account menu" | P02 | answered (P02): the default |
| Q-04 | How long a sign-in lasts | 7 days, Better Auth's default (extended once a day while used) | P04 | answered (P04): the default |
| Q-05 | Run P04 as one step (6 h budget) or split the logger, audit and seed into a P04b | One step, 6 h budget | P04 | answered (P04): the default |
| Q-06 | Copy for a handle that is too short or too long (04 §11.10 has none) | "Use 3 to 30 characters." *(proposed)* | P05 | answered (P05): the default |
| Q-07 | 05's proposed strings (Stepper labels, name helper, "Checking…", the link preview, the payouts explainer, "Skip for now", "Settings", the toasts, "Go to {APP_NAME}") | Ship as written, listed as proposed | P05 | answered (P05): the default |
| Q-08 | Copy the docs don't give (the shape and name messages, loading labels, the payouts-unavailable line, the creator page title) | Ship the proposed strings | P05 | answered (P05): the default |
| Q-09 | The 18+ box must post as a native checkbox; the primitive is Radix | A `NativeCheckbox` that looks exactly like `Checkbox` | P05 | answered (P05): the default |
| Q-10 | Where the payouts banner's link goes | `/dashboard/settings#payouts` | P05 | answered (P05): the default |
| Q-11 | Five old comments say "birth" or "guardian", which the acceptance search rejects | Reword the comments only | P05 | answered (P05): the default |
| Q-12 | How the mock learns who is connecting (D36 ids need the user id; `getAuthorizeUrl` has no user input) | An optional `mockSubject` (the start route passes the user id for the mock only) | P06 | answered (P06): the default |
| Q-13 | Copy for `error=provider_error` (the redirect carries no platform name) | "Couldn't reach the platform. Try again." | P06 | answered (P06): the default |
| Q-14 | Which scopes `social_account.scopes` stores after a connect | Granted ∩ requested (02 §7.2) | P06 | answered (P06): the default |
| Q-15 | Whether the `missing_scope` Banner gets a "Try again" action | Message only; the Connect rows are the retry (P08 revisits) | P06 | answered (P06): the default |
| Q-16 | How the sync line counts one video (04 §11.8 shows only "24 videos") | "1 video", and "videos" for every other count | P07 | answered (P07): the default |
| Q-17 | A sync running while the creator disconnects can write the profile and posts back | Every sync write re-checks, under a share lock, that the account is still connected and still this run's | P08 | answered (P08): the default |
| Q-18 | Official Instagram and YouTube marks (files only a human may add from each kit) | Words for now; files before P27/P28 | P08 | answered (P08): the default |
| Q-19 | 05's proposed Disconnect copy and Reconnect's pressed label | "Disconnecting…", "Disconnected @name.", "Back to Connections", "Connecting…" | P08 | answered (P08): the default |
| Q-20 | The Disconnect sentence for exactly one live video | "1 live video came from @name. It stays live and keeps its Verified label, …" | P08 | answered (P08): the default |
| Q-21 | A Try again button on the `missing_scope` Banner (P06's Q-15 asked P08 to revisit) | No: the Connect rows are the retry | P08 | answered (P08): the default |
| Q-22 | Which spinner shows while syncing (04 §9.15 vs §9.2) | The standard round LoaderCircle; RefreshCw only on the idle button | P08 | answered (P08): the default |
| Q-23 | Delete P07's `sync-now-form.tsx` once SyncButton replaces it | Delete it | P08 | answered (P08): the default |
| Q-24 | P08 runs well past 2× its estimate | One step with a bigger budget | P08 | answered (P08): the default |
| Q-25 | Tile links before the Source page exists (P10b/P11 build it) | Link there now; the links 404 until P10b/P11 | P09 | default chosen on the owner's instruction (P09) |
| Q-26 | Run `db:seed --demo` against the dev branch | Yes | P09 | default chosen on the owner's instruction (P09) |
| Q-27 | Build `getLibraryPost` now (P10a's Step 0 and P11 expect it; the prompt defers it) | Build it now | P09 | default chosen on the owner's instruction (P09) |
| Q-28 | The strip's `+` caption (05 marks "Add" proposed) and its accessible name | "Add", `aria-label="Add an account"` | P09 | default chosen on the owner's instruction (P09) |
| Q-29 | Busy labels and singular stats | "Loading…" (Show more), "Syncing…" (Load older), "1 view" / "1 like" | P09 | default chosen on the owner's instruction (P09) |
| Q-30 | The stale banner's Sync now (04 §9.15 SyncButton vs §9.21 Banner link) | The Banner's text link | P09 | default chosen on the owner's instruction (P09) |
| Q-31 | Two or more linked accounts with no videos | "No videos found on @a or @b." with one Sync now for all | P09 | default chosen on the owner's instruction (P09) |
| Q-32 | Look-alike banners when several accounts need the same thing | One stale banner; reconnect/problem per account, @name when a platform is shared | P09 | default chosen on the owner's instruction (P09) |
| Q-33 | P09 runs well past 2× its estimate | One step with a bigger budget | P09 | default chosen on the owner's instruction (P09) |
| Q-34 | How complete knows which new poster belongs to the video (no pending-poster column) | A signed, expiring upload token from start (HMAC under `deriveSubkey("poster-upload")`) | P10a | answered (P10a): the default |
| Q-35 | A missing or short part at complete: keep the upload open or end it | Keep it open: 422 `parts_incomplete`, the client re-sends | P10a | answered (P10a): the default |
| Q-36 | Extra safety on the dev storage route | Size caps, the exact type and length signed into a single PUT, write-once objects (signed URLs kept out of the dev log either way) | P10a | answered (P10a): the default |
| Q-37 | Two Step 0 checks that fail only by wording (a comment naming `original_pending_key`; `STORAGE_DRIVER`'s default lives in `.env.example`) | Continue and record them; no code change | P10a | answered (P10a): the default |
| Q-38 | A video disabled while its file uploads | Refuse parts and complete (404); abort still allowed | P10a | answered (P10a): the default |
| Q-39 | An expired checkout that never got its expiry notice and the original lock | Still locks (D09 literal) until the clean-up job arrives | P10a | answered (P10a): the default |
| Q-40 | New copy for the title page and the File step (title errors, Back target, helper, live-region words, cover alt text, "Upload didn't finish…", "Add a cover image for buyers.", two cover-picture errors) | Use them as written, recorded as proposed copy | P10b | answered (P10b): the default |
| Q-41 | Replace when the creator chose their own cover | Keep the chosen cover; take a new frame only when there is no cover or it is a frame | P10b | answered (P10b): the default |
| Q-42 | Tapping another tab while the video uploads | Ask first ("Leave this page? Your upload will stop.") | P10b | answered (P10b): the owner's own answer: don't stop the upload; it carries on across the app's pages with a floating card (progress, then complete or stopped) whose Open goes back to the File step. Follow-up, both the default: the card floats above the TabBar below lg and bottom-right from md; its words "Uploading {title}", "Checking the file…", "Upload complete", "Upload didn't finish", "Open", and "Keep this tab open until the upload finishes. You can use other pages meanwhile." under the drop area |
| Q-43 | Odd characters in titles | Tidy them: line breaks and tabs → spaces, runs squeezed, invisible and direction marks removed | P10b | answered (P10b): the default |
| Q-44 | P10b runs 2–3× its 2-hour estimate | One step with a bigger budget (as P08, P09) | P10b | answered (P10b): the default |
| Q-45 | What `PART_MAX_ATTEMPTS = 5` counts (the prompt's question 1) | Five retries after the first send, waits 1/2/4/8/16 s plus jitter | P10c | answered (P10c): the default |
| Q-46 | The words when the connection drops with the page still open | Two boxes: "Check your connection." with Resume in the same tab, "Choose the same file to continue." after a reload | P10c | answered (P10c): the default |
| Q-47 | The floating card when an upload retries or pauses | "Connection lost. Retrying…" under "Uploading {title}"; "Upload paused at {n}%" with the title, Open and ×; the screen-reader lines | P10c | answered (P10c): the default |
| Q-48 | P10c runs 2–3× its 90-minute estimate | One step with a bigger budget | P10c | answered (P10c): the default |
| Q-49 | The same video open in two tabs at once | Accept it as a known limit and write it down | P10c | answered (P10c): option b, detect the other tab and show "This video is uploading in another tab." |
| Q-50 | Should Cancel's abort name the upload it ends (a late abort can end a newer upload)? | Leave it as a noted follow-up | P10c | answered (P10c): option b, do it now |
| Q-51 | 109 leftover upload folders (107 orphaned from P10b's runs, 2 paused from manual checks) | Leave them | P10c | answered (P10c): option b, delete the 107 orphaned folders |
| Q-52 | A refused connect gives the new tokens back, which on Google and TikTok also ends the live account's grant | Give them back only when no live account holds that platform account | Review | answered (Review): option b, the default |
| Q-53 | Which review findings to fix | The 15 reported first | Review | answered (Review): option b, all 99, with these questions asked first |
| Q-54 | Where to remember that the negative-balance setting was turned on | A nullable timestamp column, re-attempted while empty | Review | answered (Review): the default |
| Q-55 | Should the original's complete name its upload (like Cancel's abort, Q-50)? | Yes | Review | answered (Review): the default |
| Q-56 | Hidden and direction characters in display names | Tidy them like titles (Q-43) | Review | answered (Review): the default |
| Q-57 | The payout line for a USD creator (P34) | "You'll get paid in US dollars (USD) to a US bank account." | Review | answered (Review): the default |
| Q-58 | `/api/stripe/onboarding` can be opened from another site or a sign-in link | Start a new setup only from inside ClipLease; reuse a re-read from the last 10 s | Review | answered (Review): the default |
| Q-59 | Better Auth's own /update-user lets a user set name and image | Close it | Review | answered (Review): the default |
| Q-60 | Poster objects that were PUT but never completed | Delete refused ones and sweep a video's strays older than 2 h 15 min | Review | answered (Review): the default |
| Q-61 | DataTable's stacked mode below lg | Leave it for P20, as planned | Review | answered (Review): the default |
| Q-62 | Opening the Source page of a post that is already licensable (the prompt's question 1) | The Source page shows "This post is already licensable." + "Open video" | P11 | answered (P11): the default |
| Q-63 | Where "‹ Back" goes on the Library File step | Back to the Library at every tier, no extra heading | P11 | answered (P11): option b, the default |
| Q-64 | Continue before "This file is the same video as the post" is ticked | Disabled, with "Tick the box to continue." | P11 | answered (P11): the default |
| Q-65 | New or proposed words ("Verifying…", "Post" / "Cover image", "Tick the box to continue.", "View on {Platform} (opens in a new tab)", "1 comment") | Use them as written | P11 | answered (P11): the default |
| Q-66 | On a computer, which side holds the upload part of the Library File step | Right, in one piece | P11 | answered (P11): the default |
| Q-67 | Back on the Source page after Reconnect | Only the connect error Banner on failure; nothing on success | P11 | answered (P11): the default |
| Q-68 | P11 runs 2–3× its 2-hour estimate | One step with a bigger budget | P11 | answered (P11): the default |
| Q-69 | A link verified on this video when a re-save or Check again hits a temporary platform error (the prompt's question 1) | Keep it verified; only the last-checked time moves | P11b | answered (P11b): the default |
| Q-70 | A link verified through an account that was disconnected, on a re-save | Keep it verified ("· no longer linked"); publishing asks for a reconnect (P14a) | P11b | answered (P11b): the default |
| Q-71 | Two Step 0 rg checks that only fail on code layout | Continue; show each passing with an equivalent search | P11b | answered (P11b): the default |
| Q-72 | P11b runs well past 2× its 105-minute estimate | One step with a bigger budget | P11b | answered (P11b): the default |
| Q-73 | Saving the Library source row's "Show buyers this link" Switch (the prompt's question 1) | An optional `sourceShowLink` on `saveVideoPostings` sets `show_link` on the source row only | P11c | answered (P11c): the default |
| Q-74 | Coming back to Where posted from Link / Reconnect {Platform} (the prompt's question 2) | Check that platform's `no_account` / `check_failed` links again once, each showing "Checking the link…"; `?error=` shows the connect error Banner | P11c | answered (P11c): the default |
| Q-75 | Same-video captions and the missing-tick error (the prompt's question 3) | "Post" for one, "{Platform} post" for several, "Cover image", cover first; "Confirm these posts show this same video" under the box (Continue stays enabled) | P11c | answered (P11c): the default |
| Q-76 | The article in "This is a {Platform} link. Move it there?" and the warning with several posts | "an" before Instagram and X; the warning names the post ("…but the {Platform} post is…") when several are verified (proposed) | P11c | answered (P11c): the default |
| Q-77 | Does replacing the original clear the same-video tick? | Yes: a finished Replace clears `same_video_confirmed_at` | P11c | answered (P11c): the default |
| Q-78 | Where the two cross-creator refusals show | Under the refused link (the errors carry its row index); nothing saved | P11c | answered (P11c): the default |
| Q-79 | "Add another link" on the Other card | A new name + link pair: each Other posting has its own name | P11c | answered (P11c): the default |
| Q-80 | Back and the heading on Where posted from tablet up | "‹ Back" → File at every tier, no visible heading | P11c | answered (P11c): the default |
| Q-81 | Deleting the File-step tick's files | Delete them, moving every still-valid test into the new step's tests | P11c | answered (P11c): the default |
| Q-82 | A time limit for a save's link checks (the review: 12 checks one by one under the step's 60 s action limit) | One 45 s budget for all of a save's checks (Check again its own); links not reached in time save as "We couldn't check this right now." with Check again, and everything else is saved | Review (P10–P11) | answered (Review): the default |
| Q-83 | Unticking a stored "These posts show this same video" | Takes the confirmation back: Continue clears it and asks "Confirm these posts show this same video" until it is ticked again | Review (P10–P11) | answered (Review): the default |
| Q-84 | A cooldown on checking the same link | A link checked in the last 30 s keeps its last result for Check again and Continue; Check again sooner shows "Checked a moment ago. Try again in a few seconds." (proposed) | Review (P10–P11) | answered (Review): the default |
| Q-85 | Telling two verified posts on one platform apart in the length warning | Name the account: "This file is 0:14 but the TikTok post on @maya.films is 0:38. Make sure it's the same video." (proposed) | Review (P10–P11) | answered (Review): the default |
| Q-86 | Where the "Show buyers this link" rule lives | The whole rule in the server's save (no database change); the browser posts the Switch only once turned; a choice follows the post, not the field | Review (P10–P11) | answered (Review): the default |
| Q-87 | Where the integration and e2e tests get their database (the Neon test branch over the network made `test:int` take 10.5 min) | A local Postgres 18 in Docker (Docker Desktop since Q-89; `bun run test:db`, `.env.test.local`); Neon keeps `dev` and stays the fallback | Test-speed review | answered (Tests): option b |
| Q-88 | What Step 0 re-runs of the previous prompt's checks | Typecheck, lint, token lint and unit always; integration and e2e only when the files differ from the last green `bun run check:full` (then the integration tests the changes reach and the prompt's e2e specs); every Step 4 still ends with the full suite | Test-speed review | answered (Tests): option b |
| Q-89 | Which Docker runs the test database once Docker Desktop is installed next to colima | Docker Desktop: colima stopped and left installed; `bun run test:db` opens Docker Desktop when Docker isn't up | Test-speed review | answered (Tests): option a |
| Q-90 | Stripe's page gives 12 digits for cards (9 for American Express) and 8 for non-card methods, not the plan's flat "8-digit limit" | Keep `MAX_TOTAL_CENTS` at 99_999_999 (CA$999,999.99), at or below every limit, and record Stripe's wording, URL and date | P12 | answered (P12): the default |
| Q-91 | Multiplier errors: the prompt's three messages or 04 §11.12's one | "Minimum is ×1.00." · "Maximum is ×10.00." · "Use steps of 0.05." | P12 | answered (P12): the default |
| Q-92 | Reset to defaults | Saves at once after a ConfirmSheet: "Reset prices to defaults?", "Your base price goes back to CA$150 and every option to its default, switched on. New requests only.", `destructive` "Reset prices" ("Resetting…"), "Keep my prices", then "Prices saved." | P12 | answered (P12): the default |
| Q-93 | Copy and accessible names the docs don't give | "Use whole dollars." (also an empty or unreadable base); "Keep at least one use." / "…term." / "…territory."; a switch named by its option, the multiplier "{option} multiplier" for screen readers, the preview's pickers labelled "Use" / "Term" / "Territory" | P12 | answered (P12): the default |
| Q-94 | Where "Set up payouts" on the Review comes back to | The Review itself (`returnTo`, checked with 07 D37's rules; Settings when refused), re-reading payouts on `?payouts=returned`, with `PayoutCurrencyFacts` under the Notice | P13 | answered (P13): the default |
| Q-95 | The Notice for each payouts status | "You can publish now. You'll need payouts set up to approve a request." then: Set up payouts · Finish setup · "Stripe is checking your details. You can approve requests as soon as they're done." + Check again · "Payouts unavailable. Contact {SUPPORT_EMAIL}." (no link) | P13 | answered (P13): the default |
| Q-96 | Changing Rights answers while a request waits | Locked too: "You can't change these answers while a request is waiting." | P13 | answered (P13): the default |
| Q-97 | The Yes / No controls | 04 §9.3 `OptionGroup` / `OptionTile`, built as shared components | P13 | answered (P13): the default |
| Q-98 | Copy the docs don't give | Blocker rows "Attach the original file", "Answer the rights questions", "Turn on at least one use, term and territory", "Fix the link"; "That link is taken."; the slug trimmed and lowercased, then "Use lowercase letters, numbers and hyphens." / "Use 60 characters or fewer."; "Ready to publish"; "Answer all four to continue."; "Not posted anywhere yet"; the cover row → `#cover-image` | P13 | answered (P13): the default |
| Q-99 | What Rights shows when the creator comes back | The two questions prefilled from saved answers; both boxes unticked on every visit | P13 | answered (P13): the default |
| Q-100 | The P10b placeholders | Delete `StepPlaceholder` and its test; keep `VideoPlaceholder` (P14a's) in its own file | P13 | answered (P13): the default |
| Q-105 | The license 404's "See @{handle}'s videos" (a not-found file gets no params) | A client part reads the handle with `useParams()`; the link shows for any handle-shaped param | P15 | answered (P15): the default |
| Q-106 | Which countries make up North America (UN M49 adds Bermuda, Greenland, Saint Pierre and Miquelon) | M49 exactly | P15 | answered (P15): b, US and Canada only; the three in no region; Taiwan in Asia-Pacific; Antarctica not offered |
| Q-107 | How country names are written | Plain everyday names ("United States", "South Korea", "Taiwan", "Türkiye") | P15 | answered (P15): the default |
| Q-108 | Cleaning up the names buyers type | Tidied like titles (`tidyText`) | P15 | answered (P15): the default |
| Q-109 | The details form's error words | "Enter who the license is for." · "Enter your name." · "Enter an email address like name@example.com." · "Use 120 / 200 characters or fewer." · "Agree to the license and Terms to continue." · "Choose a country." / "Choose a region." | P15 | answered (P15): the default |
| Q-110 | A loading skeleton turns the license page's 404s into 200s | No `loading.tsx` on the route | P15 | answered (P15): the default |
| Q-111 | Screen-reader names of the posting links | "View post on {Platform} (opens in a new tab)" · "View on YouTube (opens in a new tab)" · "{hostname} (opens in a new tab)" | P15 | answered (P15): the default |
| Q-112 | Removed posts and hidden links in the buyer's list | Two flags on the buyer DTO (`removed`, `hasLink`) | P15 | answered (P15): the default |
| Q-113 | Focus and the territory select | Moves into the select only on a tap or click | P15 | answered (P15): the default |
| Q-114 | The region select's words | "Region" / "Choose a region" | P15 | answered (P15): the default |
| Q-115 | The summary's territory before a pick, and names that need "the" | "in one country"; "in the United States" in sentences, bare in lists | P15 | answered (P15): the default |
| Q-116 | "View license page ↗" on the video page | Add it now | P15 | answered (P15): the default |
| Q-117 | The multi-platform buyer test | Extend `where-posted.spec.ts` now | P15 | answered (P15): the default |
| Q-118 | How the dev fake checkout rebuilds the buyer's link (Stripe keeps the return URLs; the fake can't) | Decrypt the stored copy in one guarded dev-only helper (an exception to 07 D14) | P16a | answered (P16a): the default |
| Q-119 | What the fake reports for a checkout that hasn't been paid | "Hold in place" (`requires_capture`, now, now + 7 d); P16b accepts a return only once the session is complete | P16a | answered (P16a): the default |
| Q-120 | A resubmit after editing the names (same hidden submission id) | Also compare the names and the intended use; any change → "already sent" | P16a | answered (P16a): the default |
| Q-121 | The `/r` tab title | One per state; a dead link reads "ClipLease" | P16a | answered (P16a): the default |
| Q-122 | The video lock and availability check (07 D110) before their tables exist | Build without them; P19f adds them; P16b re-checks the video is published | P16a | answered (P16a): the default |
| Q-123 | A PaymentIntent already `succeeded` while the request is still `checkout_pending` | Change nothing; audit `license_request.ignored_event` with `piStatus: "succeeded"`; P18 and P25 build the real branch | P16b | answered (P16b): the default |
| Q-124 | The 05 §8 email copy marked proposed (button labels, the buyer footer, the test-mode line) | As written | P17 | answered (P17): the default |
| Q-125 | The creator email's footer (none in the docs) | "You got this email because you have a creator account on ClipLease. Questions? Reply to this email." | P17 | answered (P17): the default |
| Q-126 | Page copy marked proposed: /r's "Scope" and "Total", "Open request", the request page's heading; the request page's tab title and the SegmentedControl's name | As written; "Inbox" for both | P17 | answered (P17): the default |
| Q-127 | History with nothing decided | "No decided requests yet." with no action | P17 | answered (P17): the default |
| Q-128 | The request page's money facts on a decided request | Payment and Answer by only while waiting; You get while waiting or approved; a decided request shows its pill and its 04 §11.5 line | P17 | answered (P17): the default |
| Q-129 | P16b's `WaitingBody` (and its test), unused since `RequestStatusView` | Delete them | P17 | answered (P17): the default |
| Q-130 | Should /r and the Inbox keep refreshing every 30 s while the tab is hidden (01 J7.17)? | Pause while hidden; refresh on return | Review batch 2 | answered (Review batch 2): pause while hidden |
| Q-131 | Email retry spacing (audit A9) now, or with P26 (D34 and P26's planned test expect an immediate retry)? | Defer to P26 | Review batch 2 | answered (Review batch 2): defer to P26 |
| Q-132 | Which small dependency and config changes (audit C6)? | Zod 4.6.6, tsconfig ES2022 / allowJs off, the `email:dev` script | Review batch 3 | answered (Review batch 3): all three |
| Q-133 | Replace the in-browser cn compiler with prebuilt tables (audit B3c)? | Yes, with a drift test | Review batch 3 | answered (Review batch 3): yes |
| Q-134 | The social_post.fetched_at index (audit B6): now or with P27? | P27 | Review batch 3 | answered (Review batch 3): P27 |
| Q-135 | Slim PROGRESS.md (audit D5)? | Archive the finished logs and the Decisions table | Review batch 3 | answered (Review batch 3): archive both |
| Q-139 | Copy for `original_missing` (Approve when the video's original isn't ready) | "The original file for this video is missing, so this request can't be approved yet. Questions? {SUPPORT_EMAIL}" | P18 | answered (P18): the default |
| Q-140 | Approve tapped after the deadline: 01's "This request expired. The buyer wasn't charged." at once, or 07 D25's rule (no "wasn't charged" before the hold is released)? | Follow 07 D25: "This request expired." under the countdown until the expiry is stored | P18 | answered (P18): the default |
| Q-141 | /r's Get file and license button now (404 until P20) or with P20? | With P20 | P18 | answered (P18): the default |
| Q-142 | A waiting request past its deadline whose expiry isn't stored yet: what do the Inbox row, the request page and /r show? | The neutral «Expired» pill, judged on the database's clock: no Approve, no Decline, no "You get", no payouts Notice and no sentence until the expiry is stored; lazy expiry runs in after(), and /r awaits its own request's expiry | P19 | answered (P19): the default |
| Q-143 | A Decline that finds the request expired: what does the creator see? | The «Expired» pill and "This request expired. The buyer wasn't charged."; Approve keeps D160's pill-only rule when it loses a race | P19 | answered (P19): the default |
| Q-144 | P19 runs past 2× its 120-min estimate: split it, or one step with a bigger budget? | One step, bigger budget | P19 | answered (P19): the default |

## Prompt map

`docs/07-decisions.md` §3.2 numbers its prompts differently from this kit (P00–P21 plus H1–H10). Use this table to translate
any "Pxx" or "Hx" you meet in docs 01–07. The kit's `prompts/` files are the build order (`prompts/INDEX.md`).

| 07 §3.2 | This kit |
|---|---|
| P00 Scaffold + compat smoke | P00 (scaffold, pins, smoke) + P01 (tokens, `app-name.ts`, `env.ts`) |
| P01 Database | P03 |
| P02 Auth | P04 |
| P03 Shell + primitives | P02 |
| P04 Onboarding + creator page | P05 (also the 18+ checkbox, fake payouts, the payments registry, the CAD fact line, time zone); P05b (teens and guardians) is Later |
| P05 Social core | P06 (OAuth plumbing, mock) + P08 (Connections) |
| P06 Sync + Library | P07 (sync engine) + P09 (Library) |
| P07 Pricing | P12 |
| P08 Make licensable I | P10a + P10b + P10c (storage, multipart and resumable uploads, plain upload) + P11 (Source page, source posting, File step) |
| P09 Make licensable II | P11b + P11c (postings, Where posted) + P13 (Rights, Review) + P14a + P14b (publish, share, video page) |
| P10 License page + checkout | P15 (license page) + P16a (server-priced request, fake checkout) |
| P11 State machine + authorization | P16b (authorization) + P17 (status, inbox, emails) |
| P12 Approve, decline, expire | P18 + P19 + P19b (creator transfer) + P19c (approval window, auto-approve) + P19d (per-video price, music re-enable) |
| P13 Delivery + verify | P20 |
| P14 Admin | P21 + P21b (revoke with refund) |
| P15 E2E (Gate A) | P22 |
| (none: added 2026-10-16, 07 §9.5) exclusive licenses | P19e + P19f + P19g |
| (none: added 2026-10-16) buyer sign-in and My licenses | P20b |
| (none: added 2026-10-16) exclusive renewals on the fake driver (M6b, Gate R) | P22b + P22c + P22d + P22e + P22f + P22g + P22h |
| (none: added 2026-10-16) Stripe saved card, off-session renewals, recovery and 3-D Secure | P25c + P25d |
| P16 Stripe spike / P17 Stripe driver | P24 + P25 (Gate B) + P25b (refunds, reversals) |
| P18 R2 driver | P23 |
| P19 YouTube / P20 Instagram / P21 TikTok | P27 (Gate C) / P28 + P28b (view counts) / P29 |
| Resend (OQ-20) | P26 |
| H10 deploy (preview part) | P30 |
| H1 + H2 (throttles) · H2 (CSP, WAF, `/verify` limit) + H7 (key rotation, redirect re-validation) · H9 · H4 · H5 · H6 | P31a · P31b · P32 · P33a · P33b · P33c (hardening, optional) |
| `[H3]` except `original_pending_key`, and the `[H8]` extras auto-approve, approval window, per-video base price, music re-enable (D80–D82, D91) | CORE now: P10a + P10b + P10c, P19c, P19d (07 §7.4) |
| `original_pending_key`, the rest of H8 and H7, H10 go-live | not scheduled (Later; P33c asks the owner which to plan next) |
| (none: added 2026-10-16) USD with a second Stripe platform account | P34 (Later, optional, the last prompt; 07 D105) |
| (none) teen creators with a guardian | P05b (Later, not scheduled; 07 D93) |
| (none: added 2026-10-18, 07 §11) responsive tiers: Tablet and XL for everything P00–P04 built | P04b (after P04, before P05; 07 D157) |

The mapping is approximate. Each kit prompt's own text decides its scope.
