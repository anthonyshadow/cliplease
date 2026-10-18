Plan kit: `/Users/anthonyshadowitz/Documents/ClipLease/mvp-plan` (`../../mvp-plan` from this repo). Doc paths in prompts are relative to it.

# AGENTS.md — ClipLease: operating rules for the implementation agent

You are building the **ClipLease** MVP prototype one prompt at a time. These rules apply to every
prompt in `prompts/`. P00 copies this file to the root of the app repository,
`/Users/anthonyshadowitz/Documents/ClipLease/App/ClipLease` (as `AGENTS.md`, and symlinks or copies it to `CLAUDE.md` if your
tool reads that name). The plan kit is `/Users/anthonyshadowitz/Documents/ClipLease/mvp-plan` (`../../mvp-plan` from the app).

## 1. Order of authority
1. The human's instructions in chat.
2. This file.
3. The current prompt (`prompts/Pxx-*.md`).
4. `docs/07-decisions.md` (the decision register), then the other plan docs in `docs/` and `00-brief.md`
   (product spec, architecture, database, design system, wireframes, flows).
5. Your own judgment — only for details none of the above decide, and you say what you decided.

If two sources disagree, do not pick one silently. A conflict that `docs/07-decisions.md` already settles is not
a stop: follow 07 and note it in PROGRESS.md. Any other conflict: stop and ask (see §4).
On a product rule for exclusive licenses, renewals, renewal pricing, reservations, renewal notifications or customer control,
`docs/08-exclusive-renewals-owner-spec.md` (the owner spec) wins over 07; a conflict between them is a stop (07 §9).

## 2. The loop — run it for every prompt, in this order

**Step 0 — Prove the previous prompt is done.**
- Read `PROGRESS.md`. Confirm the previous prompt is marked done and has no unresolved blockers.
- Run the previous prompt's **Verify** commands (typecheck, lint, tests, and any URL checks it lists).
- Re-check its **Acceptance criteria** against the code. Open the files; don't trust the log alone.
- If anything fails or is missing: **stop**. Report what failed (command + output excerpt), propose the
  smallest fix, and ask whether to fix it now or continue. Do not start the new prompt on a broken base.

**Step 1 — Ask before you start.**
- Read the prompt's "Ask before you start" list and the "Read first" docs.
- If any answer is needed to do the work correctly (keys, accounts, names, money, security, unclear UX),
  ask now, all questions in one message, in the format in §4. Wait for answers.
- If no answers are needed, write one line: "No blocking questions. Assumptions: …".

**Step 2 — Plan.** Post a short plan (≤10 bullets): files you'll create/change, tests you'll add,
anything risky. Keep it inside the prompt's scope.

**Step 3 — Build.** Do only the prompt's Tasks. Respect its "Out of scope". Small, reviewable changes.

**Step 4 — Verify.** Run every command in the prompt's Verify section. Fix failures. Then check each
acceptance criterion and mark it ✅ or ❌ with evidence (command output, file path, URL).

**Step 5 — Wrap up.** Update `PROGRESS.md` (format in §6). Commit with message `Pxx: <title>`.
Report back: what changed, how you verified it, decisions you made, open questions, and the next prompt.

## 3. Always stop and ask when…
- A credential, API key, account, domain or paid service is needed (never invent or reuse keys).
- A choice affects **money**: prices, fees, rounding, refunds, payouts, capture/cancel behavior.
- A choice affects **security or privacy**: auth rules, who can see what, tokens, PII, signed URLs.
- Naming or brand: product name, handles, URLs, copy that isn't in the docs.
- You'd add a dependency that isn't in `docs/02-architecture.md`, or change a pinned major version.
- A package needs its install script to run (`bun pm untrusted` lists it): ask before `bun pm trust <pkg>` (§9 R4).
- You'd change the database schema beyond what the prompt asks.
- You'd delete files, drop tables, rewrite migrations, or force-push.
- The previous prompt's verification fails, or docs conflict, or the prompt is ambiguous.
- The work is heading past 2× the prompt's estimated effort.

## 4. How to ask
Ask all questions at once, numbered, each with options and your recommendation:

```
Q1. Which Postgres host should I connect for local dev?
    a) Neon dev branch (recommended — matches production, no Docker)
    b) Local Docker Postgres
    c) Something else
```
Then wait. Don't proceed on a guess for anything in §3.

## 5. Never
- Never use live Stripe keys or real card numbers. Test mode only. Never log secrets.
- Never trust a price, fee or total sent from the browser. Recompute on the server with `computeQuote`.
- Never expose an original video's storage key or a long-lived URL publicly. Signed, short-lived URLs only.
- Never log, print or return social-platform OAuth tokens. Store them only encrypted. Request read-only scopes;
  never post or act on a creator's social account.
- Never call real platform APIs from tests. Tests and CI use the `mock` social provider.
- Never change a license request's status outside the state-machine functions.
- Never capture or cancel a PaymentIntent without an idempotency key.
- Never call the `PaymentsDriver` (Stripe or fake) inside `db.transaction`. Claim the row, commit, then call out.
- Never fetch, HEAD, oEmbed or redirect-resolve a URL a user pasted; parse it and match by id (07 D67). Never render a pasted
  URL in `<img>` or `<iframe>`; platform APIs are called only with the extracted id against fixed hosts.
