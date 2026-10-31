This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Bun 1.4.3 installs packages and runs scripts; Node 24 runs the app (see `AGENTS.md` §9). Install, then run the development server:

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the landing page by modifying `src/app/(public)/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to load Inter (`src/app/fonts.ts`); Apple devices render the system font first (docs/04-design-system.md §4.1).

## Local development

Vercel Cron doesn't run locally, so call the cron route yourself. With `bun run dev` running:

```bash
export CRON_SECRET="$(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)"   # expects an unquoted value; never paste it anywhere
curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/expire-requests
```

Without the bearer the route answers 401. With it, it reconciles payment claims stuck for more than 10 minutes, expires the overdue requests, sends the creator transfers a crash or a retry left pending, retries auto-approvals that didn't finish (they fall back to manual approval after 10 minutes), and retries the email outbox, then answers 200 with `Cache-Control: no-store` and the counts: `{"expired":…,"reconciled":…,"moneyMovements":…,"autoApprovals":…,"emailsSent":…}`. Use `-i` to see the status and headers, never `-v`: it prints the request headers, the secret among them.

### Force a request overdue

```bash
bunx tsx scripts/dev-expire-request.ts <requestId> [--no-cron]
```

Development and test only: it refuses any other `APP_ENV`. It moves only that request's `expires_at`, to 1 ms after its authorization, and only while the request is waiting with no approve, decline or expiry in flight. Then it calls the cron route above and prints one JSON line, `{"requestId":…,"expiresAt":…,"cron":{…}}`; `--no-cron` leaves that call to you (`"cron":null`). A request it can't move prints "nothing to do" and exits 1. `env -u CRON_SECRET NODE_ENV=test bunx tsx scripts/dev-expire-request.ts …` loads `.env.test.local` and `.env.test` instead of `.env.local`, so it targets the test database and the e2e app (`env -u` drops a `CRON_SECRET` exported above: a variable already in the shell wins over the env files).

The expired request's copy then names its authorization time as the deadline. An Inbox or request page open in another tab may expire it first (lazy expiry): the cron then reports `"expired":0`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
