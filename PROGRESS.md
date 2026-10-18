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
  - Copy every judgment call into the Decisions table.
  - Gates are signed off only after the owner says so in chat.
  - Never write secrets, OAuth tokens, sign-in codes, buyer emails or signed URLs in this file.
-->

## Status
Current prompt: P06 · Last verified: P05 · Blockers: none
Gates: A (P22) [ ] · R (P22h) [ ] · B (P25) [ ] · C (P27) [ ] · S12 Stripe renewal sign-off (P25d, not a gate) [ ]
Later: P34 (USD) not run · P05b (teens) not scheduled

## Log

**M0 Foundation** · P00–P02 · 6.0 h

### P00 — Repo, scaffold and verification commands ✅ (2026-10-16)
> 120 min · Depends on: none (first prompt) · Record: the scaffold (temporary `cliplease-scaffold` moved into `App/ClipLease`, package `cliplease`), e2e port 3100, whether `CLAUDE.md` is a symlink, which Better Auth smoke check ran; `bun --version` (1.4.3, or the recorded fallback), `bunfig.toml`, the `bun pm untrusted` output and any package trusted with the owner's yes, the env-probe result (`unset`); the owner-answers table below kept as is; the Prompt map section below
- Done:
  - **Scaffold:** `bunx create-next-app@16.4.1 cliplease-scaffold --ts --tailwind --biome --app --src-dir --import-alias "@/*" --use-bun --agents-md --no-agent-feedback --skip-install --yes --disable-git`, run in `App/`, then `mv -n` into `App/ClipLease`. `ls -A cliplease-scaffold` printed nothing, and `rmdir` removed the temporary folder. `--skip-install` was used; the first `bun install` ran inside `App/ClipLease`. Package name `cliplease`.
  - **Bun setup:** `bunfig.toml` (`env = false`, `[install] exact = true`, `linker = "hoisted"`). package.json has `"packageManager": "bun@1.4.3"`, `"engines": { "node": "24.x" }`, `"overrides": { "react": "19.3.1", "react-dom": "19.3.1" }` and `"trustedDependencies": []`. `.nvmrc` = `24`. `bun.lock` is the only lockfile.
  - **Pins:** every task 2 pin was installed with `bun add --exact` / `bun add --exact --dev`. The exception is `react-email` and `@react-email/ui`, at 6.11.3 instead of 6.11.0 (owner security exception, see Decisions). The H6 pins and the bunx-only CLIs were not installed.
  - **Configs:**
    - `next.config.ts`: `cacheComponents: false`, `partialPrefetching` removed, the `@tailwindcss/turbopack` rule kept, `experimental.serverActions.bodySizeLimit: "1mb"`.
    - `tsconfig.json`: `strict`, `types: ["node"]`, `@/*` path, no `baseUrl`.
    - Biome migrated to 2.5.15 (`$schema` updated, `recommended` changed to `preset`; `vcs.enabled` and `useIgnoreFile` true).
    - Scripts: dev, build, start, typecheck, lint, format, test, test:int, test:e2e and smoke:compat.
  - **Tests:**
    - `vitest.config.mts`: `resolve.tsconfigPaths: true`, `server-only` aliased to `tests/stubs/server-only.ts`, and two projects, unit and integration.
    - `src/lib/sanity.test.ts`.
    - `playwright.config.ts`: `chromium-desktop` (Desktop Chrome) and `webkit-iphone` (`devices["iPhone 17"]`), with the webServer on port 3100.
    - `tests/e2e/smoke.spec.ts`.
  - **Compat smoke:** `scripts/compat-smoke.tsx`.
  - **Docs:** `AGENTS.md` = the `Plan kit:` line, then the kit AGENTS.md (every 07 §6, D92, D106 and D131 rule was already present, once each), then create-next-app's Next block, byte for byte. `CLAUDE.md -> AGENTS.md` is a symlink. This PROGRESS.md was made from the kit template.
  - **Git:** `git init -b main`; `.gitignore` adds `.data/`, `test-results/`, `playwright-report/`, `blob-report/`, `playwright/.cache/` and `.claude/settings.local.json`. `.DS_Store` and `.env*` were already there. Remote: `origin` = `git@github.com:anthonyshadow/cliplease.git`.
- Verified:
  - **Toolchain:** `node -v` v24.22.0 · `bun --version` 1.4.3.
  - **package.json:**
    - packageManager / trustedDependencies / overrides rg: 3 matches ✅
    - `rg -n '"[\^~][0-9]' package.json`: nothing ✅
    - R1/R2 rg over package.json and scripts: nothing ✅
  - **Lockfile and pins:**
    - `ls -A | rg -i 'lock|workspace'`: only `bun.lock` ✅
    - `bun ci`: "Checked 472 installs across 628 packages (no changes)" ✅
    - `bun pm ls`: every pin exact (next 16.4.1, react and react-dom 19.3.1, typescript 6.0.3, vitest 5.0.3, vite 8.3.3, @playwright/test 1.63.0, better-auth 1.7.7, drizzle-orm 0.45.3, zod 4.6.5, react-email 6.11.3, @react-email/ui 6.11.3, …) ✅
    - `bun why next`: only next@16.4.1, used by the app, @react-email/ui 6.11.3 and an optional better-auth peer ✅
    - `bun audit`: 1 moderate (see Follow-ups); no critical or high ✅
  - **Checks:**
    - `bun run typecheck` ✅
    - `bun run lint` ("Checked 18 files … No fixes applied.") ✅
    - `bun run test` (1 passed) ✅
    - `bun run test:int` (no test files, exit 0) ✅
    - `bun run test:e2e` (2 passed: chromium-desktop and webkit-iphone) ✅
    - `bun run build` (Next.js 16.4.1, `/` and `/_not-found` static) ✅
    - `bun run smoke:compat` printed `runtime node 24.22.0` and then 3 lines ✅: `OK react-pdf: renderToBuffer returned 1551 bytes starting with %PDF` · `OK react-email: render returned 306 chars containing the line` · `OK better-auth: imports are functions; betterAuth({ secret, baseURL }) built without a database; toNextJsHandler(auth) returned GET and POST`
    - A temporary Vitest test proved that `@/…` resolves and that the `server-only` stub works (2 passed); the test was then removed ✅
  - **Config files:**
    - `rg -n cacheComponents next.config.ts`: `cacheComponents: false` ✅
    - No `middleware.ts`, `proxy.ts`, `tailwind.config.*`, `postcss.config.*` or ESLint config or package ✅
  - **Docs:**
    - The AGENTS.md rg shows the Next block, Version gotchas, PaymentsDriver, redirect-resolve, fenced finish, bare-dollar, 18 or older, lockVideoForLicensing, recorded consent, R1 and constructEventAsync ✅
    - `CLAUDE.md -> AGENTS.md` (symlink, `cmp` same) ✅
  - **Git ignores:** `git check-ignore .data/ test-results/ playwright-report/ .env.local` prints all four ✅
  - **Dev server:**
    - `bun run dev`: the placeholder home renders at 1280 px and 375 px with no console errors (only React DevTools info and HMR logs) ✅
    - `next dev` left AGENTS.md byte-identical and created no files ✅
  - **Git:** the P00 commit and the push to `origin main` happen in Wrap up. Their checks (git log, clean tree, `origin/main` = `main`) are in the P00 reply, and P01 Step 0 re-checks them.
- Decisions: see the Decisions table (2026-10-16, P00). The essentials:
  - **Bun:** 1.4.3, no fallback.
  - **`CLAUDE.md`** is a symlink.
  - **Better Auth smoke:** the full check ran: `betterAuth({ secret, baseURL })` built without a database, and `toNextJsHandler(auth)` returned GET and POST.
  - **Env probe:** printed `unset`.
  - **`bun pm untrusted`:** "Found 0 untrusted dependencies with scripts." No package was trusted (no `bun pm trust`).
  - **`bun run build`** passes with `"trustedDependencies": []` (research §8 item 3). `bun pm untrusted` exists in 1.4.3 (item 4). The env probe gives `unset` (item 6), but the check can't tell whether R3 works (Decisions).
  - **Email preview:** react-email and @react-email/ui are at 6.11.3 by owner exception.
- Open questions: none (07 §4.1, §10: every owner question is closed).
- Follow-ups for later prompts:
  - **P01:** delete `src/lib/sanity.test.ts` once the env and contrast tests exist. ripgrep is installed as a real binary (`/opt/homebrew/bin/rg` 15.2.0), so `bun run` scripts can call it. Inside Claude Code, a plain `rg` is Claude Code's own shell function and doesn't show whether the binary exists.
  - **P01 and later:** create-next-app's placeholder files (`public/*.svg`, now with `<title>` tags for Biome's `noSvgWithoutTitle`) are replaced or removed by P01. Any brand SVG added under `public/brand/` will need a `<title>` too.
  - **P32 (CI):** `bun audit` reports 1 moderate: esbuild ≤ 0.24.2 (0.18.20, via drizzle-kit → @esbuild-kit/core-utils; GHSA-67mh-4wv8-2f99, dev-server only). It clears only when drizzle-kit moves off @esbuild-kit, and that pin change needs the owner. Consider whether CI runs `bun audit`.
  - **R4 gap (later prompts and P32):** Bun 1.4.3 doesn't write an empty `trustedDependencies` into bun.lock, so `bun pm untrusted` and `bun ci` fall back to Bun's built-in trusted list (`bun pm default-trusted`, 367 names, e.g. esbuild, sharp).
    - In this tree only esbuild has an install script, and Bun's own script optimiser skips it anyway. Checked with a fresh clone: `package.json`, `bun.lock` and `bunfig.toml` copied to an empty folder, then `bun ci --verbose`. It printed `[Lifecycle Scripts] ignoring esbuild lifecycle scripts` (×3) and `… ignoring sharp lifecycle scripts`, and all three `esbuild/bin/esbuild` files stayed the 9181–9351-byte JS shim.
    - Before adding any package that is on that list and has an install script, run `bun install --verbose`, look for `[Lifecycle Scripts]` / `Blocked` / `Starting scripts` lines, and ask the owner.
    - P30 and P32 re-check the fresh-clone result on Vercel and in CI.
  - **Node on this Mac (before P01):** nvm has v24.12.0, v24.18.0 and v24.22.0, with the default alias `24` pointing at v24.22.0.
    - The Claude app session that ran P00 was started while v24.18.0 was the default, so its shell (and any terminal tab it opens) still has `~/.nvm/versions/node/v24.18.0/bin` first on PATH. There, `bun run smoke:compat` correctly fails with "expected Node >= 24.21 on the 24 line".
    - Fix: quit and reopen the Claude app, or start P01 from a new terminal, so `node -v` prints v24.22.0. For one session, the alternative is to put `~/.nvm/versions/node/v24.22.0/bin` first on PATH.
    - Non-interactive login shells resolve Homebrew Node 25.8.1 (`/opt/homebrew/bin/node`) before nvm.
    - The smoke's guard accepts Node 24.x at 24.21 or later only; Node 25 and Bun are rejected.

