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
  - Lettered parts are separate prompts in the build order (P05 → P06, since P05b is Later and in no Step 0 chain; P10a → P10b → P10c → P11 → P11b → P11c → P12;
    P19 → P19b → P19c → P19d → P19e → P19f → P19g → P20 → P20b → P21; P21 → P21b → P22; P22 → P22b → P22c → P22d → P22e → P22f →
    P22g → P22h → P23; P25 → P25b → P25c → P25d → P26; P28 → P28b → P29; 07 D130). Each one's Step 0 checks the one above.
  - Optional hardening prompts (P31a–P33c) the owner skips: replace "· [ ] to do" with "· skipped (YYYY-MM-DD, owner)".
    The next Step 0 then checks the latest completed prompt instead.
  - "Record:" lists what this prompt's Wrap up asks for and what the next prompt's Step 0 looks for here, on top of the
    five usual bullets. Missing it makes the next prompt stop.
  - A conflict that docs/07-decisions.md settles is not a stop: follow 07 and note it under that prompt's Decisions.
  - The owner answered OQ-01–OQ-33 on 2026-10-15, revised OQ-21 and OQ-29 and added OQ-39 and OQ-40 on 2026-10-16 (07 §4.1, §8),
    answered OQ-41–OQ-48 the same day (07 §4.1, §9; the exclusive and renewal rules are `docs/08-exclusive-renewals-owner-spec.md`), and
    answered OQ-34–OQ-38 and OQ-49–OQ-53 the same day (07 §4.1, §10). Prompts never ask them again; they are listed below as answered.
    New questions get the next free number (Q-01, …).
  - Commands are always `bun run <script>` (Bun 1.4.3 as package manager only, Node 24 runtime; AGENTS.md §9, 07 D107).
  - Later prompts (outside the totals, 07 D105) have their own section after the Log, "## Later prompts": P34 (USD) runs last and
    only when the owner adds USD; P05b (teens) stays "not scheduled".
  - Money in this file is written with its currency (`CA$1,732.50`), never a bare `$` (07 D98).
  - Copy every judgment call into the Decisions table.
  - Gates are signed off only after the owner says so in chat.
  - Never write secrets, OAuth tokens, sign-in codes, buyer emails or signed URLs in this file.
-->

## Status
Current prompt: P03 · Last verified: P02 · Blockers: none
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
- Open questions: Q-01, Q-02 and Q-03 (sync-time wording, TabBar current-tab marker, account-menu label). Each default is built; they are not blocking.
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

**M1 Data, sign-in and handle** · P03–P05 · 6.0 h

### P03 — Database schema, migrations and integration harness · [ ] to do
> 120 min · Depends on: P01, P02 · Record: the Neon branches (OQ-01 answer), migration hosts (no secrets), how to target the test database, differences between the generated `auth.ts` and 03 §3.3; 19 tables, 27 enums (incl. `currency`), 56 CORE CHECKs; the four currency columns
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P04 — Passwordless sign-in and route protection · [ ] to do
> 120 min · Depends on: P03 · Record: both admins in `ADMIN_EMAILS`, owner first (OQ-02 answer), what `user.name` holds after an OTP sign-up, the session helper names chosen
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

### P05 — Onboarding, fake payouts and the public creator page · [ ] to do
> 120 min · Depends on: P04 · Record: the length copy and proposed copy; for P06 and P34: the payouts banner component and copy, where the CAD fact line lives, `signUpCreator` options, `resolveOnboardingStep` signature, `ensureConnectedAccount` input, the registry exports (`paymentsDriver(currency)`, `CURRENCY_ACCOUNT_COUNTRY`, `CurrencyNotEnabledError`)
- Done:
- Verified:
- Decisions:
- Open questions:
- Follow-ups for later prompts:

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

## Owner answers (07 §4.1)

These are final. No prompt asks them again; each states the answer in one line (07 D63). "Changes the plan" rows are built by
D63–D92 (07 §7), for the 2026-10-16 rows (OQ-21, OQ-29 revised; OQ-39, OQ-40 new) by D93–D106 (07 §8), for OQ-41–OQ-48 by
D107–D131 (07 §9), and for OQ-34–OQ-38 and OQ-49–OQ-53 by D132–D143 (07 §10; it wins over §1–§9). On the exclusive and renewal rules
`docs/08-exclusive-renewals-owner-spec.md` wins.

| ID | Owner's answer | Changes the plan? | Status |
|---|---|---|---|
| OQ-01 | Neon, with `dev` and `test` branches | no | answered 2026-10-15 |
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

## Open questions

Every owner question (OQ-01–OQ-53) is answered (07 §4.1, §10). Open: Q-01–Q-03 (P02; defaults built, not blocking). Add new questions below the line with the next free number (Q-04,
Q-05, …); when one is answered, set its status to "answered (Pxx)" and add the answer to Decisions.

| ID | Question | Default if unanswered | Asked in | Status |
|---|---|---|---|---|
| | *New questions go below this line.* | | | |
| Q-01 | Sync-time wording between 1 hour and 1 day (04 §4.4 gives only "just now", "3 min", "3 days") | "Synced {n} h ago", then "Synced 1 day ago" / "Synced {n} days ago", rounded down | P02 | open (default built) |
| Q-02 | How the TabBar marks the current tab (color alone breaks 04 §12.1) | A 2 px ink bar above the icon, plus color and `aria-current` | P02 | open (default built) |
| Q-03 | Screen-reader label of the creator avatar menu button | "Account menu" | P02 | open (default built) |

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

The mapping is approximate. Each kit prompt's own text decides its scope.