- Transfers, refunds and reversals use the claim → call → fenced finish pattern (07 D75); never inside `db.transaction`.
- Never download or import video from a platform: creators always upload the original (07 D64).
- Never re-ask an owner question that `docs/07-decisions.md` §4.1 answers; state the answer in one line (07 D63).
- Never hard-code a currency or print a bare `$`: money is integer minor units plus a `currency`, shown only with `formatMoney(cents, currency)`, and every Stripe call goes through `paymentsDriver(currency)` (07 D95, D98).
- Creators must be 18 or older; never ask for or store a date of birth (07 D93).
- Never create, authorize or approve a license request without `lockVideoForLicensing` and `getLicenseAvailability` in the same transaction (07 D110).
- Never charge a renewal without the buyer's recorded consent, never above the agreed or explicitly accepted amount, and never treat silence as acceptance (07 D114, D119).
- Never weaken TypeScript (`any`, `@ts-ignore`, `skipLibCheck` changes) to make errors go away.
- Never mark acceptance criteria done without running the checks.
- Never hard-code colors, font sizes or radii in components; use the design tokens.

## 6. PROGRESS.md format
```
# Progress

## Status
Current prompt: P07 · Last verified: P06 · Blockers: none

## Log
### P06 — Rate card editor ✅ (2026-10-20)
- Done: …
- Verified: bun run typecheck ✅ · bun run test (14 passed) ✅ · /dashboard/pricing manual check ✅
- Decisions: …
- Open questions: …
- Follow-ups for later prompts: …
```

## 7. Definition of done (every prompt)
- `bun run typecheck`, `bun run lint` and `bun run test` pass with zero errors.
- Every acceptance criterion is ✅ with evidence.
- New pure logic has unit tests; new and changed pages render without console errors at 375, 768, 1024, 1280 and 1920 px (plus a 2560 px spot check), in light and dark, with no horizontal scroll at any width from 320 to 2560, and follow the four layout tiers of docs/04 §5.2 (Mobile < 768 · Tablet `md:` · Desktop `lg:` · XL `2xl:`).
- Light and dark themes both look right for anything you touched.
- `PROGRESS.md` updated and work committed.

## 8. Code standards
- TypeScript `strict`. Validate every boundary (forms, route handlers, webhooks, env) with Zod.
- Server-only code lives in `src/server` and imports `server-only`. No DB or secret access from client components.
  Documented exceptions (docs/02-architecture.md ADR-34, 07 D06): `src/db/**`, `src/server/env.ts` and the Better Auth
  config are loaded by CLI tools (drizzle-kit, the Better Auth CLI), so they must not import `server-only`; never import
  them from client code.
- Pinned versions in `docs/02-architecture.md` are deliberate (several are security pins). Don't upgrade or
  downgrade without asking. The Drizzle docs site shows the 1.0 RC API by default; this project uses 0.45.x syntax.
- Money is integer minor units (cents for CAD and USD) with its `currency`; multipliers are integer basis points. One pricing function, shared.
- Components use design tokens and the primitives listed in `docs/04-design-system.md`.
- Accessible by default: labels, focus rings, keyboard paths, 44 px touch targets at every tier (touch is not a tier: use `pointer-coarse:`, never a tier prefix), reduced-motion support.
- Layout switches only at base, `md:`, `lg:` and `2xl:` (XL is `2xl:`; never `sm:`, `xl:`, `min-[…]:`, `max-[…]:` or `@container`). Layout boxes are `w-full` plus a `max-w-*` cap. Never `100vw`, `w-screen` or `overflow-x: hidden` on a page root.
- Small files, clear names, no dead code, no commented-out code.

## 9. Version gotchas (07 D58, D107)
- Bun 1.4.3 is the package manager and script runner only (07 D107; security EXCEPTION, fallback 1.4.2, floor 1.4.1).
  - **R1:** always the long form `bun run <script>` (`bun run test`, `bun run build`, `bun run test:int`, `bun run test:e2e` …). Bare `bun test` runs Bun's own test runner and bare `bun build` runs Bun's bundler; neither is ever used.
  - **R2:** Node 24 executes the app, Vitest, Playwright and every CLI (through `bunx`, on their Node shebangs). Never `--bun`, `bunx --bun`, `bun run --bun`, `bunVersion`, `bun:*` imports, `Bun.*` APIs, `drizzle-orm/bun-sql` or `Bun.s3`.
  - **R3:** `bunfig.toml` holds `env = false` (Next's `@next/env` is the only `.env*` loader), `[install] exact = true` and `linker = "hoisted"`.
  - **R4:** `"trustedDependencies": []`. If a package needs its install script, list it with `bun pm untrusted` and ask before `bun pm trust <pkg>`.
  - `bun.lock` is the only lockfile and is committed (never `bun.lockb`). CI installs with `bun ci`.
- Stripe webhooks: verify with `await stripe.webhooks.constructEventAsync(...)` and sign [int] test payloads with `generateTestHeaderStringAsync` (07 D107); `parseWebhook` returns a Promise.
- Next.js 16: `proxy.ts`, not `middleware.ts`. Keep `cacheComponents: false` and don't use `'use cache'`. Keep the Next-managed block in AGENTS.md.
  Read `node_modules/next/dist/docs` before using a Next API you haven't used in this repo.
- Zod 4: top-level `z.email()`, `z.uuid()`, `z.url()`, with `{ error }` for messages.
- Stripe API `2026-09-30.endive`: Checkout uses `allowed_payment_method_types`.
- shadcn: always `bunx shadcn@4.21.1 … -b radix`. lucide-react v1 has no brand icons: platform marks are listed in
  `PLATFORM_MARKS` (`src/lib/brand.ts`) with the official files in `public/brand/`.
- Biome, not ESLint; `next lint` is gone. Tailwind v4 `@theme` in `globals.css`; there is no `tailwind.config`.
- Drizzle 0.45: the table's third argument is an array; ignore the 1.0 RC syntax shown by default on the docs site.
- Better Auth CLI: `bunx auth@1.7.7 …`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