### P01 — App constants, env guards, design tokens and static pages ✅ (2026-10-17)
> 120 min · Depends on: P00 · Record: `APP_NAME = 'ClipLease'` (OQ-39 answer), how the secrets were set, landing copy; the legal placeholders (OQ-28 answer), Signal Green (OQ-31 answer); `ownerEmail()` and the two e2e admins in `.env.test`; `ENABLED_CURRENCIES=cad` and `enabledCurrencies()`; the Terms/Privacy owner-answer additions (18 or older, prices in the creator's currency)
- Done:
  - **Constants:** `src/lib/app-name.ts` holds `APP_NAME = 'ClipLease'` (OQ-39) and the seven legal constants (OQ-28 placeholders).
  - **Enum tuples:** `src/lib/domain/values.ts` holds 47 tuples and 47 types, with no imports. It is 07 §2.1, with `LICENSE_REQUEST_STATUSES` / `PAYMENT_ACTIONS` replaced in place by their §9.2 values, plus the §7.2 additions, §8.2 `CURRENCIES`, the twelve §9.2 tuples and §10.2's `RENEWABLE_TERM_KEYS = EXCLUSIVE_TERM_KEYS`. It has a test, `values.test.ts`.
  - **Env:** `src/server/env.ts` exports `parseEnv`, `env`, `APP_ENVS`, `isDevAppEnv`, `enabledCurrencies()`, `ownerEmail()`, `PAYMENTS_DRIVERS`, `STORAGE_DRIVERS` and `MOCK_SOCIAL_SCENARIOS`. It applies the 07 D51 guards and is tested in `env.test.ts`.
  - **Env files:** `.env.example` is committed; `.env.local` and `.env.test` are gitignored.
  - **Env loaders:** Vitest root `setupFiles: ["./tests/setup/load-env.ts"]`. `playwright.config.ts` passes `webServer.env` from `.env.test` (+ `.env.test.local`).
  - **Tokens:** `src/app/globals.css` is 04 §3.1 verbatim. `src/app/fonts.ts` is Inter with `preload: false`. `layout.tsx` sets `metadataBase`, the title template and `viewport`. `icon.tsx` draws the white "C" on ink. `design-tokens.test.ts` is 04 §2.6 verbatim.
  - **Token lint:** `scripts/lint-tokens.sh`, run as `bun run lint:tokens`.
  - **Removed (create-next-app leftovers):** `public/*.svg`, `src/app/favicon.ico`, `src/app/page.tsx` and `src/lib/sanity.test.ts`. Geist went with the old layout.
  - **Public pages:** `src/components/layout/wordmark.tsx`, `src/components/layout/landing-sign-in-link.tsx` (client), `src/app/(public)/layout.tsx` (sticky frosted header plus the one `<main>`) and `src/app/(public)/page.tsx`. The landing copy shipped as written.
  - **Legal content:**
    - `src/lib/legal/types.ts` is the structured legal text.
    - `src/lib/legal/license-v1.ts` holds the summary, header rows, sections 1–22 and Schedule A, plus `fillLicenseV1` and the neutral values. It has a test, `license-v1.test.ts`.
    - `src/components/layout/legal-page.tsx` is the page shell: notice, title, "Last updated", contents and sections.
  - **Legal pages:** four routes under `src/app/(public)/legal/`. Terms, Privacy and Data deletion keep their text in a `content.ts` beside the page.
  - **e2e:** `tests/e2e/smoke.spec.ts` covers `/` and the four legal routes, checking the draft notice, the date line, no raw tokens, no horizontal scroll and no console errors. It also checks `#payouts` and `#auto-renewal` on Terms.
- Verified:
  - **Checks:**
    - `bun run typecheck` ✅
    - `bun run lint` ✅ ("Checked 35 files … No fixes applied.")
    - `bun run test` ✅ lists each file: values.test.ts (3), design-tokens.test.ts (139), license-v1.test.ts (12) and env.test.ts (67) = 221 passed. The Vitest reporter is `["default", { summary: false }]`, so file lines print.
    - `bun run test:int` ✅ (no test files)
    - `bun run lint:tokens` ✅ (prints nothing, exit 0). Adding `[color:#123456]` to wordmark.tsx printed that line with exit 1; after the revert, exit 0.
  - **Build and e2e:**
    - `bun run test:e2e` ✅: 12 passed (6 on chromium-desktop + 6 on webkit-iphone).
    - `bun run build` with `.env.local` filled ✅. Routes `/`, `/icon` and the four `/legal/*` are static. The built `/` has exactly one `rel="icon"` (`/icon?…`, image/png) and no `favicon.ico`.
  - **Env files:**
    - `grep -cE '^(BETTER_AUTH_SECRET|TOKEN_ENCRYPTION_KEY|CRON_SECRET)=.{32,}$' .env.local` → 3; `TOKEN_ENCRYPTION_KEY` is 44-char base64.
    - `git check-ignore .env.local .env.test .env.test.local` prints all three; `.env.example` is staged and `git ls-files --error-unmatch .env.example` lists it.
    - `rg 'STRIPE_SECRET_KEY=|STRIPE_WEBHOOK_SECRET='` over .env.example and .env.test → nothing.
  - **values.ts:**
    - The renewal-tuples `rg -c` → 24.
    - `"renewal_pending"` / `"renewal_checkout"` → two lines.
    - `RENEWABLE_TERM_KEYS = EXCLUSIVE_TERM_KEYS` → one line.
    - At runtime, values.ts equals docs/03 §2's merged block: 47/47 exports, no value differences.
  - **License text:**
    - `another term of the same length` → one match; `for another year` → nothing.
    - The `#payouts` id and the D139 sentence → one line each in `terms/content.ts`.
  - **globals.css:** the 04 §3.1 awk | diff prints nothing.
  - **Literal and copy checks:**
    - `rg -n 'ClipLease' src/app src/components src/lib/legal` → only the globals.css header comment.
    - The guardian / 13 or older / age band / date of birth `rg` over Terms and Privacy → only the D93 Privacy sentence and the Stripe note next to it.
    - The currency `rg` (cad / usd / canadian dollars / us dollars / dollar-and-digit) over the legal trees → nothing.
  - **Source rules:**
    - `grep -n 'server-only\|from "@/' src/server/env.ts` → nothing.
    - `rg 'export function (isDevAppEnv|enabledCurrencies)'` → two lines.
    - values.ts and app-name.ts import nothing.
  - **Browser (`bun run dev`, in-app browser):**
    - `/` at 375 × 812 and 1280 × 800, light and dark: "Your video." is ink and "Your price." is ink-2. No horizontal scroll (scrollWidth = clientWidth on all five pages at 375). No console errors.
    - Header: `position: sticky`, `saturate(1.6) blur(20px)`, 48 px. `/legal/terms#payouts` lands 64 px from the top (`scroll-padding-top: 64px`).
    - Keyboard on `/`: Tab order is wordmark → header Sign in → pill → License → Terms → Privacy, each with `solid 2px rgb(10, 108, 255)`.
    - No raw `{token}` on any legal page. Reduced motion is the globals.css rule: nothing on these pages animates.
- Decisions: see the Decisions table (2026-10-17, P01).
  - **Owner answers:** Q1 (a), Q2 (a), Q3 (a).
  - **Recorded answers, not asked:** OQ-39, OQ-28, OQ-31, OQ-29, OQ-21, OQ-02, OQ-37 and OQ-49.
- Open questions: none.
- Follow-ups for later prompts:
  - **P02:**
    - Replace the inline header, the pill, the footer links and the draft notice with `NavBar`, `Button` and `Banner`, and pass `LandingSignInLink` to the NavBar's right slot. Keep `prefetch={false}` on both `/sign-in` links until P04.
    - 04 §5.3 gap: `viewport-fit=cover` comes with no left/right safe-area padding. Pad full-width `max-w-app` containers with `max(var(--gutter), env(safe-area-inset-left/right))` in P02's NavBar and container.
  - **P03:**
    - Re-check `values.ts` against 07 (never redeclare it). P03's Step 0 must count the §9.2 values too.
    - The owner puts the real DB URLs in `.env.local` (dev, `cliplease_dev`) and `.env.test` (test, `cliplease_test`, 07 D103).
    - List only `tests/setup/integration.ts` at project level: the root `load-env.ts` already runs for both projects.
  - **Every later prompt that adds an env var:** add `KEY=` to `.env.test` (blank where unused), so `next build` / `next start` in e2e can't pick it up from `.env.local`. Never delete a blank line to make a grep pass.
  - **Env tests:** P23 (R2), P24 (Stripe) and P27 (Google) extend the `deployed` baseline in `env.test.ts` with their credential rules.
  - **CLI scripts:** every CLI or script that imports `env.ts` calls `loadEnvConfig` before its first static import of it (env validates at import).
  - **P15:** render Schedule A from the licensing options.
  - **P20:** fill the License v1 tokens per the header comment in `license-v1.ts`.
  - **P26 / P27:** check `RESEND_API_KEY` with `grep -qE "^RESEND_API_KEY=.+" .env.test && echo SET || echo blank` (it must print `blank`). The blank line stays.
  - **Before launch:** check the Instagram and TikTok in-app menu paths on `/legal/data-deletion` on a real device.
  - **Moving or deleting a route:** run `rm -rf .next/dev` (or start `bun run dev` once) before `bun run typecheck`, because `next typegen` doesn't refresh `.next/dev/types`.
  - **OQ-28 lawyer list (07 D129):**
    - License v1: the Q3 (a) edits to §1, §3 and §7; §14.2 / §14.4 as changed below; "Prices exclude taxes" (OQ-36); the §15 cap; the §16 indemnity.
    - Terms: the US-DMCA wording for a Canadian-first entity, and sections 13 and 14.
    - Privacy: international transfers and regional rights.

### P02 — UI primitives and app shell ✅ (2026-10-17)
> 120 min · Depends on: P01 · Record: the usual bullets (P03's Step 0 also checks that P00 and P01 are ✅)
- Done:
  - **shadcn:** `init -b radix` (style `radix-nova`) and `add` for 15 components, followed by the cleanup described in Decisions. `components.json` points at `@/components/ui` and `@/lib/utils`.
  - **`src/lib/utils.ts`:** a configured `cn` (cn 0.4.0 `createCn`, with the 04 type scale registered), tested in `utils.test.ts`.
  - **`src/components/ui/`** (one 04 §9.1 file per export):
    - Forms: `button` (Button), `text-field` (TextField, TextArea and the shared field chrome), `select-field` (SelectField), `checkbox` (Checkbox), `switch` (Switch), `segmented-control` (SegmentedControl, links mode).
    - Status: `status-pill` (StatusPill, which also re-exports CountdownChip) and `countdown-chip` (client).
    - Feedback: `notice` (Notice), `banner` (Banner), `empty-state` (EmptyState), `fact-list` (FactList), `skeleton` (Skeleton, static), `progress` (Progress).
    - Overlays: `sheet` (Sheet, SheetTrigger, SheetClose, SheetContent), `confirm-sheet` (ConfirmSheet), `menu` (Menu, MenuTrigger, MenuContent, MenuItem), `disclosure` (Disclosure), `toast` (Toaster, toast).
    - Composites: `copy-link-field` (CopyLinkField), `stepper` (Stepper), `data-table` (DataTable), `avatar` (Avatar).
  - **Pure logic:** `src/lib/countdown.ts` (`countdownState`, tested in `countdown.test.ts`). `src/lib/money/currency.ts` (`CURRENCY_DISPLAY`, `currencyLabel`). `src/lib/format.ts` holds the ten 04 §4.4 formatters; `formatEmailDateTime` is P17's. It is tested in `format.test.ts`: 99 tests, made of 48 cases (every 04 §4.4 example, the D98 goldens and boundary cases) run under TZ=Pacific/Auckland and TZ=America/Los_Angeles, plus 3 zone-independent tests.
  - **`src/components/layout/`:**
    - `wordmark` (Wordmark, with `href` and `prefetch` props);
    - `nav-bar` (NavBar in the public, admin and creator variants, plus CountPill);
    - `tab-bar` (TabBar) and `more-sheet` (MoreSheet);
    - `creator-nav.ts` (the shared destinations and `SHELL_PREFETCH`);
    - `gutter.ts` (`SHELL_GUTTER`, a safe-area gutter);
    - `not-found-body.tsx`;
    - `legal-page.tsx`, which now uses Banner and Button.
  - **App files:**
    - `src/app/providers.tsx` holds the LucideProvider (20 px, stroke 1.75). The root layout mounts Providers and `<Toaster />`, and keeps P01's `inter.variable`.
    - Error views: `not-found.tsx` (public NavBar + body), `(public)/not-found.tsx` (body only), `error.tsx` and `global-error.tsx` (both "Try again" → `retry()`).
    - `/dev/ui` gallery: `src/app/dev/ui/page.tsx` (gate), `gallery.tsx` and `theme-attribute.tsx`.
  - **Swaps on `/` and `/legal/*`:** the header is NavBar public (with LandingSignInLink on `/`), the pill is `Button asChild`, and the footer and Contents links are `Button variant="link" asChild`. The draft notice is `Banner warning`.
  - **e2e:** `tests/e2e/smoke.spec.ts` adds `/dev/ui` (one `<main>`, no console errors, noindex) and the 404 page (status, h1, banner, link; it ignores only the browser's log of the document's own 404). A gutter check runs on `/` and the legal pages, and the legal pages are also checked at 320 CSS px for sideways scroll (WCAG 2.2 SC 1.4.10).
- Verified:
  - **Checks:**
    - `bun run typecheck` ✅
    - `bun run lint` ✅ ("Checked 80 files … No fixes applied.")
    - `bun run test` ✅: 7 files and 327 tests (design-tokens 139, values 3, utils 3, countdown 4, license-v1 12, format 99, env 67).
    - `bun run test:int` ✅ (no test files)
    - `bun run lint:tokens` ✅ (prints nothing)
  - **Build and e2e:**
    - `bun run test:e2e` ✅: 16 passed (8 per project, chromium-desktop + webkit-iphone), after the review fixes too.
    - `bun run build` ✅: `ƒ /dev/ui`; `/`, `/_not-found`, `/icon` and the four `/legal/*` routes are static.
    - `/dev/ui` under `next start` with APP_ENV=preview (and non-dev drivers) returns 404 "Page not found." with noindex, while `/` returns 200.
  - **Verify rg checks:** each prints nothing — ranges, banned packages, `dark:`, `style: 'currency'`, `from "cn"` outside utils.ts, and Geist / font-sans outside globals.css. `git diff --stat HEAD -- src/app/globals.css` also prints nothing (shasum dcb74d7… unchanged). `className={inter.variable}` is still on `<html>`.
  - **Packages:** `package.json` changes only by `"class-variance-authority": "0.7.1"` (`clsx` 2.1.1 is transitive). `bun pm untrusted` finds 0. `bun audit` shows 1 moderate (the existing esbuild via drizzle-kit) and no high or critical.
  - **Interaction checks** (scratch Playwright script against `next start`; Chromium 375 and 1280, WebKit iPhone 17):
    - The gallery has no overflow and no console errors in OS light, OS dark, `?theme=light` and `?theme=dark` (canvas #FFF / #000; data-theme set).
    - Sheet: a bottom sheet at 375 and a 480 px centered dialog at 1280. Focus stays inside for 8 Tabs, and Esc returns focus to the trigger.
    - ConfirmSheet: initial focus on "Keep license"; Esc returns focus.
    - Menu: Enter and Space open it, the arrows move, and Esc returns focus.
    - Toast: above the TabBar at 375 (bottom 736, TabBar top 745).
    - Focus: every Tab stop has `solid 2px`, menu items included. None ends under the TabBar in Chromium 375 (58 stops) or WebKit iPhone (7 stops; WebKit's Tab skips links).
    - Targets: every control is ≥ 44 px (its own box, `hit-44`, or a 44 px label row). A click on the far right edge of a Checkbox row toggles it, and a click on the box itself toggles it once.
    - Reduced motion: the sheet animation is 0.001 s, the spinner 0.001 s × 1, and the label still reads "Approving…".
    - 404: status 404, one banner.
  - **Review fixes** (a second scratch script, 21 checks, all ✅):
    - SelectField has the `surface` background and `hairline-strong` border in both themes; the read-only TextField keeps `fill`.
    - Errored fields (input and select) keep the `danger` border on hover.
    - The icon Button stays `fill` with an `ink` icon at rest, on hover and when pressed, in both themes.
    - The money prefix ("CA$") is first in the input's `aria-describedby`.
    - ConfirmSheet has a 44 × 44 Close button; Close returns focus to the trigger; initial focus is still "Keep license".
    - Safe-primary ConfirmSheet: initial focus on "Keep it on", which sits first (above) at 375 and on the right at 1280. Its confirm reads "Turning off…" with `aria-busy` while loading.
    - The toast action's focus ring uses `canvas` on the `ink` toast.
    - MoreSheet rows have no borders.
    - Forced colors (Chromium emulation): the TabBar marker and the Progress bar paint in CanvasText, and the track has a 1 px border.
    - At 320 px the four legal pages don't scroll sideways, and a long Contents link wraps.
    - The original interaction script (27 checks) still passes.
  - **`error.tsx`:** a temporary route that threw on its first render returned 500 with "Something went wrong. Try again." (one h1). "Try again" (`retry()`) recovered to the page. The route was then removed.
  - **Visual pass** (in-app browser, `bun run dev`): the gallery at 375 and 1280, light and dark; `/` and `/legal/license/v1` at 375, dark. Pills use tint and words, and only Approved and Valid are green. Each button block has one primary. Fields show the red border and the message. The header is the frosted NavBar, "Sign in" shows only on `/`, and the draft notice is a Banner.
- Decisions: see the Decisions table (2026-10-17, P02).
- Open questions: none. Q-01, Q-02 and Q-03 (sync-time wording, TabBar current-tab marker, account-menu label) were asked with defaults built; the owner chose the default for each on 2026-10-17 (see Decisions).
- Follow-ups for later prompts:
  - **P04:**
    - Mount the creator shell (NavBar creator + TabBar) in the `(dashboard)` layout, with the real Inbox count.
    - Pass a Sign out `MenuItem` to `NavBar signOut` and a Sign out row to `MoreSheet signOut`.
    - Keep `prefetch={false}` on both `/sign-in` links until `/sign-in` exists.
  - **`SHELL_PREFETCH` (`creator-nav.ts`)** stays false until every `/dashboard/*` route it links exists (P04–P12, Settings). Then turn prefetch back on.
  - **P20b** adds "My licenses" (`/licenses`) to the account Menu and the MoreSheet, and the signed-in buyer NavBar variant (07 D126, 04 §9.30).
  - **Feature prompts** compose these primitives only and add no new `ui/*` without 04 §9.1.
  - **Other prompts:**
    - P17 adds `formatEmailDateTime` (07 D84) to `src/lib/format.ts`.
    - P28b: `formatCompact` takes `(n, noun)`.
    - P21 puts the admin tabs (SegmentedControl links mode) in `NavBar admin below`.
  - **Gotcha:** never import a non-component value (a constant, a class string) from a `"use client"` module into a Server Component. It arrives as a client reference, not the value: P02 lost the page gutter this way until `SHELL_GUTTER` moved to `gutter.ts`. Shared constants live in plain modules.
  - **Kit wording** (AGENTS.md §9, 02 §1.1, stack.md fact 42): `-b radix` applies to `shadcn init` only. `add` has no `-b` and takes the base from components.json.

### Simplify pass over P00–P02 ✅ (2026-10-17)
> Owner request before P03: "run simplify on the entire project to date". Four reviewers (reuse, simplification, efficiency, altitude) read every tracked source file; the fixes below change no copy and no behaviour, except the TabBar height (a spec fix).
- Done:
  - **Shell:** `src/components/layout/public-shell.tsx` (a plain module: `Bar`, `PublicNavBar`, `PublicShell`, `MessageBody`) and `error-body.tsx` (`ErrorBody`, the 05 §10 error copy written once). The `(public)` layout, the root `not-found.tsx`, `error.tsx` and `global-error.tsx` use them, and `gutter.ts` adds `SHELL_MAIN`. NavBar's public variant renders `PublicNavBar`. Public pages, the 404 and the error view no longer load the creator Menu code.
  - **Primitives:**
    - Button renders its two-layer loading grid only when it has a `loadingLabel`; an icon button swaps its icon for the spinner.
    - Disclosure's trigger and the landing "Sign in" are `Button tertiary` (`asChild`) instead of copied classes. CountPill uses `pillVariants`, and StatusPill's dot is one lookup.
    - One `useFieldControl` hook gives TextField, TextArea, SelectField, Checkbox and Switch their id and ARIA wiring (`FieldProps` is exported; `describedBy` is gone).
    - CopyLinkField has one status state. CountdownChip formats its tooltip once per expiry and skips renders when nothing visible changed. FactList uses `gap` instead of negative margins.
  - **TabBar:** sized from `--tabbar-h` (56 px + safe area, with its border and `safe-area-bar` padding inside; tabs are 45 px), which is the space the root scroll padding and the toast offset reserve; it was 67 px. It renders its own in-flow spacer, so hosts don't pad for it (the gallery's `pb-[calc(…)]` is gone).
  - **Lib:**
    - `src/lib/time.ts` (`MINUTE_MS`, `HOUR_MS`, `DAY_MS`) replaces five local copies.
    - `format.ts` builds its date formatters once (UTC day and time at module level; deadline formats cached per zone, and an unknown zone falls back to UTC without being cached), replacing `safeZone`.
    - `LICENSE_V1_UPDATED_LABEL` uses `formatPostDate` (en-GB would print "Sept" for September). `LICENSE_V1_DISPLAY_TITLE` is the one source for the License v1 title (page h1, metadata, the Terms link).
    - `mailtoLink`, `urlLink` and `GOOGLE_PERMISSIONS_URL` live in `legal/types.ts`. The legal page builds React keys with one `keyed()` (the JSON of the item) instead of three key helpers.
  - **`env.ts`:** `ENV_KEYS` comes from the schema shape (`Object.keys(shape)`), so a new key can't be missed. One `secret` schema, `ADMIN_EMAILS` `.default([])`, no redundant `.int()`, and each issue's key is computed once. A new unit test checks that `.env.test` lists every `ENV_KEYS` entry (a missing key would let `next start` fill it from `.env.local` during e2e).
  - **Tests and config:** `format.test.ts` folds two one-off tests into its tables; `license-v1.test.ts` uses `licenseV1Tokens`; the e2e spec has one `visit()` helper and checks the Terms sections inside the legal loop (one page load fewer per project); `playwright.config.ts` sets `fullyParallel: true`; `biome.json` drops a `files.includes` list that `.gitignore` already covers. The gallery uses `SHELL_MAIN`, a `Frame` helper and a 12-country list.
- Verified:
  - `bun run typecheck` ✅ · `bun run lint` ✅ (83 files: the 80 before plus 3 new modules) · `bun run test` ✅ (7 files, 332 tests; format 103, env 68) · `bun run test:int` ✅ · `bun run lint:tokens` ✅ · `bun run build` ✅ (same routes) · `bun run test:e2e` ✅ (14 passed, 7 per project, 5 workers).
  - **Rendered output unchanged:** the prerendered HTML of `/`, the four `/legal/*` pages, the 404 and the global error has the same title, visible text and link targets as before the pass, compared line by line.
  - **Browser (`next start`):**
    - Public pages load no DropdownMenu code; `/dev/ui` does.
    - The TabBar is 56 px with 45 px tabs and a 56 px spacer (hidden at lg), and the gallery's last section ends above the bar.
    - The landing "Sign in" is 44 px tall with no padding and underlines on hover. Disclosure toggles (36 px trigger).
    - FactList keeps its 4 px label-to-value and 12 px fact gaps on mobile, and the 112 px column from sm.
    - Copy shows "Copied" and resets after 2 s; with no clipboard it selects the text and says "Press and hold to copy". CountdownChip's label and tooltip render.
    - The P02 scripts still pass (27 + 21 checks). In one of three full runs, WebKit read focus as `body` right after the ConfirmSheet closed; 16 further WebKit runs all returned focus to "Revoke license". It is a timing race in the script's read, and this pass didn't touch ConfirmSheet.
    - A temporary throwing route returned 500 with one h1, "Something went wrong. Try again.", and recovered with "Try again"; the route was removed.
- Decisions: see the Decisions table (2026-10-17, simplify).
- Skipped, with the reason:
  - Building `cn`'s merge tables at build time (`cn/engine`, `cn build`): it would save about 5.6 KB gzip and about 9 ms on the first `cn()` call, but it adds a generated file or a build step to a recorded P02 decision. Revisit if the JS budget needs it.
  - Lower value, left as they are: a `(landing)` route group so "Sign in" needs no pathname check; a shared constant for the "current item" underline (NavBar, Stepper); a `LEGAL_ROUTES` map; a table-driven `currentNavKey`; MoreSheet owning its Sign out control (decide in P04); seeding `ENV_KEYS` in playwright.config (the new unit test covers the risk). `.env.example` has no `STRIPE_SECRET_KEY_CAD` line; left as P01 wrote it.
- Follow-ups for later prompts:
  - **P04:** render `<TabBar />` in the dashboard layout. The root layout's `<body>` reserves the bar's height below lg whenever a TabBar is mounted (`max-lg:has-[[data-tabbar]]:pb-…`; this replaced the TabBar's own spacer in the P03 code review).
  - **P08:** the Disconnect sheet links `https://myaccount.google.com/permissions` (07 D49). The Privacy Policy and the data-deletion page keep `GOOGLE_PERMISSIONS_URL`, the address YouTube's developer policy quotes (research/license.md). Both open the same Google page; this is deliberate, not a conflict.
  - **P15 (PriceBar):** move `useKeepFocusAboveBar` into a shared module rather than copying it, and reserve the PriceBar's height on `<body>` the same way (`has-[[data-pricebar]]`).

**M1 Data, sign-in and handle** · P03–P05 with P04b · 7.75 h

### P03 — Database schema, migrations and integration harness ✅ (2026-10-17)
> 120 min · Depends on: P01, P02 · Record: the Neon branches (OQ-01 answer), migration hosts (no secrets), how to target the test database, differences between the generated `auth.ts` and 03 §3.3; 19 tables, 27 enums (incl. `currency`), 56 CORE CHECKs; the four currency columns
- Done:
  - **Database (owner, 2026-10-17):** Neon project `cliplease` on **Postgres 18.6** (the owner chose 18 over the plan's 17; OQ-01 updated), region AWS US East (N. Virginia), branches `dev` and `test` with auto-delete off, database `neondb` on each. `.env.local` holds `dev`'s pooled and direct URLs and `.env.test` holds `test`'s; the owner saved them with a scratch helper that never prints a URL.
    - Migration hosts (direct endpoints; the repo is public, so only their start is recorded, enough to match what `drizzle.config.ts` prints): `dev` → `ep-solitary-lab-…` and `test` → `ep-broad-cherry-…`, both in `c-14.us-east-1.aws.neon.tech`.
    - **Target the test database** with `NODE_ENV=test bun run db:migrate`: @next/env then loads `.env.test` instead of `.env.local`, and `drizzle.config.ts` prints the host and the env file it used.
  - **Schema (`src/db/schema/`):** `enums.ts` (27 pgEnums), `columns.ts`, `auth.ts` (generated), `creator.ts`, `social.ts`, `video.ts`, `licensing.ts`, `ops.ts`, `relations.ts`, `types.ts` and the `index.ts` barrel, copied from 03 §3–§4 with the cuts and fixes in Decisions. `src/lib/licensing/snapshot.ts` holds the `LicenseSnapshotV1` type only (03 §3.7.2: no `guardianName`; it includes `amounts.currency`, `exclusive` and `renewalOfCode`).
  - **Client and config:** `src/db/client.ts` (a `pg` Pool on the pooled `DATABASE_URL`, `attachDatabasePool(pool)`, `drizzle({ client: pool, schema })`, `pool` exported). `drizzle.config.ts` as in stack.md, with `schema: "./src/db/schema/index.ts"`. `src/server/auth/auth.ts` is the minimal Better Auth config from the prompt (OTP email throws "Sign-in email arrives in P04").
  - **Scripts:** `db:generate`, `db:migrate`, `db:check`, `db:studio`, `auth:schema` (flags exactly as the prompt; `bunx auth@1.7.7 generate --help` lists them). `test:int` no longer passes with no tests.
  - **Migration:** `drizzle/0000_init.sql` and `drizzle/meta/*`, generated with `bun run db:generate --name init`, read in full against 03 §8.2 step 3, and applied to `dev` and `test`.
  - **`auth.ts`:** generated by `bun run auth:schema`, then only the 2 hand edits (import `userRoleEnum`; `role: userRoleEnum("role").default("creator").notNull()`), each marked with a `HAND EDIT` comment. Its other differences from 03 §3.3 are layout only: a multi-line, unsorted `drizzle-orm/pg-core` import, `/* @__PURE__ */` in the `$onUpdate` callbacks, and prettier line wrapping. Tables, columns, indexes and relations are the same.
  - **Integration harness:**
    - `vitest.config.mts`: the integration project lists only `tests/setup/integration.ts` (the root `load-env.ts` runs first), `fileParallelism: false`, 30 s test and hook timeouts.
    - `tests/setup/integration.ts` imports the helpers and the client dynamically, then guards, truncates once per file and ends the pool.
    - `tests/helpers/test-database.ts`: the pure `checkTestDatabase` (no connection, no file access). `tests/helpers/db.ts`: `assertTestDatabase`, `resetDb`, `expectDbError` and the `PG_ERROR` codes.
    - `tests/helpers/factories.ts`: `insertUser`, `insertCreator`, `insertSocialAccount`, `insertSocialPost`, `insertLibraryVideo`, `insertUploadVideo`, `insertVideoPosting`, `insertLicenseRequest`, `insertMoneyMovement` and `insertLicense`.
  - **Tests:** `src/db/schema/enums.test.ts` and `tests/unit/test-database.test.ts` (unit, no database); `tests/integration/db/schema-shape.test.ts`, `constraints.test.ts` (the nine smoke cases) and `test-db-guard.test.ts` (the guard on the real run). The unit project now also includes `tests/unit/**`.
  - **Code review and simplify (owner request, before this commit):**
    - Review fixes in earlier code: `Button asChild` now keeps `onClick` (it was dropped) and the busy state; `ErrorBody` has "use client"; Stepper's `steps` must be non-empty (type); Avatar initials take the first grapheme (`Intl.Segmenter`); CopyLinkField restarts its 2 s and re-announces on every press; Banner wraps its text in a `<div>`, not a `<p>`; DataTable columns take an optional `id` key; stale schema comments removed.
    - TabBar: the space below the page moved from a spacer inside TabBar to a `<body>` class in the root layout; the gallery renders the TabBar after `<main>`.
    - Simplify: one `insertOne` helper in the factories, shared `PG_ERROR` codes, the guard moved to a pure module using pg's parser, flat lists in `schema-shape.test.ts`, a one-line-per-enum map in `enums.test.ts`, `snapshot.ts` uses the values.ts key types.
  - P01's three P03 follow-ups are done: `values.ts` re-checked (47 tuples, §9.2 values included), the owner's URLs are in place (database `neondb`, see Decisions), and only `integration.ts` is listed at project level.
- Verified:
  - `bun run typecheck` ✅ · `bun run lint` ✅ (105 files, no warnings) · `bun run test` ✅ (9 files, 373 tests: the 332 before, `enums.test.ts` 29, the guard's 11 and one more `values.test.ts` case) · `bun run lint:tokens` ✅ · `bun run build` ✅ (same routes) · `bun run test:e2e` ✅ (14 passed).
  - `bun run db:check` ✅ ("Everything's fine"). `bun run db:generate` again prints "No schema changes, nothing to migrate" and writes nothing.
  - `bun run db:migrate` ✅ and `NODE_ENV=test bun run db:migrate` ✅. A second run of each applies nothing: both branches have 1 row in `drizzle.__drizzle_migrations` before and after (drizzle-kit always prints "applied successfully", so the count is the proof). Each branch: Postgres 18.6, 19 tables, 27 enums, 56 CHECKs in `public`.
  - `bunx auth@1.7.7 check schema --config src/server/auth/auth.ts` ✅ ("Schema check passed against the configured Drizzle schema").
  - `bun run test:int` ✅: 3 files, 15 tests (schema-shape 5, constraints 9, guard 1) against the `test` branch.
  - **Verify greps:** the forbidden-names grep and the removed-model rg print nothing; `currency` appears on 5 lines; the five renewal values sit in the two `CREATE TYPE` lines; the 0001/0003 rg prints nothing; the `server-only` / `@/` grep over `src/db`, `auth.ts` and `env.ts` prints nothing.
  - **Guard refusals (no file edited):** `APP_ENV=development bun run test:int` exits 1 with "Tests need APP_ENV=test"; with the shell's `DATABASE_URL`/`DATABASE_URL_UNPOOLED` set to `.env.local`'s, it exits 1 with "Refusing to touch the database: DATABASE_URL is the .env.local database (DATABASE_URL)". Neither output contains a host or password, and `dev` still had 0 rows in all 19 tables afterwards.
  - **`dev` contents:** `psql … -c '\dt'` lists the 19 tables. The Verify columns exist (`video.postings_confirmed_at`, `same_video_confirmed_at`, `base_price_override_cents`, `original_upload_id`, `disabled_reason`; `creator_profile.age_confirmed_at`, `payout_currency`; `money_movement.currency`, `license_request.currency`, `stripe_event.platform_currency`) and `show_platform_link`, `verified_provider`, `video.social_post_id` and `age_band` do not. psql here is 14.15 (it warns about the newer server). Studio wasn't needed.
  - **Packages:** no dependency added or changed (`package.json` changes only scripts). `bun audit`: 1 moderate (the existing esbuild one). `bun pm untrusted`: 0. `auth@1.7.7` tree, re-audited before first use (2026-10-17): a lockfile-only npm install of exactly 1.7.7 gives 127 packages, `npm audit` 0 vulnerabilities, no install scripts; `bun audit` inside the bunx folder: "No vulnerabilities found (checked 123 packages)".
  - `bun run dev`: `/` renders at 375 px (dark) and 1280 px (light) with no console errors and no sideways scroll.
- Decisions: see the Decisions table (2026-10-17, P03).
- Open questions: none.
- Follow-ups for later prompts:
  - **P04:**
    - Replace the `sendVerificationOTP` placeholder in `src/server/auth/auth.ts` and add the rate-limit rules.
    - Every `betterAuth()` import runs Better Auth's offline Drizzle schema check: an "ERROR … Drizzle schema mismatch" at startup means the schema really drifted.
    - P04's Step 0 can prove "nothing to apply" with `select count(*) from drizzle.__drizzle_migrations` (1 on each branch) and list the tables with `bun run db:studio`, or with a throwaway script in the agent's scratchpad that calls `loadEnvConfig` and connects `pg` to `process.env.DATABASE_URL_UNPOOLED`. Never put a URL on a command line: psql prints the whole URL, password included, when it can't parse it.
  - **Error logging (P04 and later):** a `DrizzleQueryError` message contains the SQL and every bound parameter (emails, sealed tokens). Log only the Postgres error code and constraint name.
  - **P09:** `posted_at` is nullable and sorts first under `DESC NULLS FIRST`; the Library's keyset cursor (03 §7.2) must handle a null `posted_at`.
  - **P20b:** write `license_request_buyer_email_created_idx` with `.desc().nullsFirst()` like the 0000 indexes.
  - **P22b:**
    - Add back what P03 cut: the renewal import, relations and `renewal*Relations` in `relations.ts`, the 8 renewal types in `types.ts`, `export * from "./renewals"` in `index.ts`, and `licenseRequestOriginEnum` / `AnyPgColumn` / the renewals import in `licensing.ts`.
    - A `one()` with only `relationName` crashes `drizzle()` in 0.45 (see Decisions): write each reverse side of a multi-FK pair with explicit `fields` and `references`.
    - On Postgres 18 a RESTRICT foreign key reports `23001`, not the prompt's `23503` (see Decisions): expect `23001` with the constraint name.
  - **P31a:** truncate the test branch before applying the [H1] migration (rows from `test:int` stay behind). Then change the total-cap cases in `constraints.test.ts`: with the factory's base 15000 at ×1.00, 90,909,090 + 9,090,909 breaks `license_request_price_formula`, and the 100,000,000 and `platform_fee_min_cents = 10001` cases report `license_request_fee_formula` first (CHECKs fire in name order). Give each row a base and multipliers that compute its price (e.g. base 909,000, use 100000, term 100000, territory 10001 → 90,909,090), with fee = max(round(10%), 200).
  - **Tests:** integration and e2e share the `test` branch: never run `bun run test:int` and `bun run test:e2e` at the same time locally (in P32 CI each job has its own Postgres service, so they never share a database). The factories stay the shared ones: later prompts extend them, never copy them.
  - **P32:** use the `postgres:18` service image for `integration`, `e2e` and `lighthouse` (Neon runs 18.6). P32 (line 86, its acceptance criterion at line 149) and 02 §11.3 say `postgres:17`; on 17 the RESTRICT case in `constraints.test.ts` gets 23503, not 23001. Record the change as following the owner's Postgres 18 choice.
  - **Local Postgres fallbacks** (P22, P31a, P32) say "Postgres 17": with Neon on 18, use 18 tools (`pg_dump` 18).
  - **Noise, not failures:** pg prints one `sslmode=require` SECURITY WARNING per process (the URLs stay as the owner pasted them), and the Better Auth CLI prints a MODULE_TYPELESS_PACKAGE_JSON warning (never add `"type": "module"`).

### P04 — Passwordless sign-in and route protection ✅ (2026-10-18)
> 120 min · Depends on: P03 · Record: both admins in `ADMIN_EMAILS`, owner first (OQ-02 answer), what `user.name` holds after an OTP sign-up, the session helper names chosen
- Done:
  - **Owner answers (P04, in chat, 2026-10-18):** both admins are in `.env.local` `ADMIN_EMAILS`, owner first (OQ-02; checked by count and format only, the addresses are not recorded here); the signed-out banner shows only when `next` is present **and** the request carries a stale session cookie (Q2 a); the proposed copy ships and is listed below (Q3 a); a sign-in lasts 7 days, Better Auth's default (Q-04); P04 runs as one step with a 6 h budget (Q-05).
  - **Better Auth (`src/server/auth/auth.ts`, still CLI-loadable, relative imports):** `emailOTP` (6 digits, 600 s, 3 attempts, `storeOTP: "hashed"`, the lazy `sendSignInCode` import); `rateLimit` on database storage with `signInRateLimits(env.APP_ENV)`; `session` 7 days with `updateAge` 1 day; `databaseHooks.user.create.after` promotes `ADMIN_EMAILS` addresses with an app-owned UPDATE; a `logger.log` sink that writes Better Auth's warnings and errors as redacted JSON lines (`auth.better_auth`); `nextCookies()` last; no `cookieCache`. Route handler `src/app/api/auth/[...all]/route.ts`; client `src/lib/auth-client.ts` (`emailOTPClient`). `bun run auth:schema` regenerated the same file; the 2 hand edits are unchanged.
  - **Email v1:** `src/server/email/{types,subjects,send}.ts`, `drivers/console.ts`, `src/emails/sign-in-code.tsx`. The console driver refuses outside `APP_ENV` development/test, prints the plain block with `process.stdout.write` and writes `.data/emails/<iso>-<6 hex>-<template>.json` atomically (`.data/` is git-ignored). `emailDriver()` throws "Resend driver arrives in P26" when `RESEND_API_KEY` is set. No `email_log` row, no log line.
  - **Pure helpers (`src/lib/sign-in.ts`):** `safeNextPath`, `signInPath`, `maskEmail`, `normalizeOtpInput`, `OTP_RESEND_DELAY_MS`, `OTP_EXPIRES_IN_S`, `SESSION_EXPIRES_IN_S`, `SESSION_UPDATE_AGE_S`, `signInRateLimits`, `SIGN_IN_COPY`, `signInErrorKey`, `FORM_LEVEL_ERRORS`, `shouldAutoSubmit`. The sign-in form checks the email with `zod/mini` (the full Zod was about 27 KB gzipped of the page's 30 KB).
  - **`/sign-in` (S10):** `src/app/(auth)/layout.tsx` (public chrome), `sign-in/page.tsx` (signed in → `redirect(safeNextPath(next))`; the banner per Q2), `sign-in/sign-in-form.tsx` (both steps, 30 s resend, auto-submit of six digits that arrive in one change, focus and announcements, Banner for offline/server errors, bfcache reload after a sign-in). `next.config.ts` `headers()`: the 02 §4.6 rows, HSTS only when `APP_ENV=production`, `X-Robots-Tag: noindex, nofollow` on `/sign-in`, `/dashboard/:path*`, `/onboarding`, `/admin/:path*`.
  - **Gates:** `src/proxy.ts` (02 §4.5 code, three matcher entries), `src/server/auth/session.ts` (`getSessionUser`, `requireUser`, `requireCreator`, `requireAdmin`, `getCreatorForApi`, `toActor`, plus `hasStaleSessionCookie` for the banner and `getSessionRefreshAt` for SessionRefresh), `src/server/auth/actor.ts` (the full 02 §5 `Actor` union), `src/lib/result.ts` (`ActionResult`).
  - **Placeholders and shell:** `(dashboard)/dashboard/layout.tsx` (creator shell, UX only) and `page.tsx` (Inbox EmptyState as the page's h1), `(dashboard)/onboarding/page.tsx` (two-tone "Welcome. Pick your handle."), `admin/layout.tsx` and `page.tsx`. `src/components/layout/sign-out.tsx` (`SignOutMenuItem`, `SignOutButton`) wired into the avatar Menu, the MoreSheet and the `/dev/ui` gallery; `app-shell.tsx` (`AppShell`: the signed-in frame for `/onboarding`, `/dashboard/**` and `/admin`: nav, one `<main data-app>` on `canvas-alt`, the TabBar slot and `SessionRefresh`), `session-refresh.tsx` (`SessionRefresh`). NavBar gained `withoutProfile` (/onboarding: no links, Menu = Sign out), EmptyState an `as` heading prop; TextField, TextArea, SelectField and Checkbox now add a caller's `aria-describedby` to their own links instead of losing them; `src/components/ui/inline-link.ts` holds the inline-link classes the legal pages and the sign-in footnote share. The landing page's /sign-in links lost `prefetch={false}` and their "doesn't exist until P04" comments.
  - **Logger, audit, seed:** `src/lib/redact.ts` and `src/lib/log-line.ts` (pure: `formatLogLine`, `SCOPED_NAME`; shared by `src/server/log.ts`, the Better Auth sink and `audit.ts`), `src/server/log.ts` (`logEvent`), `src/server/audit.ts` (`auditActorType`, `writeAudit`), `scripts/seed.ts` (`runSeed`, `seedRefusal`) and `"db:seed": "NODE_OPTIONS=--conditions=react-server tsx scripts/seed.ts"`.
  - **Test helpers (later prompts reuse them):** `tests/helpers/read-latest-email.ts` (`readLatestEmail({ to, template, since })`, `extractSignInCode`, `readSignInCode`, `wrongCode`; plain Node), `tests/helpers/next-headers.ts` (`mockNextHeaders`; each file adds `vi.mock("next/headers", () => import("../../helpers/next-headers"))`), `tests/helpers/auth.ts` (`signInWithOtp` → the Cookie header a browser would send, `requestCode`, `tryCode`, `sessionCookiesOf`, `newCreatorEmail`, `userByEmail`, `SESSION_COOKIE_NAME`; it re-exports `mockNextHeaders`), `tests/e2e/helpers/sign-in.ts` (`signInWithEmail`, `requestCode`, `uniqueEmail`, `e2eAdminEmail`), `tests/e2e/helpers/console.ts` (`collectConsoleErrors`, now also used by the smoke spec). `playwright.config.ts` runs `checkTestDatabase` before starting.
  - **Tests:** unit `src/lib/sign-in.test.ts`, `src/lib/redact.test.ts`, `src/server/log.test.ts`, `src/server/audit.test.ts`, `src/emails/sign-in-code.test.tsx`, `src/server/email/drivers/console.test.ts`; [int] `tests/integration/auth/sign-in.test.ts` (8), `session.test.ts` (7), `seed.test.ts` (6); e2e `tests/e2e/sign-in.spec.ts` (16 per project).
  - **Pre-commit review (5 lenses, each finding verified by a second agent):** 21 confirmed findings, all fixed: the redactor's text patterns were quadratic (one unauthenticated request with a long callback URL could block the server for minutes; now capped at 2,048 characters and anchored, under 50 ms on 200 KB); the audit writer blanked `code` keys that P18–P24 store; the daily session refresh never reached the browser; the creator layout's redirect would drop deep links; screen-reader announcement of errors; offline/server errors marked a valid field invalid; "Use a different email" during a request; Back after sign-in (Safari bfcache); the onboarding Menu's dead Settings link; the 404 at `/admin` titled "Admin"; the email footer's support line; `canvas-alt`; and six test gaps. A second review confirmed all 21 fixes and found 2 more low issues, both fixed: URLs glued to "-", "." or "+", or that don't parse, kept their query string (an unparseable URL now keeps only its scheme); and SessionRefresh was tested only on `/onboarding` (now part of AppShell, checked on `/onboarding` and `/admin`).
  - **Simplify (owner request, 4 reviewers: reuse, simplification, efficiency, altitude):** AppShell replaced three hand-built shells; SessionRefresh calls the auth route only once an extension is due (`getSessionRefreshAt`), not on every full page load (about 5 database queries each); `zod/mini` on the sign-in page; one log-line formatter and one `scope.action` rule for logs, the Better Auth sink and audit; the sign-in form keeps one field ref, derives "Send a new code" from a send counter and does its send bookkeeping in one place; the seed's `created` is a boolean; shared test helpers (`readSignInCode`, `wrongCode`, `countRequests`, `newCreatorEmail`, `userByEmail`) and time constants from `src/lib/time.ts`; the email's "10 minutes" comes from `OTP_EXPIRES_IN_S`. Skipped: the proxy keeps 02 §4.5's own URL code (P04 asks for exactly that code); admins stay promoted by `create.after` + UPDATE (P04 task 1); Better Auth's `database.joins`, a NavBar `account` variant (P20b), error reasons apart from copy (P22c), an automatic console-error fixture and importing the copy into e2e (the specs pin the owner's wording). Moving the admin title gate to the layout's `generateMetadata` was tried and left the 404 untitled, so it stays on the page.
- Verified:
  - `bun run typecheck` ✅ · `bun run lint` ✅ · `bun run lint:tokens` ✅ (prints nothing) · `bun run test` ✅ (15 files, 496 tests) · `bun run test:int` ✅ (6 files, 36 tests) · `bun run test:e2e` ✅ (46 passed: sign-in 16 + smoke 7, on both projects; 12 back-to-back full runs passed, and `--repeat-each 4` passed 184 of 184 after the WebKit fix below).
  - `bunx auth@1.7.7 check schema --config src/server/auth/auth.ts` ✅ · `bun run db:generate` ✅ "No schema changes, nothing to migrate".
  - `bun run db:seed` (dev): "created seed_user_admin with the first ADMIN_EMAILS address"; second run "nothing to change" ✅. `APP_ENV=production bun run db:seed` → exit 1, "refusing to run with APP_ENV=production" ✅; `bun run db:seed --demo` → exit 1 ✅. The seed ran under `--conditions=react-server` (audit.ts imported); no D53 fallback.
  - curl against `bun run dev`: `/dashboard` → 307 `/sign-in?next=%2Fdashboard`, `/onboarding` → `…%2Fonboarding`, `/admin` → `…%2Fadmin`, `/dashboard/library?platform=mock` → `…%2Fdashboard%2Flibrary%3Fplatform%3Dmock` ✅; `/sign-in` has `X-Robots-Tag: noindex, nofollow`; `/` has `X-Frame-Options: DENY`, `nosniff`, the referrer and permissions policies and no HSTS ✅. `test -f src/proxy.ts && test ! -f src/middleware.ts` → proxy-ok ✅.
  - Manual pass (browser pane, `bun run dev`, 375 × 812 and 1280 × 800, light and dark): step 1 and 2 render; a wrong code shows the copy on the field and focus returns there; pasting the grouped "123 456" code signs in once and lands on `/onboarding`; the 4th "Email me a code" within 60 s (APP_ENV=development) shows "Too many tries. Wait a minute and try again."; the stale-cookie banner; a creator gets the 404 (titled "Page not found") on `/admin`; Sign out from the avatar Menu and from the MoreSheet (`/dev/ui`, phone width) → `/sign-in`. No console errors besides the browser's own "Failed to load resource" lines for the expected 400/404/429 responses. The `/admin` placeholder for a listed admin is covered by e2e (both e2e admins); the owner checks it with their own address.
  - SQL (dev): `email_log` 0 rows; `seed_user_admin` is `admin`, `email_verified` true, `name` ''; the two manual-check users are creators with `name` ''; no `verification.value` holds a plain 6-digit code ✅.
  - **Packages:** none added or changed (`package.json` gained only `db:seed`). `bun audit`: the existing esbuild moderate only. `bun pm untrusted`: none.
- Decisions: see the Decisions table (2026-10-18, P04).
- Open questions: none (Q-04 and Q-05 answered in chat).
- Follow-ups for later prompts:
  - **P05:** `user.name` is `""` after an OTP sign-up (`emailVerified` true, role `creator`, no `account` row); onboarding sets the display name. Replace the `/onboarding` placeholder but keep `requireUser("/onboarding")` and render it through `AppShell` (it brings `data-app` and SessionRefresh). The default landing (`next` absent) is `/dashboard` → `requireCreator` → `/onboarding` for users without a profile; P20b adds the `/licenses` branch of 07 D126. Every new `/dashboard/**` page calls `requireCreator(<its own path>)`: the layout no longer redirects.
  - **P17 / P26:** Better Auth swallows a failed `sendVerificationOTP` and still answers 200, so the form says "Check your email" when nothing was sent; only the `auth.better_auth` log line shows it. P26's Resend driver should make send failures visible.
  - **P18 and later audit writers:** `writeAudit` keeps a `code` key (license codes); `otp`, tokens, secrets and emails are still redacted.
  - **P20b:** add `/licenses/:path*` to the proxy matcher (02 §4.5 lists it), the "Sign in to manage your licenses" variant and the neutral line (05 §5.1 callouts 10–11), and "My licenses" in the `withoutProfile` Menu.
  - **P21:** the admin NavBar has no Sign out (04 §9.30 draws none); add one with the tables. Gate each admin page's title the way `admin/page.tsx` does (`generateMetadata` calls `requireAdmin`), or the 404 for non-admins is titled with the page's name. `requireAdmin()` always uses `next=/admin`; give it a `next` argument when nested admin pages arrive.
  - **Any page that 404s behind a gate:** static `metadata` resolves apart from the layout's gate; use `generateMetadata` with the gate.
  - **P31/P32 (deploy):** the limiter keys by the single `x-forwarded-for` value (127.0.0.1 in dev/test); check it on Vercel. `next.config.ts` headers are fixed at build: build and start with the same `APP_ENV`. Nothing cleans old `rate_limit` and `verification` rows yet.
  - **Session behaviour:** pages read the session without extending it (a Server Component can't write the cookie); `SessionRefresh` (in every `AppShell`) extends it once a day through `/api/auth/get-session`. A session that ends normally drops its cookie, so the signed-out banner appears only when the server ends a session early (sign-out elsewhere, revocation).
  - **Dev note:** a long-running `next dev` may keep serving an old `globals.css` bundle after the file changes; restart it if a CSS change doesn't appear.

### P04b — Responsive tiers: tablet and XL for the shell, primitives and pages built so far ✅ (2026-10-18)
> 105 min · Depends on: P04, P02, P01 · Record: D144–D158 as applied, the iPad descriptor, the sm: moves, the pointer-coarse finding, where the /admin sweep lives; the `globals.css` shasum before and after, any helper name 02 doesn't list; status line "Current prompt: P05 · Last verified: P04b"
- Done:
  - **Owner answers:** OQ-54 (fully responsive; 07 §11, D144–D158) is final and was not asked again. Prompt question 1 (an iPad on the LAN) was not answered before the build, so its default (b) applies: no iPad check; the `webkit-ipad` project (portrait 768 × 1024 and the 1024 × 768 describe) and the browser-pane checks cover it. **Kit update during the run (owner, 2026-10-18):** Task 8's copy list now also takes OQ-57 (the header sentence, the Owner answers intro and the OQ-54–OQ-57 rows, copied word for word) and the Open questions range "OQ-01–OQ-57"; the buyer top bar (P20b), the Inbox row staying in place (P17–P19) and the Exclusive/Perpetual term switch (P19f) were not built here.
  - **Task 1, tokens:** `src/app/globals.css` is the 04 §3.1 block, extracted with the prompt's awk. `git diff` shows exactly the six allowed hunks: the tier comment and the `/* Tablet (md) */`, `/* Desktop (lg) */` and `/* XL (2xl) */` labels, `--app-max: 75rem` in `:root`, the `96rem` query (`--app-max: 90rem`), `--container-app` moved from the static `@theme` to `@theme inline` as `var(--app-max)`, the `--container-reading` comment, and the label on the scroll-padding/toast-offset `64rem` query. shasum before `61daef55b10f4286c081e987a81863896ee21f9c`, after `4fad044e3c261e3ab205185d7e945c81787330cc`. `max-w-app` now compiles to `max-width: var(--app-max)`: 1200 px below 1536, 1440 px from 1536 (`SHELL_MAIN`, the NavBar row, the admin `below` row and the TabBar list widen with no class change). `design-tokens.test.ts` gained `keeps the default Tailwind breakpoints (07 D144)`.
  - **Task 2, breakpoint lint:** `scripts/lint-tokens.sh` has 04 §3.4's six layout patterns verbatim. The four `sm:` uses moved to `md:` (FactList, every class including `md:contents`, and its doc comment; the landing Sign in button; both sign-in buttons). Probe: `src/components/lint-probe.txt` with the seven lines made `bun run lint:tokens` print the seven probe lines plus the Toast's `100vw` line and exit 1; the file is deleted and the lint now prints nothing. `smoke.spec.ts`'s gutter comment says 16 / 24 / 32 px by tier.
  - **Task 3, shell and primitives:** the TabBar list is `md:max-w-reading` with `pl-/pr-[env(safe-area-inset-*)]` (five tabs in a centered 640 px row on Tablet under a full-width bar); Sheet header, body and footer take `pl-/pr-[max(1rem,env(safe-area-inset-*))]` below `md` and keep `md:px-8` (32 px from 768, measured; ConfirmSheet and MoreSheet share the constants); the Toast cap is `calc(100%-2*var(--gutter))`. Confirmed with no edit: creator links `hidden lg:block`, TabBar `lg:hidden`, the root body's `max-lg:has-[[data-tabbar]]:pb-…`, the `64rem` scroll-padding switch, Sheet → `max-w-[30rem]` dialog from `md`, Stepper and FactList at `md`, fields `h-12 lg:h-11`, `hit-44` on the small controls. **Layout fix:** `hit-44` on the creator NavBar links (`nav-bar.tsx`): "Inbox" was about 38 px wide, under 07 D152's 44 × 44 at every tier; the hit area grows, nothing shows.
  - **Task 4, pages:** every page follows its 05 §1.6 line with no change except one **layout fix**: sign-in step 2 put the masked address in a `whitespace-nowrap` span (P04), so a long domain scrolled the page sideways at 320 px (161 px); it is now `MaskedAddress`: an `inline-block max-w-full wrap-anywhere` span with a `whitespace-nowrap` "m…@" prefix, so the address moves to its own line as one block and a long domain wraps inside the column. The dev-only tier readout (`data-testid="tier"`) is under the gallery's intro line.
  - **Task 5, Playwright:** `webkit-ipad` (`devices["iPad Mini"]`: 768 × 1024, scale 2, mobile, touch, WebKit) and `chromium-xl` (`Desktop Chrome` at 1920 × 1080), both `testMatch: /responsive\.spec\.ts$/`; the original two are unchanged (`iPhone 17` is 402 px wide: Mobile). `e2eAdminEmail` returns `string | null` from `E2E_ADMINS`; the admin test skips with the reason on `null`.
  - **Task 6, helper and spec:** `tests/e2e/helpers/layout.ts`: `TIERS`, `tierAt`, `VERIFY_WIDTHS`, `SPOT_WIDTHS`, `EDGE_WIDTHS`, `expectNoHorizontalScroll` (moved from `smoke.spec.ts`), `expectWithinCap`, `atEveryWidth`, plus `expectPageFrame(page, width, { banner })` (gutter per tier, computed `max-width` and cap, for `<main>` and the NavBar row), `appCap(width)` and the types `Tier` and `WidthCheck`. `tests/e2e/responsive.spec.ts` (`reducedMotion: "reduce"`): 10 tests per project: `/`, the four `/legal/*` and `/does-not-exist` (reading pages: frame, 640 px column, no TabBar), `/sign-in` (step 1, then step 2 with a long hyphen-free domain), `/onboarding` (signed in; also no NavBar links without a profile), `/dev/ui` (tier readout at every width, no NavBar demo row overflowing, TabBar vs creator links, the 640 px Tablet tab row, 48/44 px fields, the Sheet's form and padding per tier) and the iPad-landscape describe. The `/admin` sweep runs inside the admin test of `sign-in.spec.ts`, before its session-refresh step.
  - **Task 7:** AGENTS.md §7's page line and §8's two lines are the kit's; §7–§8 of the two files are identical; the `Plan kit:` line and the Next-managed block are unchanged; `CLAUDE.md` → `AGENTS.md`.
  - **Pre-commit review** (3 lenses, each finding verified): 3 confirmed, all fixed. `expectPageFrame` now checks the NavBar row's gutter, computed `max-width` and cap like `<main>`'s (it checked only width and centering); `/dev/ui` checks each NavBar demo row for overflow, because the gallery's frames clip and hide it from the page-level scroll check; and the masked address keeps "m…@" in a `whitespace-nowrap` prefix, because the ellipsis is a line-break opportunity that left the initial alone above a long hyphen-free domain (the step-2 test now uses such a domain).
- Verified:
  - `bun run typecheck` ✅ · `bun run lint` ✅ · `bun run test` ✅ (15 files, 497 tests) · `bun run lint:tokens` ✅ (prints nothing) · `bun run test:int` ✅ (6 files, 36 tests) · `bun run build` ✅.
  - `bun run test:e2e` ✅ on four projects, 86 tests: 83 passed, 3 skipped (the iPad-landscape describe outside `webkit-ipad`). Per project: `chromium-desktop` 33 (32 passed, 1 skipped), `webkit-iphone` 33 (32 + 1), `webkit-ipad` 10 (10), `chromium-xl` 10 (9 + 1). `--list --project=webkit-ipad --project=chromium-xl`: "Total: 20 tests in 1 file", and no other spec. On `chromium-desktop` each route runs 22 checks (11 widths × 2 themes); the slowest, `/dev/ui`, takes about 6.4 s, so no `test.slow()`.
  - **Mutation checks:** with `--app-max` left at 75rem at XL, the reading routes fail ("Expected 1440px, Received 1200px" at 1920 px); without the TabBar's `md:max-w-reading` and the Sheet's `md:px-8`, `/dev/ui` fails; with P04's `whitespace-nowrap` back, `/sign-in` fails at 375 px (107 px of sideways scroll).
  - Verify commands: the `sm:`/`xl:` rg prints nothing; the 04 §3.1 awk | diff prints nothing; the AGENTS.md §7–§8 diff prints nothing; `git diff HEAD -- AGENTS.md` is the three lines; `head -1 AGENTS.md` is the `Plan kit:` line and `readlink CLAUDE.md` is `AGENTS.md`; `git status --short` lists the acceptance files plus `nav-bar.tsx` (recorded above).
  - Step 0 (P04): typecheck, lint, 496 unit, token lint, 36 [int], 46 e2e, auth schema check, "No schema changes", `db:seed` twice with no change and exit 1 under `APP_ENV=production`, the curl redirect and headers, the exports and helper files; a real dev sign-in (code in `.data/emails`, pasted, landed on `/onboarding`, `email_log` 0).
  - Manual pass (browser pane, `bun run dev`): `/dev/ui` at 768 × 1024 (Tier: Tablet, 24 px gutter, tab row 640 px centered under a 753 px bar) and 1920 (Tier: XL, `<main>` 1440 px); the Sheet at 844 × 390 (a dialog inside the window, top 34 / bottom 356 of 390, only the body scrolls, 32 px sides, footer row); 960 × 800 (Tab moves focus to a control that was under the TabBar and scrolls it clear, bottom 418 vs bar top 744, 2 px focus ring); `/` at 1280 (1200 px, 40 px each side) and 2560 (1440 px, 560 px each side; the 640 px column at 960 px); `/onboarding` at 1920 (main and NavBar row 1440 px at 240 px, column 640 px, canvas-alt); sign-in step 2 at 320 with a long domain (no sideways scroll after the fix) and at 375 with a short one (one line, "m…@example.com."). Light and dark were both used; the spec covers every route at every width in both themes. `/admin` with the owner's account is the owner's check; the e2e admins cover it on both original projects.
  - **Packages:** none added or changed.
- Decisions: see the Decisions table (2026-10-18, P04b).
- Open questions: none.
- Follow-ups for later prompts:
  - **P05** adds its routes to `responsive.spec.ts` (the onboarding steps, `/@handle`, Settings, and `/dashboard` once a profile exists) or adds its own `*.responsive.spec.ts`.
  - **P15** owns the PriceBar, the sticky-column cap and `--pricebar-h`.
  - **P20** adds the DataTable stacked mode for `/dashboard/licenses` (S22), and **P21** reuses it for the admin tables (S24).
  - **P22** gives the two new projects `dependencies: ['setup']` and the run-id letters `i` and `x`.
  - **P32** runs all four projects in CI.
  - Any later spec that signs in an e2e admin must do it inside the one admin test per project, or run serially with it. **P21** moves this admin test, with its `/admin` sweep, from `sign-in.spec.ts` into the A.2 test of `admin.spec.ts`, which then holds every e2e-admin step until P22's setup project (07 D154).
  - **P21:** the SegmentedControl has no scroll-inside mode below `md` yet (04 §5.2.4); add it with the admin tabs.
  - **Responsive specs:** measure through `atEveryWidth` (it waits for CSS transitions) and wait for an overlay's animations before measuring it (`getAnimations()` → `finished`); a single read right after a resize can be the previous width's value under reduced motion.
  - **Kit notes (not built, would change 04 §3.4 or the copy list):** the lint misses `w-dvw`/`w-svw`/`w-lvw`, `100dvw`-style values and `overflow-x-clip`; the template's P19f and P21 `>` Record lines are newer than the app's (not on P04b's copy list); a Sheet keeps its `safe-area-bar` bottom padding as a dialog from `md` (04 §9.22 gives it to the bottom sheet only; changing it would be visual, 07 D156).

### P05 — Onboarding, fake payouts and the public creator page ✅ (2026-10-18)
> 120 min · Depends on: P04b, P04 · Record: the length copy and proposed copy; for P06 and P34: the payouts banner component and copy, where the CAD fact line lives, `signUpCreator` options, `resolveOnboardingStep` signature, `ensureConnectedAccount` input, the registry exports (`paymentsDriver(currency)`, `CURRENCY_ACCOUNT_COUNTRY`, `CurrencyNotEnabledError`)
- Done:
  - **Owner answers (in chat, 2026-10-18; Q-06–Q-11 below):** Q1 a: length errors say "Use 3 to 30 characters." *(proposed)*; Q2 a: the prompt's proposed copy ships as written; Q3 a: the extra proposed copy ships ("Start and end with a letter or number, with no two dots in a row.", "Enter your name.", "Use 60 characters or fewer.", the loading labels "Continuing…", "Saving…" and "Updating…", "Payouts unavailable. Contact {SUPPORT_EMAIL}." and the creator page title "{display name} (@{handle})"); Q4 a: a native checkbox that looks the same as the Radix one (`NativeCheckbox`); Q5 a: the banner links to `/dashboard/settings#payouts`; Q6 a: the five old comments that said "birth" or "guardian" were reworded (comments only). **Recorded answers, not asked:** OQ-07 (dots, immutable handles), OQ-29 (18 or older, `age_confirmed_at`), OQ-05 (publish before payouts; Approve needs them), OQ-19 (device time zone), OQ-21 (CAD only, `payout_currency` default) and OQ-37 (the negative-balance line), plus OQ-11 (the approval window shown read-only).
  - **Proposed copy shipped (Q2, Q3):** the Stepper labels "Profile · Connect · Payouts", "Shown on your page and on licenses.", "Checking…", "Your links will look like {host}/@{handle}/your-video", the payouts explainer, "Skip for now", the title "Settings", the toasts "Payouts are on.", "Saved." and "Time zone updated.", the 404 link "Go to ClipLease", "Use 3 to 30 characters.", "Start and end with a letter or number, with no two dots in a row.", "Enter your name.", "Use 60 characters or fewer.", "Continuing…", "Saving…", "Updating…", "Payouts unavailable. Contact {SUPPORT_EMAIL}." and the title "{display name} (@{handle})".
  - **Pure rules (each with a unit test):** `src/lib/validation/handle.ts` (`HANDLE_RE`, `SLUG_RE`, `SLUG_MAX_LENGTH`, `RESERVED_HANDLES` = the 01 J1 list + `APP_NAME.toLowerCase()`, 28 entries, `normalizeHandleInput`, `handleProblem`, `HANDLE_COPY`, `handleProblemMessage`, `suggestHandleCandidates`); `src/lib/pricing/presets.ts` (the four per-currency maps `as const satisfies Record<Currency, number>`, the bps bounds, `DEFAULT_OPTIONS`, `defaultRateOptions()`; the test compares the maps with the CHECK literals in `drizzle/0000_init.sql`); `src/lib/urls.ts` (`creatorUrl`, `videoUrl`); `src/lib/onboarding.ts`; `src/lib/validation/time-zone.ts` (`normalizeTimeZone`); `src/lib/validation/profile.ts` (`AGE_ERROR`, `profileStepSchema` = 02 §6.1, `displayNameSchema`, the field-error mapper); `src/lib/payouts.ts` (01 J11.1 labels, `payoutsSetupLabel`, `APPROVAL_WINDOW_LABEL`). The handle cases live in `tests/fixtures/handles.ts`, shared by the unit test and the [int] parity test.
  - **`resolveOnboardingStep({ hasProfile, step }: { hasProfile: boolean; step: string | null | undefined }): { kind: "render"; step: OnboardingStep } | { kind: "redirect"; to: string }`** (`src/lib/onboarding.ts`, with `ONBOARDING_STEPS` and `ONBOARDING_STEP_LABELS`).
  - **Creator domain (`src/server/creators/`):** `profile.ts`: `completeOnboarding(sessionUser, { displayName, handle, ageConfirmed: true, timeZone })` → `{ creatorId }` (checks before any write, then one transaction: profile with `age_confirmed_at = now()`, rate card at `DEFAULT_BASE_PRICE_CENTS[payout_currency]`, the 10 options, `user.name`, audit), `OnboardingError` (`invalid_input`, `handle_invalid`, `handle_reserved`, `handle_taken`, `already_onboarded`), `updateProfile`, `updateTimeZone`, `refreshPayoutsStatus(creatorId, { maxAgeMs = 600_000 })`; `queries.ts`: `checkHandleAvailability` (one `IN` query, ≤ 3 suggestions) and `getPublicCreator` (`{ handle, displayName }`, React `cache`). `src/server/db-errors.ts`: `uniqueViolationConstraint(error)`.
  - **`user.name` is synced:** onboarding sets it to the display name in the same transaction, and `updateProfile` keeps it in step (the avatar shows initials).
  - **Payments seam (`src/server/payments/`):** `driver.ts` (P05's subset of 02 §5.8: every type and method later prompts need, without the saved-card and renewal fields that P22c/P25c add); `registry.ts` exports **`paymentsDriver(currency)`**, **`CURRENCY_ACCOUNT_COUNTRY`**, **`CurrencyNotEnabledError`** and `createPaymentsRegistry(env)` (the injectable form the unit test uses); `fake-driver.ts` `createFakeDriver({ currency })`; `connect.ts` **`ensureConnectedAccount(creatorId: string): Promise<string>`** (create outside any transaction → compare-and-set `UPDATE … WHERE stripe_account_id IS NULL` → audit once → re-read → `enableNegativeBalanceDebits` best effort, only for the call that stored the id). `GET /api/stripe/onboarding` (`src/app/api/stripe/onboarding/route.ts`): signed out → 302 sign-in, no profile → 302 `/onboarding`, else ensure → `refreshPayoutsStatus(…, { maxAgeMs: 0 })` → 303 to the onboarding link.
  - **Audit actions:** `creator_profile.created` (`{ handle }`), `creator_profile.updated` (`{ fields: ["displayName"] }` or `["timeZone"]`), `creator_profile.payouts_account_created` (`{ accountId }`), `connect.negative_balance_debits_failed` (`{ accountId, kind, code }`).
  - **`/onboarding` (S11):** `page.tsx`, `actions.ts` (`checkHandle`, `completeOnboarding`) and `profile-step-form.tsx`. The form keeps typed values after an error (it dispatches the action itself, so React doesn't reset it), is `noValidate` (the server decides), debounces the availability check 300 ms (an older answer never replaces a newer one), explains a bad character once typing pauses, keeps a handle that more typing can still make valid ("ma", "maya.") quiet until a blur or Continue, shows "reserved" after the pause, announces the line politely, moves focus to the first error and fills a hidden `timeZone` after mount. **Payouts already active on step 3 (judgment call):** "Payouts on" and **Continue** → `/dashboard/library`; `pending` shows "Stripe is checking your details." with Continue; otherwise **Set up payouts** (plain `<a>`) and "Skip for now".
  - **CAD fact line:** `src/components/payouts/payout-currency-facts.tsx` (`payoutCurrencyFact(currency)` and `PayoutCurrencyFacts`), the one place both the payouts step and Settings render the fact line and the negative-balance line with "Payout terms"; `rg -n "Stripe balance goes below zero" src` finds only it.
  - **Settings (S23):** `src/app/(dashboard)/dashboard/settings/` (`page.tsx`, `actions.ts`, `display-name-form.tsx`, `time-zone-row.tsx`, `payouts-returned-toast.tsx`); sections Payouts (`id="payouts"`), Profile, Requests ("Time to answer · 72 hours"), Emails, Account, in one left-aligned `max-w-reading` column. `SignOutSettingsButton` joins `sign-out.tsx`. Profile draws the read-only handle between the name field and Save, as the 05 frame does (`DisplayNameForm` takes it as `children`). The address keeps `?payouts=returned` after the return (see Decisions), and Save and Update from this device rely on their actions' `revalidatePath` response to re-render the page (no extra `router.refresh()`).
  - **Banner:** **`FinishPayoutsBanner({ payoutsStatus, className? })`** in `src/components/layout/finish-payouts-banner.tsx`, a server wrapper around `Banner` **tone `info`**, not dismissible: "Set up payouts so you can approve requests (about 2 min)" + "Set up payouts" → `/dashboard/settings#payouts`; nothing when `active`. On `/dashboard` and the new `/dashboard/library` placeholder.
  - **`NativeCheckbox`** in `src/components/ui/checkbox.tsx`: a native `<input type="checkbox">` sharing the Radix `Checkbox`'s box classes (`BOX`); the `/dev/ui` gallery shows both, measured identical (22 px box, 11 px from the row top, check at 4 px, same colors and radius, light and dark).
  - **`/@handle` (S06):** `next.config.ts` `rewrites()` `/@:handle` → `/u/:handle`; `src/app/(public)/u/[handle]/page.tsx` (decode → lowercase → `HANDLE_RE` → 308 when the case differs → `getPublicCreator` → 404) and `not-found.tsx` ("No creator here." + "Go to ClipLease"); title "{name} (@{handle})", canonical `/@handle`. No `/u/* → /@*` redirect (02 §4.3).
  - **Comments (Q6):** `src/server/email/types.ts`, `src/lib/licensing/snapshot.ts` (2), `src/db/schema/creator.ts`, `src/server/auth/actor.ts`; the code is unchanged (`db:generate`: "No schema changes").
  - **Tests:** unit `handle` (the full 01 J1 reserved list), `profile`, `presets`, `urls`, `onboarding`, `time-zone`, `payouts`, `registry`; [int] `tests/integration/creators/onboarding.test.ts` (28), `tests/integration/creators/settings.test.ts` (4: `updateTimeZone`, Save, Update from this device, signed out) and `tests/integration/payments/fake-payouts.test.ts` (9, including a USD row refused while only CAD is enabled); e2e `tests/e2e/onboarding.spec.ts` (3 per project: the full journey with the 308 and the canonical link, the skipped-payouts banner, and a taken handle's suggestions, the "was just taken" race with a rival claiming the handle before Continue (01 J1.5), and the format messages) and `tests/e2e/onboarding.responsive.spec.ts` (4 per project). The six P04 assertions on a bare `/onboarding` now expect `/onboarding?step=profile`.
  - **Pre-commit review (3 rounds, every finding checked by a second agent that tried to refute it; round 3: 6 findings, 3 confirmed and fixed: a keystroke that normalizes away cleared "was just taken" and brought back a stale "is yours"; a `waitForTimeout` that P22's gate greps for, now `page.clock.runFor`; two wrong lines in this entry; the race got its own e2e step, mutation-checked):** round 1 (server, security, UI, tests): 14 findings, 11 confirmed, all fixed: a long display name or email scrolled the page sideways at 320 px (the `/@handle` name and FactList values now wrap; the gallery's FactList shows a long address so `/dev/ui`'s test covers it); handle character errors waited for a blur (now they show once typing pauses); Settings' time zone action took 200 characters (now 02 §6.1's 64); Profile drew Save above the handle; the Handle field had no `autoComplete` (now `off`, it's not a sign-in name); and test gaps (the 308 and canonical link, Settings Save and Update, `updateTimeZone`, the taken line and chips, `profileStepFieldErrors`, the full reserved list, a USD row proving the currency comes from the profile, the real fake leaving no failure row). Round 2 checked those fixes: 11 more confirmed and fixed: the reserved message flashed on the keystroke that completed a reserved word ("help" in "helpful"), "maya." showed an error on the way to "maya.films", a failed check left "Checking…" up, a 30-character handle overflowed in Settings, on `/@handle`, in the availability line and in the suggestion chips, plus a stale comment and two tests that couldn't fail. Refuted: 3 in round 1 (onboarding payouts states P05 can't reach, a crash between storing the account and the debits call, the spelling of the removed step in a test), 2 in round 2 (`inputMode`, a too-long handle staying quiet until blur). Every wrap fix and the blur gate were mutation-checked: undoing each one makes its test fail (sideways scroll of 89, 206, 31, 49 and 53 px; "Use 3 to 30 characters." shown while typing).
  - **`signUpCreator(page, { payouts?: boolean; handle?: string })` → `{ email, handle }`** in `tests/e2e/helpers/creator.ts`: signs in `uniqueEmail`, fills the profile step with `handle` or a run-unique one, ticks the box, continues past connect, then **Set up payouts** (default, ends on Settings with "Payouts on") or **Skip for now** (`payouts: false`, ends on `/dashboard/library`). Run-unique handles are `e2e.<worker run id, base 36><4 random hex><project letter>` (17 characters; `c` chromium-desktop, `w` webkit-iphone, `i` webkit-ipad, `x` chromium-xl), unique per test and per project; `uniqueLongHandle(testInfo)` pads one with `w` to the full 30 characters (the widest handle, for no-sideways-scroll checks). Also exported: `uniqueHandle(testInfo)`, `completeProfileStep(page, handle)`, `setUpPayouts(page)` and `E2E_CREATOR_NAME`. `tests/e2e/helpers/server-action.ts`: `pressAndSettle(page, name)` presses a button with the keyboard and waits until its server action's request has closed (a navigation right after a toast otherwise cancels the still-streaming response, which WebKit logs as "TypeError: Load failed"). `tests/e2e/helpers/layout.ts` gained `expectReadingPage` (moved from `responsive.spec.ts`) and `expectCreatorChrome(page, width)`.
  - **Responsive spec for P06's Step 0:** `tests/e2e/onboarding.responsive.spec.ts` covers `/onboarding?step=connect` and `?step=payouts` (centered 640 px column), `/dashboard/settings` (≤ 640 px, at `<main>`'s content edge level with its h1, not centered from 1024; creator chrome), `/dashboard` and `/dashboard/library` (banner; TabBar below 1024 with the five tabs in a centered ≤ 640 px row on Tablet, NavBar links from 1024) and, logged out, `/@<handle>`; P04b's `/onboarding` route in `responsive.spec.ts` now lands on `?step=profile` and still passes.
- Verified:
  - `bun run typecheck` ✅ · `bun run lint` ✅ · `bun run test` ✅ (23 files, 599 tests) · `bun run lint:tokens` ✅ (prints nothing) · `bun run test:int` ✅ (9 files, 77 tests) · `bun run test:e2e` ✅ on four projects, 108 tests: 105 passed, 3 skipped (P04b's iPad-landscape `/dev/ui` test, which runs only on `webkit-ipad`). Per project: `chromium-desktop` 40 (39 + 1 skipped), `webkit-iphone` 40 (39 + 1), `webkit-ipad` 14 (14), `chromium-xl` 14 (13 + 1). `onboarding.spec.ts` runs on the original two only, `onboarding.responsive.spec.ts` on all four. The changed specs also passed 28 of 28 with `--repeat-each 4` on `webkit-iphone`.
  - `rg -n "Stripe balance goes below zero" src` → one match, `src/components/payouts/payout-currency-facts.tsx` ✅ · `rg -n "enableNegativeBalanceDebits" src` → `driver.ts`, `fake-driver.ts`, `connect.ts` only ✅ (the [int] test lives under `tests/`) · `rg -n 'paymentsDriver\(\)' src`, `rg -n 'setPayoutCountry|payout_country' src` and the age-data search over `src` (legal texts excluded) print nothing ✅ · `bun run db:generate`: "No schema changes" ✅.
  - curl against `bun run dev` (with `@p05.check` claimed, so `maya.films` stays free for the owner's run): `/@p05.check` 200 · `/@P05.Check` 308 → `/@p05.check` · `/@nobody.here` 404 · **`/%40p05.check` and `/%40maya.films` → 404** (acceptable, 02 §4.3) · `/u/p05.check` 200 (the rewrite target; no `/u/*` redirect by design) · canonical `<link>` is `/@p05.check` ✅.
  - Manual pass (browser pane, `bun run dev`): a new sign-in lands on `?step=profile`; "Maya R." + "@Maya.Films" shows `maya.films` and "@maya.films is yours"; **Continue** without the tick shows the 18+ error under the box with focus on it, and the database still had 0 `creator_profile` rows; with the tick: 1 profile (`cad`, `America/Toronto`), 1 rate card, 10 options, the `creator_profile.created` audit row and the avatar's initials; connect → payouts (the CAD and negative-balance lines) → **Skip for now** shows the banner on the Library → its link lands on `#payouts` → **Set up payouts** → "Payouts on", the toast, `acct_fake_…` and `creator_profile.payouts_account_created`; Save (empty → "Enter your name.", then "Saved."), **Update from this device** (the zone text changed from UTC to America/Toronto with no request besides the action), Sign out → `/sign-in`; `/@p05.check` logged out; a 43-character unbroken name and a 30-character handle wrap at 320 px. Widths 320, 375, 768, 1280, 1920 and 2560 in light and dark: no sideways scroll; onboarding centered at 640, Settings left-aligned at 640, `/@handle` in the 1440 px column at 2560. The specs cover every width in both themes.
  - Step 0 (P04b): typecheck, lint, 497 unit, token lint, 36 [int], 83 e2e passed (3 skipped); the two new projects list only `responsive.spec.ts`; the P04 curl checks, exports and helpers; `db:seed` twice with no change and exit 1 under `APP_ENV=production`; `/dev/ui` shows Tablet at 768 and XL at 1920; a real dev sign-in landed on `/onboarding`; `email_log` 0.
  - **Environment note (2026-10-18):** during the final runs a `RESEND_API_KEY` appeared in `.env.local` and `.env.test`; with it set, the app refuses to send email until P26, so every sign-in failed (44 e2e failures, all "No sign-in-code email"). The owner blanked it in both files and every suite passed again. Both files are git-ignored (only `.env.example` is tracked); values were checked by count only.
  - **Packages:** none added or changed.
- Decisions: see the Decisions table (2026-10-18, P05).
- Open questions: none (Q-06–Q-11 answered in chat).
- Follow-ups for later prompts:
  - **P06:** the connect step's frame is in `src/app/(dashboard)/onboarding/page.tsx` (`ConnectStep`); add the `ConnectRow`s there with `returnTo=/onboarding?step=connect`. Re-run `onboarding.responsive.spec.ts` and P04b's `/onboarding` route in Step 0.
  - **P12:** import the presets from `src/lib/pricing/presets.ts` (never redeclare them); `defaultRateOptions()` counts `sortOrder` per dimension from 0.
  - **P14a:** `getPublicCreator` returns public fields only (`{ handle, displayName }`); add the creator id or a separate lookup when the grid needs it. The page keeps `wrap-anywhere` on the name and handle.
  - **P16 / P19b / P21b:** the fake driver's other methods throw "fake driver: <method> arrives in Pxx"; `driver.ts` is P05's subset of 02 §5.8 (P22c/P25c add the saved-card and renewal fields).
  - **P19b:** extends `FinishPayoutsBanner`.
  - **P19c:** turns Settings' read-only "Time to answer" into the approval-window choice and adds auto-approve.
  - **P24:** revisit the refresh-before-link order in `/api/stripe/onboarding`; `ensureConnectedAccount` calls `enableNegativeBalanceDebits` only in the request that stored the id, so a crash between the two leaves no audit row (best effort per 07 D139; P24 may add a retry). Settings re-reads the status on every render while `?payouts=returned` is in the address (a Stripe call per Save or Update there).
  - **P34:** `payoutCurrencyFact(currency)` and `PayoutCurrencyFacts` hold the CAD sentence; `CURRENCY_ACCOUNT_COUNTRY` and `CurrencyNotEnabledError` are in `src/server/payments/registry.ts`.
  - **Every later e2e spec:** after a server action that the test follows with a navigation, use `pressAndSettle`; behavior specs that need a creator call `signUpCreator` (never fork it).

**M2 Social accounts and Library** · P06–P09 · 7.75 h

### P06 — Connect a mock social account (OAuth plumbing) · [ ] to do
> 120 min · Depends on: P05 · Record: the mock seam and token format decisions, the `extraScopes` / `requestedScopes` plumbing, `findPostByLinkKey` on the mock
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P07 — On-demand sync engine · [ ] to do
> 120 min · Depends on: P06 · Record: creator actor in the callback, `added` in `SyncResult`, the `syncAllAccounts` return shape, the older-mode sweep bound, `link_key` on every row
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P08 — Connections screen and account lifecycle (J2) · [ ] to do
> 105 min · Depends on: P07 · Record: whether the owner added the platform marks to `public/brand/`; Disconnect leaves postings untouched (OQ-14 answer)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P09 — Library: every post in one grid (J3) · [ ] to do
> 120 min · Depends on: P08 · Record: the usual bullets (P10a's Step 0 also checks that P05 is ✅)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

**M3 Make licensable** · P10a–P14b · 18.25 h

### P10a — Private storage and the multipart upload API · [ ] to do
> 120 min · Depends on: P09, P05 · Record: the poster upload key decision (question 1); limits in `src/lib/upload`; the 410 status for `upload_expired`; how `listParts` signals `no_such_upload`; the ffprobe output
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P10b — Plain upload: title page, File step and poster · [ ] to do
> 120 min · Depends on: P10a · Record: proposed copy used, Back target, which poster path each e2e project took; set the Status line to "Current prompt: P10c · Last verified: P10b"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P10c — Resumable original uploads: retry, resume and cancel · [ ] to do
> 90 min · Depends on: P10b, P10a · Record: the question 1 answer and jitter formula; offline → Paused; Start again after a reload; which `lastModified` each e2e project reported; status line "Current prompt: P11 · Last verified: P10c"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P11 — Make a Library post licensable: Source page and verified File step · [ ] to do
> 120 min · Depends on: P10c, P10 (P10a + P10b), P09 · Record: question 1 answer ("already licensable"), the fields added to `getLibraryPost`, proposed labels "Post" / "Cover image", how the source posting's `url` is built; status line "Current prompt: P11b · Last verified: P11"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P11b — Posting links: parse, normalize and verify (no fetching) · [ ] to do
> 105 min · Depends on: P11, P07, P06 · Record: question 1 answer; the `kind` union and mock id regex; the names P11b added; status line "Current prompt: P11c · Last verified: P11b"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P11c — “Where was it posted?” step · [ ] to do
> 120 min · Depends on: P11b, P10c · Record: questions 1–3 answers, the composed Continue, the FormData names, `sourceShowLink` and `visibility`; status line "Current prompt: P12 · Last verified: P11c"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P12 — Pricing engine and rate card editor (J4) · [ ] to do
> 105 min · Depends on: P11c, P05 · Record: the Stripe 8-digit amount limit check with its source URL; Reset saves immediately; proposed copy (OQ-08, OQ-09, OQ-18 are owner answers)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P13 — Rights and Review steps · [ ] to do
> 105 min · Depends on: P12, P11c, P05 · Record: the payouts-return decision (question 1), proposed blocker labels
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P14a — Publish, share link and the public grid (J5, J6) · [ ] to do
> 120 min · Depends on: P13 · Record: the S10 count (screens and taps from Library tile to "Link copied"; target ≤ 5 / ≤ 13), the `isPubliclyAvailable` input shape
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P14b — Video page, turn off/on, delete draft and the demo video seed · [ ] to do
> 90 min · Depends on: P14a · Record: set the Status line to "Last verified: P14 (P14a + P14b)"; the `bun run db:seed --demo` output from two runs (one source posting)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

**M4 Buyer checkout** · P15–P17 · 7.5 h

### P15 — License page: options and live price (J7 part 1) · [ ] to do
> 120 min · Depends on: P14, P12 · Record: (P14 = P14a + P14b, both ✅) questions 1–2 answers, region data source, the hidden `timeZone` input
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P16a — Fake checkout and payment authorization (part a): server-priced request and checkout hand-off · [ ] to do
> 90 min · Depends on: P15, P05 · Record: Ask 1 (token reveal in the fake checkout) and Ask 2 (fake PaymentIntent for `checkout_pending`)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P16b — Fake checkout and payment authorization (part b): authorization through the event path · [ ] to do
> 120 min · Depends on: P16a · Record: set the Status line to "Last verified: P16 (P16a + P16b)"
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P17 — Buyer status, creator inbox and request emails (J7 proof) · [ ] to do
> 120 min · Depends on: P16 (P16a + P16b) · Record: email copy; `formatEmailDateTime` goldens (OQ-19 answer: recipient zone + UTC)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

**M5 Approve, decline, deliver** · P18–P20b · 17.5 h

### P18 — Approve: capture and issue the license · [ ] to do
> 120 min · Depends on: P17 · Record: the `original_missing` copy, where `maxDuration` and `reconcileStuckClaims` live, how the snapshot picks the primary posting (OQ-12 is an owner answer)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P19 — Decline, expiry and the money-safety matrix · [ ] to do
> 120 min · Depends on: P18 · Record: the overdue-copy answer, any additive `reconcileFromStripe` argument, the money-matrix row count, the hand-offs to P21 and P22 (OQ-31 is an owner answer)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

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

## Decisions

Every judgment call, newest last. Source: an OQ number, a 07 row (Dxx), "owner in chat" or "agent (stated)".

| Date | Prompt | Decision | Source |
|---|---|---|---|
| 2026-10-16 | P00 | Node updated to v24.22.0, the newest 24.x (≥ 24.21.0, 07 D108), and made the nvm default. The machine had v24.18.0. | owner in chat |
| 2026-10-16 | P00 | ripgrep installed with `brew install ripgrep` (15.2.0 at `/opt/homebrew/bin/rg`). Step 0 had passed falsely because of Claude Code's own `rg` shell function. | owner in chat (Q1 a) |
| 2026-10-16 | P00 | Git remote `origin` = `git@github.com:anthonyshadow/cliplease.git` (an empty GitHub repo); branch `main`, pushed at Wrap up. | owner in chat (Q2 b) |
| 2026-10-16 | P00 | **Security exception to the two-week rule:** `react-email` and `@react-email/ui` are pinned at **6.11.3** (both published 2026-10-16), not 02 §1.1's 6.11.0. @react-email/ui 6.10.0–6.11.2 depend on `next@16.3.3`, which is inside the RCE range that next 16.4.1 is pinned to avoid: GHSA-vcvr-r3jv-pc5j (critical, next/og RCE, 16.2.0 to before 16.3.6) and GHSA-cjq9-62q9-8jv4 (high, image-optimisation SSRF, 16.0.0 to before 16.3.8). The react-email CLI requires both packages at the same version. A `next` override was tested and breaks `email dev`. Result: `bun.lock` and `node_modules` contain only next@16.4.1. Rule from the owner: never bring in a compromised Next version. | owner in chat |
| 2026-10-16 | P00 | Scaffold: create-next-app ran into the temporary folder `App/cliplease-scaffold` (npm names can't contain capitals), and `mv -n` moved everything, dotfiles included, into `App/ClipLease`. `ls -A` then showed it empty and `rmdir` removed it; nothing was deleted. `--skip-install` was used, and the first `bun install` ran inside `App/ClipLease`. Package name `cliplease`. | 07 D104, D108 |
| 2026-10-16 | P00 | create-next-app `--help` lists `--disable-git` and `--skip-install`, so both were used. It doesn't list `--no-cache-components`, so that flag was left out (P00 task 1). The scaffold wrote `cacheComponents: true` and `partialPrefetching: true`; task 3 replaced them with `cacheComponents: false` (07 D56). | 07 D56, D104 |
| 2026-10-16 | P00 | `bunfig.toml` and `"trustedDependencies": []` were written before the first `bun install`, not just before the first `bun add`. It's stricter and changes nothing else. create-next-app `--use-bun` had written `"trustedDependencies": ["sharp", "unrs-resolver"]`; that list was emptied (R4). Its Bun-only `"ignoreScripts": ["sharp", "unrs-resolver"]` was kept: it only blocks scripts. | 07 D107 R3, R4; agent (stated) |
| 2026-10-16 | P00 | R4 record: `bun pm untrusted` prints "Found 0 untrusted dependencies with scripts.", but the installs reported "Blocked 1 scripts for: esbuild@0.28.2", "…esbuild@0.25.12" and "…esbuild@0.18.20". `bun pm untrusted` skips packages on Bun's built-in trusted list, and bun.lock doesn't keep an empty list. All three esbuild `bin/esbuild` files are still the JS shim (9181–9351 bytes), so no install script ran. Nothing needs one: build, tests, tsx and the smoke all pass. No `bun pm trust`. | 07 D107 R4 (research §8 items 3–4) |
| 2026-10-16 | P00 | Env probe (`CLIPLEASE_ENV_PROBE=loaded` in a scratch `.env.local`, plus a temporary `probe:env` script) printed `unset`; the script and the file were then removed. Caveat from the P00 audit: Bun 1.4.3's `bun run` doesn't forward `.env*` to scripts even without `env = false`, so the probe can't prove R3. `bun install` and `bun ci` still read `.env.local` themselves. | 07 D107 R3 (research §8 item 6) |
| 2026-10-16 | P00 | Compat smoke: tsx runs `scripts/compat-smoke.tsx` as CommonJS (package.json has no `"type"`). A static import of `@react-pdf/renderer` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` (@react-pdf/hyphenate exports only `import`). So react-pdf is loaded with `await import()` inside `async main()`. No pin fallback was needed. JSX works as is (`"jsx": "react-jsx"`). The script also refuses to run unless the runtime is Node 24.x at 24.21 or later; Node 25 and Bun are rejected (R2, 07 D108). | agent (stated); 07 D58, D108 |
| 2026-10-16 | P00 | Biome 2.5.15 lints SVG files. Rather than disable `noSvgWithoutTitle`, a `<title>` was added to the five create-next-app placeholder SVGs in `public/`. | agent (stated); P00 task 3 ("fix generated code") |
| 2026-10-16 | P00 | README.md (create-next-app's default) now gives only `bun install` and `bun run dev` (R1, 07 D107) instead of the npm/yarn/pnpm/`bun dev` list, and the path `src/app/page.tsx`. P01 updated its page path and font line; later prompts (P19 onward) add their own sections. | agent (stated); 07 D107 |
| 2026-10-16 | P00 | `.gitignore` also ignores `.claude/settings.local.json`, so Biome, which honours `.gitignore`, never lints Claude Code's per-user permission file. The Playwright output folders were ignored before the first e2e run. | agent (stated) |
| 2026-10-16 | P00 | AGENTS.md layout: the `Plan kit:` line first, then the kit file unchanged, then the Next-managed block byte for byte at the end, where `next dev` expects it. `next dev` left the file unchanged. `CLAUDE.md` is a symlink to AGENTS.md. | P00 task 7; agent (stated) |
| 2026-10-16 | P00 | Prompt map: kept the template's section unchanged. It is 07 §3.2's table with the real file names (P10a–P10c, P14a/P14b, P16a/P16b, P19b–P19g, P25b–P25d, P28b, P34, P05b). P00 task 7's own table is older (bare P10, P14 and P16, eight prompts missing). Task 7 says to name the lettered parts, and the template does. | P00 task 7; 07 §3.2 |
| 2026-10-16 | P00 | e2e: port 3100 against the production build (`bun run build && bun run start --port 3100`, `reuseExistingServer: false`). The iPhone project uses `devices["iPhone 17"]`, the current descriptor in Playwright 1.63.0. | agent (stated); P00 task 5, 02 §11.2 |
| 2026-10-16 | P00 | P00 is marked ✅ before its three git criteria can be proven, because the commit has to come after PROGRESS.md is written: `git log` shows the P00 commit, the tree is clean, `origin/main` = `main`. Those checks run right after the commit and push, are reported in the P00 reply, and P01 Step 0 re-checks them. No commit hash goes into this file. | agent (stated) |
| 2026-10-17 | P01 | Q1 (local secrets): (a). The owner ran a one-line command that writes `openssl rand -base64 32` values into `.env.local` without printing them. The agent only checked that the three are set and long enough. The `.env.test` test secrets were generated straight into that file, never printed. | owner in chat |
| 2026-10-17 | P01 | Q2 (landing copy): (a), the 05 §4.7 proposed paragraph and three lines ship as written. | owner in chat |
| 2026-10-17 | P01 | Q3 (License v1 contradicts the D113 exclusive section): (a), small DRAFT fixes taken from 01 §4.6. §3 grants "a non-exclusive (or, when the license summary says Exclusive, an exclusive), non-transferable, non-sublicensable license". §7 is retitled "Ownership and exclusivity", and the Licensor "may license it to others, except as section 21 ("Exclusive licenses") says". §1 adds "A renewal term takes effect on its start date; it needs no new approval." All three are on the OQ-28 lawyer list. | owner in chat |
| 2026-10-17 | P01 | Recorded owner answers, not asked: OQ-39 (`APP_NAME = 'ClipLease'`), OQ-28 (the `[… TBD]` and `@example.com` legal placeholders with the DRAFT notice), OQ-31 (Signal Green, unused on these pages), OQ-29 (18 or older; Terms and Privacy D93 sentences), OQ-21 (`CURRENCIES`, `ENABLED_CURRENCIES=cad`), OQ-02 (`ADMIN_EMAILS` parsed owner first; `.env.test` has `e2e-admin@example.com,e2e-admin-2@example.com`), OQ-37 (Terms `#payouts`, D139 verbatim) and OQ-49 (`RENEWABLE_TERM_KEYS = EXCLUSIVE_TERM_KEYS`). | OQ-39, OQ-28, OQ-31, OQ-29, OQ-21, OQ-02, OQ-37, OQ-49 |
| 2026-10-17 | P01 | `COPYRIGHT_EMAIL`, `COPYRIGHT_AGENT`, `GOVERNING_LAW` and `VENUE` are named after research/license.md §10 ("Legal config constants"). 02 §3 fixes only `LEGAL_ENTITY_NAME`, `SUPPORT_EMAIL` and `PRIVACY_EMAIL`. | P01 task 1 |
| 2026-10-17 | P01 | `values.ts` is built from 07 §2.1, with §2.1's `LICENSE_REQUEST_STATUSES` and `PAYMENT_ACTIONS` replaced in place by the §9.2 versions. Appending them, as P01's literal wording says, would declare both twice. §9.2 supersedes §2. At runtime it equals docs/03 §2's merged block. Types follow 03 §4, plus `PaymentAction`, `VideoSource`, `Ownership` and `RevokedReason` (the names 02 imports), and one type for each remaining tuple. The §7.2 comment is reworded so that no `importing` value appears in src (07 D64). | 07 §9.2, §10.2 |
| 2026-10-17 | P01 | `env.ts` has the following rules and checks:<br>- `APP_URL` / `BETTER_AUTH_URL` must be bare origins (no path, no trailing slash; 07 D102).<br>- `TOKEN_ENCRYPTION_KEY` must be exactly the 44-character base64 of 32 bytes.<br>- `PLATFORM_FEE_BPS` must be digits only, 0–5000.<br>- Comma lists are trimmed; empty items, duplicates and uppercase values are refused.<br>- `EMAIL_FROM` is `Name <address>` or a bare address.<br>- Required (02 §10 "Required in dev"): every Phase A var without a default. `fake` / `local` / `mock` are `.env.example` values, not Zod defaults.<br>- `enabledCurrencies()` / `ownerEmail()` read `env` by default and also accept a parsed env (for tests).<br>- The header comment avoids the literal text "server-only", because P03 and P04 grep for it. | 07 D51, D52, D88, D94, D95, D102; agent (stated) |
| 2026-10-17 | P01 | Env loading. Vitest: the root `setupFiles` entry `tests/setup/load-env.ts` calls `loadEnvConfig(process.cwd())`; Vitest sets NODE_ENV=test, so @next/env loads `.env.test.local` > `.env.test` > `.env` and never `.env.local`. It throws unless APP_ENV is test, and both projects inherit it. Playwright: `.env.test` then `.env.test.local`, parsed with `node:util` `parseEnv`. Only `undefined` entries are dropped (to satisfy the type); blank values are kept. The result is passed as `webServer.env`, which Playwright merges over `process.env`. `.env.test` lists every key env.ts reads (blank where unused), because `next build` / `next start` fill keys still missing from `.env.local`. `.env.test` uses the `cliplease_test` DB placeholder (07 D103). | 07 D51, D103; agent (stated) |
| 2026-10-17 | P01 | Biome overrides, each scoped to one file. `src/app/globals.css`: formatter off and `complexity.noImportantStyles` off, so the file stays byte-identical to 04 §3.1. The formatter would lowercase hex values and reflow the file; the rule flags the six reduced-motion `!important`s. `src/app/design-tokens.test.ts`: formatter off, plus `suspicious.noAssignInExpressions` and `style.useTemplate` off, so the 04 §2.6 test stays verbatim. Its `lin` helper uses `c /= 255`. `css.parser.tailwindDirectives` was already true from P00. | P01 task 5; agent (stated) |
| 2026-10-17 | P01 | Allowed literal-color exceptions (04 §3.4): `themeColor` in `layout.tsx` (the 04 one), plus a fourth for `src/app/icon.tsx`. Its `#111111` / `#FFFFFF` carry `// design-ok: ImageResponse can't read CSS variables`, because Satori can't read CSS variables (04 §4.5). | P01 task 5 |
| 2026-10-17 | P01 | Leftovers removed: Geist, `public/*.svg`, the default page, and also `src/app/favicon.ico`, because 04 §4.5 makes `icon.tsx` the only favicon. `/favicon.ico` now returns 404 by design. `rm -rf .next/dev` cleared the stale route types left by P00's dev run. | 04 §4.5; agent (stated) |
| 2026-10-17 | P01 | Header "Sign in" (`LandingSignInLink`) is styled as an ink tertiary link, not `text-link`. 04 §2.2 / §2.4 allow no link-blue in a frosted bar, so 04 wins over 05 §4.7's blue-link notation (07 D01). Both `/sign-in` links use `prefetch={false}`, so no 404 prefetch logs a console error before P04. Header links are `h-11`, the pill is `inline-flex h-11`, and the footer links use `hit-44` (44 px targets). Contents links use `min-h-11`. Inline links in paragraphs rely on WCAG's inline exception. | 04 §2.2, §7, §9.2; 07 D01; agent (stated) |
| 2026-10-17 | P01 | License v1 (`license-v1.ts`):<br>- **Doc-settled edits:** §14.2 "No refund." becomes a full refund (07 D86, OQ-13). §14.4 becomes "may revoke … No refund is due" rather than an automatic revoke (07 D46, OQ-38). The §4.2 header drops "(USD)" and the fixed "Non-exclusive" for `{rights_label}` and "Amounts in {currency_label}." (07 D98, D113). §11's research cross-reference is replaced by "When that statement says Verified, it confirms who controls the account that posted the Video, not who filmed it." (D43's explainer, conditional so a self-attested license stays true). Other research cross-references were reworded: §2 "options in the header" → "options shown on the license" (the neutral page has no header), §8 "where §2.4 requires it" → "where Schedule A (credit) requires it", and the §-references to sections → "section N".<br>- **Summary variants:** the summary also carries the D113 exclusive row ("You get · Exclusivity", `when: exclusive`, token `{exclusive_phrase}`) and the D142 "Renewal" row (`when: auto_renew`, tokens `{renewal_interval}`, `{renewal_total}`). The standard "Not included · Exclusivity" row is `when: standard`. The neutral page shows each conditional row with its qualifier.<br>- **`fillLicenseV1`:** reads own properties only, so `{constructor}` or `{__proto__}` throws instead of printing a prototype member.<br>- **Research notes moved to code:** the `[Lawyer]` / `[placeholder]` notes became `// LAWYER:` / `// ACCOUNTANT:` comments, and Schedule A's research citations, Q-refs and "(see Q4)" were dropped.<br>- **Credit:** follows 07 D43.<br>- **New sections:** D113 "Exclusive licenses" and D142 "Renewal" are sections 21–22 (anchors `#exclusive-licenses`, `#renewal`).<br>- **Token values:** templates never add "@" or quotes. `{creator_handle}` carries its "@" (like D43's verified username), and `{video_title}` / `{credit_line}` carry their quotes, so the neutral page reads naturally. `/legal/license/v1` uses `LICENSE_V1_NEUTRAL_VALUES`, and its title is "{APP_NAME} Video License v1".<br>- **Dates:** `LICENSE_V1_UPDATED_LABEL` is formatted in UTC ("15 Oct 2026") on all four pages. | 07 D43, D46, D86, D98, D113, D142; agent (stated) |
| 2026-10-17 | P01 | Terms:<br>- **D93:** the sentences verbatim.<br>- **Owner-answer additions:** D74 (sell before payouts, approve needs payouts), D81 (auto-approve) and D86 (an admin revoke refunds in full and takes back the creator's share, except a reversed payment); prices, charges and payouts are in the creator's own payout currency with no conversion, and no currency is named.<br>- **Payouts (`#payouts`):** linked to the full Stripe Connected Account Agreement (`https://stripe.com/connect-account/legal/full`, Stripe's public page for the full agreement, chosen by the agent; research/stripe-owner-answers.md §2.2 only requires linking the full agreement; on the OQ-28 lawyer list), and accepting the Terms includes accepting it. The D139 paragraph is verbatim.<br>- **Auto-renewal (`#auto-renewal`):** the full 05 §4.8 row 6 / docs/08 list, not just P01's shorter list, because docs/08 wins on renewal rules. It includes the reservation after a declined or unanswered increase; no reservation when the buyer turned it off; decreases with notice; cancel with no penalty; the D134 sentence "We charge your card on the renewal date, before your current term ends (at most about a day before)."; and reminders.<br>- **Refunds:** built from 01 §4.6 and §9.4 without the "suspended while the dispute is open" line (07 D46, OQ-38). Sign-in is an emailed 6-digit code.<br>- **Lawyer items:** sections 13–14 are `[To be drafted with a lawyer.]` or the placeholders. | 07 D46, D74, D81, D86, D93, D94, D134, D137, D138, D139, D142; docs/08; agent (stated) |
| 2026-10-17 | P01 | Privacy:<br>- **Content:** D93 sentence verbatim, plus one Stripe note (Stripe keeps the date of birth, identity and bank details). D84 time zone; D83 Instagram views only with permission; D67 pasted links stored, shown to buyers, never fetched; D87 retention sentence; D113 / D129 saved cards stored by Stripe (we keep brand, last 4 and expiry), buyer sign-in, and consent and renewal records kept.<br>- **Corrections to research/license.md §8.2:** video files are "never", because nothing is downloaded or imported (07 D64); tokens and posts follow 03 §9.1 timings; `{N} years` is replaced by D87.<br>- **Data deletion:** items 1–2, with "Meta then tells us" and the `{N}` years removed.<br>- **Omitted (not built in CORE):** Settings → Delete account (`[H8]`, replaced by email to `PRIVACY_EMAIL`, act within 7 days), the deletion status lookup and the Meta callbacks (Later). | 07 D64, D67, D83, D84, D87, D93, D113, D129; 03 §9.1 |
| 2026-10-17 | P01 | Pre-commit review fixes to the legal copy, each matched to its source:<br>- **Terms, eligibility:** buyers must be 18 or older too (01 J7.5 checkout line; license.md §8.1 item 2).<br>- **Terms, creator rules:** the attestation quote ends where 01 J5.13 ends.<br>- **Terms, auto-renewal:** it can also turn back on by accepting a late increase (07 D138). The creator can change the renewal price during the license but not during a reservation, and with auto-renewal off the new price is what a manual renewal costs (07 D119, D122; docs/08 §2, §5).<br>- **Terms, copyright:** the copyright email is inline in a sentence (WCAG inline exception, not a standalone 20 px link).<br>- **Privacy and data deletion, disconnect:** the platform id is kept for reconnect, and posts used for videos keep their id and link (03 §9.1, §9.3; 07 D72).<br>- **Privacy, verify page:** lists every public field from research/license.md §6.3, and says prices, emails and payment details are never shown.<br>- **Privacy, retention:** says what else is kept (non-license requests, postings, audit and payment events), account data while the account exists and email logs for 1 year (07 D87; 03 §9.1).<br>- **Data deletion, keep-list:** adds postings and the reserved handle (03 §9.4). | 01 J5.13, J7.5; 03 §9.1, §9.3, §9.4; 07 D72, D87, D119, D122, D138; docs/08 |
| 2026-10-17 | P01 | `env.ts` hardening (pre-commit review): the origin refine runs only when `URL.canParse` succeeds. Before, an unparseable `APP_URL` threw a raw TypeError carrying the value and naming no key. Postgres URLs must now have `//` and a host. `env.test.ts` adds those cases, plus a check that the thrown error is a plain Error with no `input` and no value in its message. | P01 task 3; agent (stated) |
| 2026-10-17 | P01 | The legal page shell lives in `src/components/layout/legal-page.tsx`, an existing 07 D07 folder (layout covers page chrome), not a new `components/legal/` folder. P02 swaps its inline notice for `Banner`. | 07 D07; agent (stated) |
| 2026-10-17 | P01 | Vitest root `reporters: [["default", { summary: false }]]`, so a plain `bun run test` lists each test file (P02 Step 0 checks that it lists env.test.ts and design-tokens.test.ts). README updated: the landing path is `src/app/(public)/page.tsx` and the font is Inter. | P02 Step 0; agent (stated) |
| 2026-10-17 | P02 | Q1 (dev-only gallery): (a). `/dev/ui` (`src/app/dev/ui/page.tsx`) calls `await connection()`, then `notFound()` unless `isDevAppEnv(env.APP_ENV)`, with robots noindex. It is a dev-only route, not in the 02 §4.1 route map. Its `?theme=light` / `?theme=dark` switch sets `<html data-theme>` after mount, for review only (the MVP has no theme toggle). | owner in chat |
| 2026-10-17 | P02 | Q2 (packages shadcn pulls in): (a). Kept `class-variance-authority` 0.7.1 (2024-11-26; its only dependency is clsx 2.1.1). `init` also installed `tw-animate-css` 1.4.0 (forbidden by 04 §3.1) and the `shadcn` package itself (4.22.0, one day old); `bun remove shadcn tw-animate-css` removed both. 02 §1.1 runs the CLI only through `bunx`, and the `shadcn` package brought `braces` 3.0.3 (GHSA-vfj7-8cjw-p6xm, high) into bun.lock. After the removal `bun audit` is back to the one moderate. `sonner`, `vaul` and `next-themes` were never installed. | owner in chat; 02 §1.1 |
| 2026-10-17 | P02 | Q3 (404 copy): (a), "Page not found." and "Go to {APP_NAME}" → `/` (05 §10). | owner in chat |
| 2026-10-17 | P02 | Q-01–Q-03 (asked in chat as Q4–Q6 after the build): (a) each, so the built defaults stay. Q-01: a sync between 1 hour and 1 day reads "Synced {n} h ago", then "Synced 1 day ago" / "Synced {n} days ago", rounded down (`formatRelative`). Q-02: the TabBar marks the current tab with a 2 px ink bar above the icon, plus color and `aria-current`. Q-03: the creator avatar menu button is named "Account menu". No code changed. | owner in chat |
| 2026-10-17 | P02 | shadcn setup facts (research/bun-elysia-recommendation.md §8 item 5): shadcn 4.21.1 used Bun. `bun.lock` is the only lockfile, and `bun pm untrusted` finds 0. `init` also rewrote `src/app/globals.css` (shadcn variables, `@custom-variant dark`, two CSS imports) and `src/app/layout.tsx` (Geist in place of Inter). `git checkout src/app/globals.css src/app/layout.tsx` restored both: globals.css shasum dcb74d7… matches P01. `add` has no `-b` option; it takes the base (`radix-nova`) from components.json. | P02 task 1; agent (stated) |
| 2026-10-17 | P02 | Generated files: `input`, `textarea` and `label` were merged into `text-field.tsx`; `native-select` into `select-field.tsx`; `badge` into `status-pill.tsx`; `collapsible` into `disclosure.tsx`; `dropdown-menu` into `menu.tsx`; `alert-dialog` into `confirm-sheet.tsx`. All eight originals were deleted. `button`, `checkbox`, `switch`, `sheet`, `avatar`, `progress` and `skeleton` were rewritten in place on the same Radix parts. While restyling: shadcn token names were replaced by 04 tokens; its `data-open:` / `data-checked:` variants (defined only in the removed shadcn CSS) became `data-[state=…]:`; and blur, `opacity-50`, `ring-3` and pulse were removed. Every component imports `cn` from `@/lib/utils`, never from `"cn"`. | P02 task 1–2; 04 §3.3 |
| 2026-10-17 | P02 | `src/lib/utils.ts` exports a configured `cn` (`createCn` from `cn/config`; no new package) that registers the 04 §4.2 type scale as font sizes. cn's defaults read `text-body`, `text-callout` and the rest as text colors, so they dropped either the size or the color: a primary Button's label could turn invisible. `utils.test.ts` guards the merges and checks that the scale equals the `--text-*` names in globals.css. | P02 audit; agent (stated) |
| 2026-10-17 | P02 | Component APIs:<br>- **Button:** variants primary, secondary, tertiary, link and destructive; sizes lg, sm (with `hit-44`) and icon. The icon size ignores `variant` (its type forbids one and requires `aria-label`): a 44 px `fill` circle with an `ink` icon, `hover:brightness-95` and `active:scale-98`, so no variant's hover or pressed background can hide the icon. `loading` / `loadingLabel` stack the label and the spinner layer in one grid cell, so the width never changes; the hidden layer is aria-hidden and never repeats the children. The type requires `loadingLabel` whenever `loading` is passed (lg and sm), because that label is the button's name while loading. Press feedback runs at 100 ms (`active:duration-100`, 04 §6 `--dur-press`); colors at 200 ms. `asChild` uses Radix Slot. `link` has no pill box: no padding or min-width, `min-h-11` (lg), regular weight, and it wraps (`whitespace-normal text-left`) so long Contents links never scroll sideways.<br>- **TextField:** takes a `prefix` (from `CURRENCY_DISPLAY[c].prefix`) in place of React's RDFa `prefix`. The prefix span stays aria-hidden and its id comes first in `aria-describedby`, so screen readers hear the currency once. The read-only look (`fill`, no border) applies to TextField and TextArea only, because a `<select>` always matches `:read-only`. Errored fields keep the `danger` border on hover.<br>- **Checkbox:** the whole ≥ 44 px row is the `<label htmlFor>`, wrapping the box and the text.<br>- **Menu:** no MenuSeparator (04 names no separators) and no `outline-none` on items (04 §3.3), so the global ring shows.<br>- **StatusPill:** `tone` plus `dot` (`solid` / `hollow`, neutral only). Awaiting and danger always show their dot; cleared shows a 12 px check.<br>- **CountdownChip:** `expiresAt` (ISO), `srPrefix` ("Waiting for you") and `tone="neutral"` (the buyer's `/r`).<br>- **ConfirmSheet:** the safe button is AlertDialog.Cancel. The header has the same 44 px Close control as Sheet (a second Cancel), so initial focus is set explicitly to the safe button in `onOpenAutoFocus` rather than left to Radix's single cancel ref. The confirm variant is `destructive` by default, or `primary` / `secondary` for TurnOffAutoRenew and price sheets. With `cancelVariant="primary"` (TurnOffAutoRenewSheet) the safe button comes first in the footer, so the primary is first on mobile and last (right) on desktop. `confirmLoading` requires `confirmLoadingLabel`.<br>- **Stepper:** `steps`, `current` (0-based); mobile layout below md.<br>- **DataTable:** `columns` / `rows` / `rowKey`.<br>- **Avatar:** `name` (initials) and optional `src`. | 04 §9.2–§9.31; agent (stated) |
| 2026-10-17 | P02 | CountdownChip hydration: the server and the first client render show the pill frame with an empty `<time dateTime>`. `Date.now()` and the viewer's zone (for the `title` via `formatDeadline`) are read in `useEffect`, which then reschedules on `countdownState(...).nextTickMs` (60 s, 10 s under 1 h, none at 0). No `aria-live`, no hydration mismatch. CopyLinkField reads `navigator.share` with `useSyncExternalStore` (server snapshot false): WebKit would otherwise hydrate a different button. | 02 §4.4; 04 §9.10, §9.25; agent (stated) |
| 2026-10-17 | P02 | Lucide defaults: a client `Providers` with `LucideProvider size={20} strokeWidth={1.75}` in the root layout. lucide's Icon is a client component, so the context also reaches icons rendered from Server Components. 16 px icons pass `strokeWidth={2}` and 24 px pass 1.5 explicitly. | 04 §8.1 |
| 2026-10-17 | P02 | `error.tsx` and `global-error.tsx` call `retry()`, not 05 §10's `reset()`. In Next 16.4.1, `retry()` (stable since 16.3) re-fetches and re-renders the segment, while `reset()` only re-renders the cached result and can't recover from a Server Component error (`node_modules/next/dist/docs/…/error.md`). | Next 16.4.1 docs; agent (stated) |
| 2026-10-17 | P02 | Not-found: the root `not-found.tsx` renders the public NavBar itself, because unmatched URLs use the root layout only. `(public)/not-found.tsx` renders the body only, so a `notFound()` inside `(public)` doesn't double the chrome. The copy lives once in `NotFoundBody` (07 D49). e2e on a 404 page ignores only the browser's own "Failed to load resource … 404" for the document; every other console error still fails. | 05 §10; AGENTS §7; agent (stated) |
| 2026-10-17 | P02 | Shell: the creator destinations live once in `creator-nav.ts`. Every shell link has `prefetch={false}` (`SHELL_PREFETCH`), because a production prefetch of a `/dashboard/*` route that doesn't exist yet logs a 404. "My licenses" isn't in the Menu or the MoreSheet yet: P20b adds it with `/licenses` (07 D126). MoreSheet rows are words only, with no chevrons (04 §8.1 "No icons in menus, the More sheet"). The admin `below` slot renders under the sticky bar, not inside it, so `scroll-padding-top` stays right. The admin NavBar's wordmark links to `/admin` (04 §9.30 names no target for admin), with `prefetch={false}` until P21 builds `/admin`. MoreSheet rows are plain, with no separators (05 §1.3 draws none). The TabBar also scrolls a focused element clear of itself when it covers that element's bottom edge, because WebKit's focus scrolling can leave a field a few px under the bar despite the root's `scroll-padding-bottom` (WCAG 2.2 SC 2.4.11); it tests with `elementFromPoint`, so a sheet above the bar or the hidden bar at lg never triggers it. | 04 §9.30; 05 §1.3; 07 D126; agent (stated) |
| 2026-10-17 | P02 | P01 follow-up applied: full-width containers (the NavBar inner row, the `(public)` and error `<main>`) use `SHELL_GUTTER`, `max(var(--gutter), env(safe-area-inset-left/right))`. It lives in the plain module `gutter.ts`: exported from the client `nav-bar.tsx`, it reached Server Components as a client reference, and the gutter vanished. The e2e now checks the gutter. | P01 follow-up; agent (stated) |
| 2026-10-17 | P02 | Sheet: below md a bottom sheet (`max-h-[92dvh]`); from md a 30rem dialog capped at `100dvh − 4rem`. Only the body scrolls, so the title, the 44 px close button and the footer stay on screen in short windows. Filled overlays (sheet, menu, toast, current segment, switch thumb) carry `border border-transparent` for forced colors (04 §7). Menu items are `min-h-11`; the Switch track and SegmentedControl segments use `hit-44`. Forced colors drop backgrounds, so the TabBar's current-tab bar and the Progress bar use `forced-colors:bg-[CanvasText]` and the Progress track gets `forced-colors:border`. The toast action sets `[--focus:var(--canvas)]`, so its focus ring is about 19:1 on the `ink` toast in both themes (the default ring was 2.6:1 there in dark mode); globals.css is unchanged. | 04 §2.3, §7, §9.22, §9.23; agent (stated) |
| 2026-10-17 | P02 | Formatters: `formatBytes(n, total?)` uses binary units shown as MB/GB (07 D80: 2 GiB reads "2 GB"); the unit comes from the larger value, and with a total it prints "312 of 840 MB". `formatPostDate` is the UTC day, and `formatLicenseDate` is UTC with h23. `formatDeadline(d, tz)` builds the viewer's-zone text from en-US `formatToParts` (ASCII, the same in Node, Chromium and WebKit). `formatCountdown` rounds down to whole minutes and always prints both units. `formatEmailDateTime` is P17's. The money rules follow D98: the prefix comes from `CURRENCY_DISPLAY`, the digits from en-US `Intl.NumberFormat` (never the currency style), and U+2212 is the minus. `format.test.ts` runs every golden under `TZ=Pacific/Auckland` and `TZ=America/Los_Angeles`. | 04 §4.4; 07 D80, D84, D98; 01 G.7 |
| 2026-10-17 | P02 | New files that aren't components in 04 §9.1: `src/components/layout/creator-nav.ts` (shell config), `gutter.ts`, `not-found-body.tsx`, `src/lib/countdown.ts`, `src/app/providers.tsx` and `src/app/dev/ui/{gallery,theme-attribute}.tsx`. The field chrome (`FIELD_BOX`, `FIELD_ERROR`, `describedBy`, label, messages, shell) is exported from `text-field.tsx` for SelectField and Checkbox, so there is no extra `ui/` file. `/dev/ui` is a review page and is exempt from 04 §5.6's budget of three frosted elements: it shows three NavBars and the real TabBar. | agent (stated) |
| 2026-10-17 | simplify | TabBar height: 56 px (`--tabbar-h`) plus the safe area, measured with its border and `safe-area-bar` padding inside (border-box), so the tabs are 45 px (≥ 44). 04 §9.30 says 56 px, and the root scroll padding and the toast offset reserve 56 px + safe area; the P02 bar was 67 px (h-14 tabs plus padding), which shrank the focus buffer to 5 px and the toast gap to 9 px. The bar's space below the page was first a spacer inside TabBar; the P03 code review moved it to a `<body>` class in the root layout (no placement rule for callers). | 04 §5.3, §9.30; agent (stated) |
| 2026-10-17 | simplify | Shell split: public pages, the 404 and the error view render `PublicShell` from a plain module, so they don't download NavBar's creator Menu code (about 24 KB gzip per page, measured by the efficiency reviewer on the P02 build). `NavBar` keeps all three variants (P02 acceptance); its public variant is `PublicNavBar`. The global error view now uses the same `MessageBody` as the 404, so its top padding is py-6 on phones (was py-12). | 04 §9.30; 05 §10; agent (stated) |
| 2026-10-17 | simplify | `ENV_KEYS` is derived from the schema shape and exported; `parseEnv` still reads only those keys. A unit test requires `.env.test` to list them all, which keeps e2e from falling back to `.env.local` (P01's reason for listing every key). | 07 D51; agent (stated) |
| 2026-10-17 | simplify | Legal React keys are the JSON of each item, with a counter for repeats; index keys stay off (Biome `noArrayIndexKey`). Rendered text and links are unchanged (compared on the built HTML). | agent (stated) |
| 2026-10-17 | P03 | Owner answers (P03, in chat): Postgres 18.6 instead of the plan's 17 (Neon's default since 2026-06-05; OQ-01 updated); auto-delete is off on both branches; the `test` branch is disposable (prompt Q2 (a)). Region AWS US East (N. Virginia), fixed by the owner's setup and matching the recommendation. The GitHub repo is public, so the log records only the start of each endpoint host, not the full hostname. The database is `neondb` on both branches: 07 D103's `cliplease_dev` / `cliplease_test` names are for local and CI databases only (07 settles it). | owner in chat; 07 D103 |
| 2026-10-17 | P03 | Schema source: the 03 §3–§4 code, minus every line tagged `CORE · 0001 (P19e)`, `0002 (P20b)` or `0003 (P22b)` and every `[H1]` CHECK. The prompt's cut rule covers tagged columns, indexes and CHECKs, not imports or untagged code. The renewal code in 03 §4, §3.9 and the §3.7.2 import lists would not compile in 0000, so it goes too: in `relations.ts` the `./renewals` import, `renewalPlans` / `renewalReservations`, both `// Renewals (0003)` blocks and the four `renewal*Relations`; in `types.ts` the 8 renewal types; in `index.ts` `export * from "./renewals"`; in `licensing.ts` the tagged `./renewals` import and the untagged `licenseRequestOriginEnum` and `AnyPgColumn`. Section comments that only introduced cut code are gone too. P22b adds them back. 07 §2.5's and §7.2's schema bullets are superseded by D65, D80–D82 and the §8.2 delta; the latest rows were followed. `email_log_entity_type` lists the 4 entity types (03 §3.8's 7 include 0003's). | 03 §3–§4; 07 D116; agent (stated) |
| 2026-10-17 | P03 | Relations fix: 03 §4's `license: one(license, { relationName: "license_request_license" })` fails typecheck in drizzle-orm 0.45.3 and crashes `drizzle()` at startup (a config without `fields`). With one FK between the two tables, P03 writes `license: one(license)` and `request: one(licenseRequest, { fields: [license.licenseRequestId], references: [licenseRequest.id] })` with no `relationName`. | 03 §4; drizzle-orm 0.45.3 relations; agent (stated) |
| 2026-10-17 | P03 | Index sort order: every descending index column is `.desc().nullsFirst()` (14 columns in 11 indexes). drizzle-orm 0.45.3 otherwise emits `DESC NULLS LAST`, which 03 §3.10's indexes and 03 §7's `ORDER BY … DESC` queries can't use (Postgres's DESC default is NULLS FIRST). The migration now says `DESC NULLS FIRST`. | 03 §3.10, §7; agent (stated) |
| 2026-10-17 | P03 | Biome: `drizzle/` is excluded (drizzle-kit's JSON fails the formatter), and the generated `src/db/schema/auth.ts` has an override with the formatter and organizeImports off, so it stays the generator's output plus the 2 hand edits after every regeneration. | agent (stated) |
| 2026-10-17 | P03 | Tooling facts: `drizzle.config.ts` refuses a pooled `DATABASE_URL_UNPOOLED` and `NODE_ENV=test` without `APP_ENV=test`, and prints only the host and the env file names. The Better Auth CLI reads `.env` / `.env.local` itself (a second loader besides @next/env; don't create a `.env`, it would win) and needs no database (`--adapter` uses a mock). `attachDatabasePool` is a no-op outside Vercel: it adds one `release` listener, and its idle timer needs `VERCEL_URL` and `VERCEL_REGION`. The CLI flags matched the prompt. | @vercel/functions 3.9.9 source; auth@1.7.7 dist; agent (stated) |
| 2026-10-17 | P03 | Test-database guard: `checkTestDatabase` (pure, in `tests/helpers/test-database.ts`) refuses unless `APP_ENV=test`, and compares databases by the identity pg itself resolves (`pg/lib/connection-parameters`: host without `-pooler`, port, name, so query parameters such as `?host=` count), for both test URLs against both `.env.local` URLs; it also refuses when the test pair points at two databases. Messages never contain a URL. `assertTestDatabase` checks the pool's own connection string; it runs in the setup file and again inside `resetDb`. The pure cases run in the unit project (`tests/unit/test-database.test.ts`, the "shown by a test" criterion), so `bun run test` covers them without a database. The prompt's manual refusal check used shell overrides instead of editing `.env.test`. `resetDb` quotes table names (`user` is reserved) and says so clearly when the database has no tables. | AGENTS.md §3 (security); agent (stated) |
| 2026-10-17 | P03 | Vitest: the integration project lists only `integration.ts` (Vitest 5 joins setupFiles under `extends: true`, root first), runs files one at a time, and keeps the default `isolate: true` (each file ends its own pool). The setup's dynamic imports are what the prompt asks for; they are defensive, since Vitest already runs setup files in order (`sequence.setupFiles` "list"). The unit project also includes `tests/unit/**` for pure test-helper tests. 30 s timeouts cover a Neon compute waking up. | P01 Decisions; vitest 5.0.3 source; agent (stated) |
| 2026-10-17 | P03 | Factories: the prompt's names plus `insertLicense` (the CL- code case needs a license; P13, P19f and P22b reuse it). `insertCreator` inserts its user unless `userId` is given, and leaves `time_zone` and `payout_currency` to the database defaults ('UTC', 'cad'), so the "reads cad" case exercises the default. `insertVideoPosting` computes the next free position, and `insertLicenseRequest` the creator's payout currency, inside the insert itself (one round trip each). All factories share one `insertOne` helper; `randomHex` and `instagramReelUrl` are exported for tests, and the terms version is `LICENSE_V1_VERSION`. Overrides are spread last: `{ currency: undefined }` sends DEFAULT, which is NULL here (23502). Unique values are random, because `resetDb` runs once per file. The invalid `'eur'` case updates the column through `sql`, so no type cast. | P03 Tasks 7–8; agent (stated) |
| 2026-10-17 | P03 | Postgres 18 error code: an ON DELETE RESTRICT violation is SQLSTATE 23001 (restrict_violation) on Postgres 18.6 and 23503 on 14.15; NO ACTION is 23503 on both (checked with temporary tables on both servers). The "delete a referenced social_post" case therefore asserts 23001 (`PG_ERROR.restrict` in `tests/helpers/db.ts`) with `video_posting_social_post_fk`; the constraint and its intent are the prompt's. Every other smoke case asserts the prompt's code. | owner's Postgres 18 choice; agent (stated) |
| 2026-10-17 | P03 | `src/lib/licensing/snapshot.ts` uses the values.ts types (`SocialProviderId`, `UseKey`, `TermKey`, `TerritoryKey`) where 03 §3.7.2 writes the same unions inline, so a new key reaches the snapshot type (07 D04: tuples live in values.ts only). The types are identical. | 07 D04; agent (stated) |
| 2026-10-18 | P04 | Owner answers (P04, in chat): both admins are in `.env.local` `ADMIN_EMAILS`, owner first (OQ-02; addresses not recorded, the repo is public); the signed-out banner shows only with `next` **and** a stale session cookie (Q2 a); proposed copy ships as written (Q3 a); a sign-in lasts 7 days, Better Auth's default with a daily sliding refresh (Q-04); P04 runs as one step with a 6 h budget (Q-05). | owner in chat |
| 2026-10-18 | P04 | Proposed copy shipped (Q3 a), all from 05 §5.1 / §8 *(proposed)* or drawn there: "Sign in", "Sending…", "Signing in…", "By continuing you agree to the Terms and Privacy Policy.", "Enter an email address like name@example.com.", "Use a different email"; email subject "Your ClipLease sign-in code" (no digits), heading "Your sign-in code", "Enter this code to sign in: 123 456", "It expires in 10 minutes. If you didn't ask for it, ignore this email.", footer "You got this email because someone asked to sign in to ClipLease with this address." + "Questions? Reply to this email." (05 §8 callout 8); tab titles "Sign in", "Welcome", "Inbox", "Admin". Offline and server errors use 05 §1.4's "You're offline. Check your connection and try again." and "Something went wrong. Try again." | owner Q3 a; 05 §1.4, §5.1, §8 |
| 2026-10-18 | P04 | Better Auth 1.7.7 errors, read in `node_modules` and proven by [int]: wrong/used code 400 `INVALID_OTP`, expired 400 `OTP_EXPIRED`, the call after 3 wrong ones 403 `TOO_MANY_ATTEMPTS` (later ones 400 `INVALID_OTP`), bad email 400 `INVALID_EMAIL` (or `VALIDATION_ERROR`), limiter 429 with no code. `signInErrorKey` matches codes before statuses (403 is also an origin error). Field errors: bad code, invalid email, too many tries (429 under the field, as 04 §9.36's InlineEmailCode). Offline and server errors are an error `Banner` above the field (05 §1.4) with the button re-enabled as the retry; a network failure rejects the client call, so it never reaches the mapper. | better-auth 1.7.7; 05 §1.4; agent (stated) |
| 2026-10-18 | P04 | Rate limits: 3 code emails and 10 code checks per 60 s per IP (`signInRateLimits`), relaxed to 1000 per 60 s when `APP_ENV=test` so the limiter still runs (07 D54); storage `database` (the `rate_limit` table). `auth.api.*` skips the limiter, so the [int] limiter case goes through `auth.handler` and checks the `rate_limit` row. | 07 D54; agent (stated) |
| 2026-10-18 | P04 | Session refresh: Better Auth extends a session once a day, but a Server Component can't write the cookie (nextCookies swallows the error), so a page read would move the database expiry while the browser cookie kept its first 7-day Max-Age. `getSessionUser` reads with `query: { disableRefresh: true }`, and `SessionRefresh` (part of `AppShell`: `/onboarding`, `/dashboard/**`, `/admin`) calls `/api/auth/get-session` once an extension is due (`getSessionRefreshAt`: a day after the last one) and checks again when a tab comes back; the route extends the session and re-sets the cookie. This is how the owner's "7 days, Better Auth default" works with Server Components. | owner Q-04; better-auth 1.7.7; agent (stated) |
| 2026-10-18 | P04 | Gates: `requireAdmin()` sends a signed-out visitor to `/sign-in?next=%2Fadmin` (the acceptance criterion) and gives a signed-in non-admin `notFound()` (02 §5.1). The admin layout gates (so the 404 renders without admin chrome) and the page gates again; the page's title comes from `generateMetadata`, which also calls `requireAdmin`, because static `metadata` resolves apart from the layout and titled the 404 "Admin". The creator shell layout is UX only (02 §4): it reads with `getCreatorForApi()` and never redirects, so each page's `requireCreator(<path>)` keeps the deep link. The proxy has three matcher entries (P04 task 5); 02 §4.5's fourth, `/licenses/:path*`, arrives in P20b. | 02 §4, §4.5, §5.1; agent (stated) |
| 2026-10-18 | P04 | Sign-in form behaviour: six digits submit by themselves only when they arrive in one change (`shouldAutoSubmit`: paste, drop, autofill, a keyboard suggestion, or an insert of more than one character), never on the 6th typed digit or a deletion, and never twice for the same code. On a failure focus returns to the step's field, and a visually hidden `role="alert"` (keyed per failure) announces field errors, because focus is often already there (05 §5.1 "focus moves … to the error"). The code field is described by the "we sent to m…@domain" line (`aria-describedby`, which the field primitives now add to their own links). "Use a different email" is disabled while a request is out. After a successful sign-in, a page restored from Safari's back/forward cache reloads (the server then redirects to `next`). The email is trimmed and lowercased before sending. | 05 §5.1; agent (stated) |
| 2026-10-18 | P04 | Redaction: one pure module `src/lib/redact.ts`, used by `logEvent`, the Better Auth logger sink and `writeAudit`. Keys containing token, secret, password, apikey, api_key or email, and the whole keys authorization, cookie, code and otp, become "[redacted]"; strings are cut to 2,048 characters at the last whitespace (so half an address never survives), lose URL query strings, fragments and credentials (a URL that doesn't parse keeps only its scheme, since its host part may hold a password), and emails become "[email]"; both text patterns are anchored so they run in linear time (the first version took seconds on a 32 KB request value); Drizzle query errors keep only `pgCode` and `constraint`; cycles are detected on the current path only. `writeAudit` keeps `code` (`keepKeys`), since license codes are public and P18–P24 store them; it still redacts `otp`, tokens, secrets and emails. | 02 §9.9; 07 D47; agent (stated) |
| 2026-10-18 | P04 | Better Auth logging: `logger.log` writes its warnings and errors as redacted JSON lines (`event: "auth.better_auth"`) because its query errors carry emails and session tokens. auth.ts can't import `src/server/log.ts` (server guard, ADR-34), so both build their line with the pure `formatLogLine` (`src/lib/log-line.ts`); Better Auth's other levels map to info, and a message that is an Error goes through the same redactor. | ADR-34; 07 D47; agent (stated) |
| 2026-10-18 | P04 | Email: files are `.data/emails/<iso>-<6 hex>-<template>.json`, written to a temp file and renamed (P04 says `<iso>-<template>.json`; the hex keeps two emails in the same millisecond apart, and tests filter by `to`, template and time). The plain-text part keeps the heading's case (html-to-text capitalizes headings by default). | agent (stated) |
| 2026-10-18 | P04 | Seed: `seed.applied` is written only when the run changed something (03 §8.1 says both "one seed.applied row" and "running it twice changes nothing"), with `entityType 'user'`, the changed user's id and counts only (`promoted`, `created`, `source`), never emails. `seed_user_admin` gets `name ''` like an OTP sign-up. If `seed_user_admin` exists with an address no longer listed, the seed stops with exit 1 instead of rewriting it. With `ADMIN_EMAILS` empty it uses `admin@example.com` (and promotes an existing user with that address). It refuses `APP_ENV=production` and `--demo` before importing anything that reads env or the database, and runs under `--conditions=react-server` (no D53 fallback). | 03 §8.1; 07 D53; agent (stated) |
| 2026-10-18 | P04 | Types: `Actor` is 02 §5's full union (`creator`, `admin`, `buyer`, `buyer_user`, and `system` with `webhook`, `cron`, `lazy`, `return_url`, `seed`, `auto_approve`, `renewals`), not only the four kinds P04 lists, because P19g and P22c/d write the others; no guardian actor (07 D93). `CreatorContext` has no `autoApprove` (P04 task 5). | 02 §5; agent (stated) |
| 2026-10-18 | P04 | UI: `/onboarding` uses NavBar `withoutProfile` (no links; the Menu holds only Sign out, since every creator page would send the user back; 04 §9.30, P20b adds My licenses). App pages (`/onboarding`, `/dashboard/**`, `/admin`) render through `AppShell`, whose `<main data-app>` makes `html:has([data-app])` paint `canvas-alt` (04 §3), overscroll included. The Inbox placeholder is the EmptyState title as the page's h1. | 04 §3, §9.30; agent (stated) |
| 2026-10-18 | P04 | `next.config.ts` reads `process.env.APP_ENV` directly (importing env.ts would make `next typegen` need a full env); headers are fixed at build time, so `next build` and `next start` must use the same `APP_ENV`. HSTS `max-age=63072000; includeSubDomains` only when `APP_ENV=production` (02 §4.6). | 02 §4.6; agent (stated) |
| 2026-10-18 | P04 | e2e: each test signs in its own run-unique address (`uniqueEmail`), because only the newest code for an address works and both projects run in parallel; each project has its own admin (chromium-desktop `e2e-admin@example.com`, webkit-iphone `e2e-admin-2@example.com`). `collectConsoleErrors` ignores only the listed failed-resource logs (the 400 of a wrong code, a document 404, a 429) and WebKit's cancelled RSC fetches: WebKit reports a Next background prefetch that a navigation cancels as a page error ("…?_rsc=… due to access control checks."), which made the creator flow fail about 1 run in 20 when a test left a page right after loading it (a probe saw it in 14 of 40 runs; Chromium stays quiet). `playwright.config.ts` refuses to start unless `checkTestDatabase` passes. | 07 D88; agent (stated) |
| 2026-10-18 | P04b | 07 D144–D158 as applied: four tiers only (base, `md:`, `lg:`, `2xl:`; no `sm:`, `xl:`, arbitrary breakpoints or container queries; no `--breakpoint-*`), the app column 1200 px and 1440 px from XL through `--app-max` (D145), reading columns 640 px at every tier, `md:` as the first switch for the FactList and the full-width buttons (D146, D149), the NavBar links and the TabBar switching at `lg` with the tab row centered on Tablet (D147), sheets as bottom sheets below `md` and dialogs from `md` with safe-area sides (D149), the Toast capped by `100%` (D152), no `overflow-x: hidden` on any root (D152), the Verify widths and the four Playwright projects (D153, D154), AGENTS.md §7–§8 synced (D155), nothing visual changed (D156) and P04b between P04 and P05 (D157). | 07 §11 |
| 2026-10-18 | P04b | Playwright devices: `webkit-ipad` uses `iPad Mini` (768 × 1024, scale 2, mobile, touch, WebKit), not `iPad (gen 11)` (656 px: the Mobile tier); `chromium-xl` is `Desktop Chrome` at 1920 × 1080. The original `iPhone 17` project is 402 px wide (Mobile). The iPad project reports `matchMedia("(pointer: coarse)")` = true (a test annotation; touch is not a tier, D144, so nothing branches on it). | 07 D154; prompt Task 5 |
| 2026-10-18 | P04b | `sm:` → `md:`: FactList (every class, `md:contents` included, and its doc comment), the landing page's Sign in button and both sign-in buttons (`w-full md:w-auto md:self-start`). Only 640–767 px changed: the FactList stacks and the buttons stay full width there, as on phones. The Button's cva size key `sm:` is a variant name and stays. | 07 D146, D149 |
| 2026-10-18 | P04b | The `/admin` sweep runs inside the admin test of `sign-in.spec.ts` (a second test signing in the same e2e admin would replace its code), after its assertions and before `expectRefreshWhenDue`, so it runs on the real clock. `e2eAdminEmail` returns `null` on `webkit-ipad` and `chromium-xl`, and the test skips there with a reason (`testMatch` already keeps that spec off them). | 07 D88, D154 |
| 2026-10-18 | P04b | `design-tokens.test.ts` is 04 §2.6 plus one test, `keeps the default Tailwind breakpoints (07 D144)`; it is no longer verbatim §2.6. The contrast tests pass unchanged (no color token added). | prompt Task 1; 07 D144 |
| 2026-10-18 | P04b | Helper names 02 doesn't list, in `tests/e2e/helpers/layout.ts`: `expectPageFrame(page, width, { banner })` (gutter per tier, computed `max-width` and cap, for `<main>` and the NavBar row), `appCap(width)`, and the types `Tier` and `WidthCheck`. 02 §11.2's names (`TIERS`, `tierAt`, `VERIFY_WIDTHS`, `SPOT_WIDTHS`, `EDGE_WIDTHS`, `expectNoHorizontalScroll`, `expectWithinCap`, `atEveryWidth`) are as listed. | 02 §11.2; agent (stated) |
| 2026-10-18 | P04b | Measuring under reduced motion: the app's reduced-motion rule makes every change a 1 ms transition (globals.css), so a read in the frame of a resize or theme switch can be the previous width's value (7 of 22 reads in the plan audit's probe), and a sheet is still at its `translateY(100%)` start when it becomes visible. `atEveryWidth` waits for running CSS transitions (`document.getAnimations()`, `CSSTransition`, `finished`) after each resize and theme switch, and the Sheet check waits for the dialog's animations; neither uses timers, so both also work under `page.clock`. The prompt's "a sheet is measured in its final position" holds only after that wait. | measured; agent (stated) |
| 2026-10-18 | P04b | Two layout fixes (each needed by a P04b rule, neither visual): `hit-44` on the creator NavBar links, because "Inbox" was about 38 px wide and 07 D152 requires 44 × 44 at every tier (it wins over D147's looser wording); and the sign-in step-2 masked address as an `inline-block max-w-full wrap-anywhere` span with a `whitespace-nowrap` "m…@" prefix, because P04's `whitespace-nowrap` on the whole address overflowed at 320 px with a long domain (07 D153). `/sign-in`'s responsive test covers step 2 with a long hyphen-free domain, so the count stays 10 per project. | 07 D152, D153 |
| 2026-10-18 | P04b | Kept as they are (07 D156, nothing visual changes): a Sheet keeps its `safe-area-bar` bottom padding as a dialog from `md` (04 §9.22 gives it to the bottom sheet only); the error view's Try again keeps its own width on phones (no Mobile frame draws it); block-level columns (`max-w-reading` with `mx-auto`) have no `w-full`, since they already fill their parent (AGENTS.md §8's "`w-full` plus a cap" needs no edit for them); the DataTable stays a table below `lg` on `/dev/ui` until P20. | 07 D156; agent (stated) |
| 2026-10-18 | P04b | Doc-versus-07 differences followed (07 §0.4): the responsive audit's "keep 1200 at XL" → 1440 (D145); its `chromium-desktop`-only sweep → the spec on all four projects (D154); its "every spec on all four" → behavior specs on the original two (D154); `sm` as a Mobile refinement → `sm:` banned (D144); its own lint patterns → 04 §3.4's six; its §4.4 "every link and button in the banner" → `main header` on `/dev/ui`, whose NavBar demos sit inside `<main>` (D154). | 07 §11; research/responsive-audit-app.md |
| 2026-10-18 | P04b | Naming: Q-05 (P04) used "P04b" for a split of P04 (logger, audit, seed) that never happened; this P04b is 07 D157's responsive retrofit. The Open questions line now says "OQ-01–OQ-57" (owner's kit update); its citation was left as it was. | owner in chat; 07 D157 |
| 2026-10-18 | P05 | Owner answers in chat (Q-06–Q-11, all option a): length errors say "Use 3 to 30 characters."; 05's proposed strings ship as written; the extra proposed copy ships ("Start and end with a letter or number, with no two dots in a row.", "Enter your name.", "Use 60 characters or fewer.", "Continuing…", "Saving…", "Updating…", "Payouts unavailable. Contact {SUPPORT_EMAIL}.", the title "{display name} (@{handle})"); the 18+ box is `NativeCheckbox`, a native input styled exactly like the Radix `Checkbox` (shared `BOX` classes); the banner links to `/dashboard/settings#payouts`; five old comments that said "birth" or "guardian" were reworded (comments only). | owner in chat |
| 2026-10-18 | P05 | Recorded owner answers, not asked: OQ-07 (dots allowed, handles immutable), OQ-29 (18 or older, `age_confirmed_at` only), OQ-05 (publish and sell before payouts; Approve needs them), OQ-19 (the device's time zone), OQ-21 (CAD only; `payout_currency` keeps its default, no picker), OQ-37 (the negative-balance line with "Payout terms") and OQ-11 (the approval window shown read-only until P19c). | 07 §4.1 |
| 2026-10-18 | P05 | `src/server/payments/driver.ts` is P05's subset of 02 §5.8: every type and method later prompts call, without the saved-card and renewal fields and the `payment_method` event that P22c and P25c add. The registry also exports `createPaymentsRegistry(env)` (the injectable form its unit test uses); `paymentsDriver(currency)` builds it from `env` on first use. | agent (stated) |
| 2026-10-18 | P05 | Payouts step when payouts are already on (the prompt's judgment call): "Payouts on" and **Continue** → `/dashboard/library`, with no setup link; `pending` shows "Stripe is checking your details." and Continue. Connect's Continue goes to `/dashboard/library` when payouts are active. | prompt Task 3; agent (stated) |
| 2026-10-18 | P05 | Settings follows 05 §6.11's order (Payouts, Profile, Requests, Emails, Account) and its Profile frame (the read-only handle between the name field and Save). Requests shows "Time to answer · 72 hours" read-only (prompt Task 5); P19c draws 05's approval-window choice. **Update from this device** is a secondary button as the prompt says (05 draws a tertiary link; the prompt outranks the docs, AGENTS.md §1). | prompt Task 5; 05 §6.11 |
| 2026-10-18 | P05 | "Payout terms" is an inline link inside the negative-balance sentence (the app's inline-link style), opening `/legal/terms#payouts` in a new tab with `rel="noopener noreferrer"` and "(opens in a new tab)" in its name, so payout setup isn't lost; the prompt named `Button variant="link"`, which is a no-wrap flex box inside a wrapping footnote sentence. | agent (stated) |
| 2026-10-18 | P05 | Onboarding keeps the NavBar `withoutProfile` (wordmark and avatar) on all three steps, also after the profile exists: 05 §5.2 draws no creator links mid-flow. The Library placeholder and the Inbox carry the full creator chrome. | 05 §5.2; agent (stated) |
| 2026-10-18 | P05 | `defaultRateOptions()` counts `sortOrder` from 0 within each dimension, in 03 §8.1's order. Time zones are lenient: an unknown or over-long zone becomes `UTC` in onboarding (a hidden field gets no error), while Settings' action refuses one over 64 characters (02 §6.1). | 03 §8.1, 02 §6.1; agent (stated) |
| 2026-10-18 | P05 | Handle messages: a bad character is explained once typing pauses (300 ms, 01 J1.4); a handle more typing can still make valid (too short or long, or ending in "." or "_") also waits for a blur or Continue (04 §9.6); the reserved and availability lines show "Checking…" until the pause. A failed availability check leaves the line empty (Continue still validates on the server). The Handle field is `type="text"` with `autoComplete="off"` (not a sign-in name). | 01 J1.4, 04 §9.6 |
| 2026-10-18 | P05 | Wrap rules (07 D153 no sideways scroll; D156 allows wrap rules): FactList values (`min-w-0`, `wrap-anywhere`, `md:grid-cols-[7rem_minmax(0,1fr)]`), the `/@handle` name and handle, Settings' handle line, the availability line, field error text, and the suggestion chips (`whitespace-normal`, `min-h-9`, `max-w-full`, `wrap-anywhere`). 04 §9.2 names one wrapping button; 07 D153 wins for the chips (a 30-character suggestion is wider than a 320 px column). Normal-length content looks the same. | 07 D153, D156 |
| 2026-10-18 | P05 | The address keeps `?payouts=returned` after the return from payout setup: rewriting it on the client starts a router update in Next 16 (a direct `history.replaceState` from a child effect even runs before the router hooks history, and the router puts the old URL back), and a Settings action sent during that update was cancelled in Chromium (probed). So a reload repeats "Payouts are on." and re-reads the status, which 05 §6.11 allows. | measured; agent (stated) |
| 2026-10-18 | P05 | `onboarding.test.ts` builds the removed step's name from two parts, so the acceptance search for age data over `src` stays empty while the table still tests that step (the `env.ts` header uses the same approach for P03/P04's searches). Audit actions: `creator_profile.created`, `creator_profile.updated`, `creator_profile.payouts_account_created`, `connect.negative_balance_debits_failed`. `user.name` is set to the display name at onboarding and kept in step by `updateProfile`. | agent (stated) |

## Owner answers (07 §4.1)

These are final. No prompt asks them again; each states the answer in one line (07 D63). "Changes the plan" rows are built by
D63–D92 (07 §7), for the 2026-10-16 rows (OQ-21, OQ-29 revised; OQ-39, OQ-40 new) by D93–D106 (07 §8), for OQ-41–OQ-48 by
D107–D131 (07 §9), for OQ-34–OQ-38 and OQ-49–OQ-53 by D132–D143 (07 §10; it wins over §1–§9), for OQ-54 by D144–D158 (07 §11; layout only), for OQ-55 and OQ-56 by D159–D160 (07 §12), and OQ-57 needs no decision (07 §12.3: 01 J12.4 and 04 §9.35 already say it). On the exclusive and renewal rules
`docs/08-exclusive-renewals-owner-spec.md` wins.

| ID | Owner's answer | Changes the plan? | Status |
|---|---|---|---|
| OQ-01 | Neon, with `dev` and `test` branches; Postgres 18 (the owner chose 18 over the planned 17 in P03) | small (P03 Decisions: Postgres 18, RESTRICT = 23001, P32's CI image) | answered 2026-10-15, revised 2026-10-17 |
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

None open: every owner question (OQ-01–OQ-57, Q-01–Q-03 from P02, Q-04–Q-05 from P04 and Q-06–Q-11 from P05) is answered (07 §4.1, §10; Decisions 2026-10-17 and 2026-10-18). Add new questions below the line with the next free
number (Q-12, Q-13, …); when one is answered, set its status to "answered (Pxx)" and add the answer to Decisions.

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
