# P22 — The 5-minute demo end to end (Gate A): audit and plan

Status: **built (2026-11-27); Gate A pending the owner (§6).** Prompt: `mvp-plan/prompts/P22-demo-e2e-gate-a.md`.
Audit: three read-only auditors (e2e infrastructure; the demo's expected strings against the code; the plan docs and the decision log).

## 1. Step 0 (done)

- `bun run check:step0 tests/e2e/admin.spec.ts`: typecheck, lint (960 files), unit 5278 green; the code is the last green
  `check:full`'s (P21b after its simplify pass: integration 1240, e2e 342 passed incl. every responsive spec on four projects), so
  integration and e2e weren't rerun. P21/P21b files, functions and actions present; no "doesn't refund the buyer"; fixtures and
  `scripts/dev-expire-request.ts` present.
- Not run: the `.env.test` greps (the owner's rule: never read `.env*`). Proven instead: the config's DB guard refuses unless
  `APP_ENV=test`; `/dev/fake-checkout` renders and the mock connect links work in every e2e run; `ADMIN_EMAILS` is pinned by
  `src/server/env.test.ts`; sign-in codes land in `.data/emails` (console email).
- "Seeded without `--demo`" no longer applies: every e2e run empties the public tables and migrates (`tests/helpers/test-run-lock.ts`),
  and admins get their role on first sign-in (07 D88).

## 2. Corrections to the prompt (the spec follows the app and the owner's earlier answers)

| Prompt says | The app / decision log says | Plan |
|---|---|---|
| Step 0 runs separate commands and three `test:e2e` | AGENTS §2, Q-88: one `check:step0` | done that way |
| Cron JSON `{ expired, reconciled, emailsSent }` | five keys (+ `moneyMovements`, `autoApprovals`), PROGRESS P19b note | `toMatchObject`, never `toEqual` |
| Postgres 17 fallback | Postgres 18 (Neon 18.6; local Docker `postgres:18` for tests) | 18 |
| Q3 "must survive repeated runs" | each run empties the DB | setup creates `maya.films` (07 D20/D54 need that exact handle) |
| Q4 open | P10b's runs: chromium captures a frame; WebKit takes "Choose an image" with `poster.jpg`; both read 0:14 | settled: "720 × 1280" asserted on chromium only |
| `run.ts` `uniqueEmail(role)` / `uniqueHandle(prefix)` = `<prefix>.<runId><p>` | `uniqueEmail(testInfo)` / `uniqueHandle(testInfo)` exist (6 specs) with 8 random hex per call (a flake fix) | extend them with an optional role / prefix, keep the randomness, add letter `s` for setup |
| "P21's sign-in helper" | P04's `signInWithEmail`, `readSignInCode` | reuse |
| Source page "From Demo · @demo.creator · posted 1 Oct 2026 · Verified" | the Source page drops "· Verified" (05 over 01); the File step has it | assert each where it renders |
| Locked row as one string | three parts: title, Verified pill, "· From your Library" | assert the parts |
| `/@handle` "Maya R. · @{handle}" | h1 name + separate `@handle` | assert both |
| "Link copied" after "Copy link" | the publish view's button is "Copy" → "Copied"; "Link copied" is the live region | assert those |
| History "Paid out" for CA$1,575.00 | "Paid out" (the price is on the row); the transfer runs after the response | reload until "Paid out", one `creator_transfer` checked in the test DB |
| Sticky bar as one line, summary "Paid social ads · 1 year · Worldwide" | `[data-price-lines]` + `[data-price-total]`; heading "License summary · …" | contains-match each |
| "Synced just now" | "Synced just now · 24 videos" (or "1 min ago" on a slow run) | the existing `connections.ts` matcher |
| Admin Requests row `declined` / `expired` | status pills "Declined" / "Expired"; reason `creator`; `pi_fake_<id>` printed | `adminRequestStatus` labels; row found by `pi_fake_<id>`, read straight after the action (newest 50) |
| Step 28 page "isn't available" | the message with HTTP 404 | expect that 404 in the console-error collector |
| Step 29 revoke "takes back" | "…cancels the … payout" until the transfer succeeded | wait for "Transfer … sent" before Revoke |
| Manual SQL after step 29 | Q-188 / Q-196 (no psql on dev; Step 0 dev lines are tests) | assert with `storedMovement()` in the spec |
| J5.9 manual "Choose the same file to continue." offline | Q-46 a: same tab "Upload paused at {n}%. Check your connection."; "Choose the same file…" only after a reload | owner step worded per Q-46 |
| Commit `P22: …` at wrap-up | the owner's rule: commit only on "commit and push" | wait |
| `bunx playwright show-report` | no html reporter configured | add `['html', { open: 'never' }]` |

## 3. Decisions taken (judgment, stated)

- **Admin storageState:** the admin context is made explicitly (`browser.newContext({ storageState: admin.json })`), never a file-level
  `test.use`, because `browser.newContext()` and `request` inherit it, which would sign in A.1's creator, the visitors and every buyer.
  A.2's arrange-and-act chain stays one test (splitting it needs serial mode, and with `retries: 0` one failure skips the rest).
  P04's OTP checks (land on `/admin`, the shell, `expectRefreshWhenDue` last) become one stateless test: the only OTP admin sign-in per
  project. Events and actor assertions use the setup admin (the first `ADMIN_EMAILS` address) on both projects.
- **Decline and expiry:** creator storageState in an explicit context; buyers in fresh 390 × 844 contexts. Never open the Inbox with
  the shared setup creator (its lazy sweep would expire the expiry request): approve and decline on `/dashboard/requests/<id>`. Tiles
  by project: decline nth(1) / nth(2), expiry nth(3) / nth(4) (chromium / webkit); those posts are 22–61 s, so no "no warning" check.
- **Server log:** a small launcher `scripts/e2e-server.mjs` (build, then start on 3100, output teed to `.data/e2e-server.log`,
  truncated at start), which keeps the exit codes and the console's stderr that a shell `| tee` would lose.
- **Config:** `setup` (serial, writes `run.txt` once) and `safety` teardown projects; every project `dependencies: ['setup']`;
  `retries: 0` explicit; `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`; the merged env copied into `process.env`
  (never logged); `tests/e2e/.auth/` git-ignored before the first `check:full` (the fingerprint counts untracked files).
- **Safety:** `leaks.ts` (`watchBodies`, `findLeaks` returning `{ url, pattern }` only); S5 on creator and buyer bodies, S7 on buyer
  bodies; `safety.teardown.ts` scans the server log, line numbers only.
- **No new product features or copy.** If a spec exposes an app bug: the smallest fix at its cause, named in PROGRESS.md; money,
  tokens or the state machine → stop and ask.

## 4. Build plan

1. Config, `run.ts` (extending the existing helpers), `.gitignore`, the launcher, the html reporter.
2. `auth.setup.ts` (run id; the admin; the setup creator with Demo and fake payouts; `maya.films`), `safety.teardown.ts`.
3. Helpers: `publishFromLibrary` (from `publishDemoVideo`'s body; `goto` the tile's href, never a tap right after load),
   `declineRequest` on the request page, `leaks.ts`. Reuse `buyLicense`, `publish`, `licenseVideo`, the step helpers.
4. `demo.spec.ts`: one test, `test.step` titles "NN · Jx …" per 01 §7 (steps 1–23, 28–29), the three contexts, the money-display
   check on every page, S5/S7.
5. `decline.spec.ts`, `expiry.spec.ts` (dev clock via `execFileSync` with `NODE_ENV: "test"`, 401 then 200, the admin row before any
   buyer or creator page, then `/r`).
6. `admin.spec.ts` to the admin storageState as above; the comments in admin.spec and sign-in.spec updated.
7. Three full runs in a row (`for i in 1 2 3; do bun run test:e2e || break; done`), flakes fixed at their cause (no sleeps, no
   retries, no skips beyond the existing project guards), each run's counts and duration recorded; then `check:full`.
8. Gate A with the owner (Task 8), per the answers below.

Risks: the admin Requests tab's newest-50 window under a full parallel run; the global cron sweep expiring another spec's forced
request; WebKit "Load failed" under load (pricing.spec, PROGRESS); setup adds a serial phase (~20–40 s) and tracing adds time to
every run, `check:step0` included (dependency projects always run).

## 5. Owner answers (2026-11-27)

- **Q-212 (1 a):** the owner runs all of Task 8 once the three runs are green, and signs off in chat.
- **Q-213 (2 a):** a new Neon branch `gate-a` from an empty parent (not schema-only); the owner creates it and edits `.env.local`.
- **Q-214:** sign-up's "Set up payouts" keeps returning to Settings; the demo spec and the timed run tap Library in the menu next
  (outside S10's count). Departs from 01 §7 step 6b by the owner's choice.

Built after "implement" (Q-215 adds the demo video).

## 6. Gate A: the owner's steps (Task 8, with Q-213, Q-214 and Q-46)

Do these only after the three full runs are green, and not while any e2e run is going (they share `.next` and `.data/emails`).

1. **Database (Q-213).** In Neon, create a branch `gate-a` from an empty parent (not "schema only"). Point `.env.local` at it
   (`DATABASE_URL`, the pooled one, and `DATABASE_URL_UNPOOLED`, the direct one), keeping `APP_ENV=development` and the mock, fake, local and console drivers. Never paste
   the address in chat.
2. **Build and start.** `bun run db:migrate && bun run db:seed` (no `--demo`), then `bun run build && bun run start`.
3. **Windows.** Creator: a normal desktop window at about 1280 px. Buyer: a private window at 375 × 812 (DevTools device toolbar).
   Sign-in codes appear in the server's console.
4. **Timed demo.** Start a timer at step 1 of 01 §7 (open the app, Sign in) and stop it at step 23 (`/verify/CL-…` reads Valid
   license). Target ≤ 5:00. After "Set up payouts" (step 6b) you land on Settings ("Payouts on"): tap **Library** in the menu (Q-214).
5. **S10.** Count screens and taps from tapping the Library tile (step 8) to "Link copied" (step 15). Taps include the same-video
   tick and the four rights answers; they exclude the OS file picker and the upload time. Pass: ≤ 5 screens and ≤ 13 taps.
6. **Decline and admin.** Do steps 25–27 (a second buyer request, Decline). Then in a third window sign in as the first
   `ADMIN_EMAILS` address and do steps 28–29 (Disable the video; Revoke the license with Issued in error).
7. **The look (G.6, S13).** The license page, `/r`, `/l`, `/verify`, the Inbox, the Library and the Make-licensable steps at 375,
   768, 1024, 1280 and 1920 px plus a 2560 spot check, light and dark, with no sideways scroll; a landscape phone at 844 × 390 and a
   half-screen window at 960 px. Tablet: an iPad in Safari, portrait and landscape, through the LAN address `bun run start` prints
   (if sign-in refuses that address, check the signed-out pages on the iPad and the signed-in ones in DevTools at 768 × 1024 and
   1024 × 768). XL at 1920 and 2560: the Library, the Inbox and the Make-licensable steps in the 1440 container, the license page in
   1056, the reading pages in 640, each centred.
8. **Manual checks.** G.10 (no jargon in the copy); J5.11 (the poster was captured); J5.16 (a second creator who skipped payouts
   publishes and sees "You can publish now. You'll need payouts set up to approve a request."); J5.9 (on a spare tile, DevTools
   Offline during the upload shows "Upload paused at {n}%. Check your connection." and it continues by itself back online, Q-46;
   "Choose the same file to continue." appears only after a reload); J5.22–J5.28 (a plain upload with a pasted Instagram link shows
   "Not verified", and the license page lists "Instagram · Not verified" with no handle); J7.20 (the buyer's license page loads no
   third-party requests and sets no cookies before checkout).
9. **Afterwards.** Point `.env.local` back at `dev`. Tell me in chat: the time (m:ss), the S10 screens and taps, what you looked at
   and anything that looked wrong, and "Gate A signed off" if it passed.

Not for you: J6.2 (Web Share on a real phone) waits for the HTTPS tunnel (P28); J2.2/J2.4 on real platforms and the Stripe-dashboard
checks J7.12, J8.5, J11.2, J11.4 are Gates B and C.
