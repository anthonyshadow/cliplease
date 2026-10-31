// The dev clock for one request's deadline (02 §8.4, §11.1 step 9; 07 D51, D57): moves a waiting, unclaimed request's
// expires_at to 1 ms after its authorization, so it is overdue at once, then calls the expire-requests cron with the
// bearer, as Vercel Cron would (unless --no-cron), and prints one JSON line. Development and test only.
// tsx runs this file as CommonJS: no top-level await. Env is loaded first and the database client, which validates the
// environment (src/server/env.ts), is imported dynamically after the APP_ENV check. It imports only src/db/** and
// src/lib/** (nothing server-only), so it needs no --conditions=react-server. It never prints CRON_SECRET.
import { loadEnvConfig } from "@next/env";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { db as appDb } from "../src/db/client";
import { licenseRequest } from "../src/db/schema";
import { isUuid } from "../src/lib/validation/uuid";

export const USAGE = [
  "usage: bunx tsx scripts/dev-expire-request.ts <requestId> [--no-cron]",
  "  Moves a waiting, unclaimed request's expires_at to 1 ms after its authorization, then calls",
  "  /api/cron/expire-requests with CRON_SECRET; --no-cron leaves that call to you. Development and test only.",
].join("\n");

/** The flags it takes (P33a adds --checkout). */
const FLAGS: readonly string[] = ["--no-cron"];

export type DevExpireArgs = {
  requestId: string;
  /** Call the cron route after the update: false with --no-cron. */
  cron: boolean;
};

/** Why it must not run with `appEnv`, or null (07 D51). Checked before anything touches the database. */
export function devExpireRefusal(appEnv: string | undefined): string | null {
  return appEnv === "development" || appEnv === "test"
    ? null
    : `refusing to run with APP_ENV=${appEnv || "(unset)"}: development or test only (07 D51).`;
}

/** The arguments after the script's path: exactly one request id, and only known flags, in any order. Else null. */
export function parseDevExpireArgs(
  argv: readonly string[],
): DevExpireArgs | null {
  const flags = argv.filter((arg) => arg.startsWith("-"));
  const ids = argv.filter((arg) => !arg.startsWith("-"));
  if (flags.some((flag) => !FLAGS.includes(flag))) return null;
  if (ids.length !== 1 || !isUuid(ids[0])) return null;
  return { requestId: ids[0], cron: !flags.includes("--no-cron") };
}

type Writer = Pick<typeof appDb, "update">;

/**
 * Sets request `requestId`'s expires_at to authorized_at + 1 ms: already past, and license_request_expires_after_auth
 * and _hold_margin still hold. Only a waiting request nobody has claimed (an approve, decline or expiry in flight keeps
 * its deadline), and no other column but updated_at (Drizzle's update() sets it). The new deadline, or null when no
 * such request has that id.
 */
export async function forceOverdue(
  db: Writer,
  requestId: string,
): Promise<Date | null> {
  const [row] = await db
    .update(licenseRequest)
    .set({
      expiresAt: sql`${licenseRequest.authorizedAt} + interval '1 millisecond'`,
    })
    .where(
      and(
        eq(licenseRequest.id, requestId),
        eq(licenseRequest.status, "awaiting_approval"),
        isNull(licenseRequest.paymentAction),
        isNotNull(licenseRequest.authorizedAt),
      ),
    )
    .returning({ expiresAt: licenseRequest.expiresAt });
  return row?.expiresAt ?? null;
}

/** The route's 200: its three counts, and any a later step adds (P19b, P19c, P33a). */
const CronCounts = z.looseObject({
  expired: z.int().min(0),
  reconciled: z.int().min(0),
  emailsSent: z.int().min(0),
});
type CronCounts = z.infer<typeof CronCounts>;

/** GET /api/cron/expire-requests with the bearer: its counts, or why not (a line that never holds the secret). */
async function callCron(
  appUrl: string,
  secret: string,
): Promise<{ ok: true; counts: CronCounts } | { ok: false; error: string }> {
  const url = `${appUrl}/api/cron/expire-requests`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
    });
  } catch {
    return { ok: false, error: `couldn't reach ${url} (is the app running?)` };
  }
  // Read in every case, so no response is left open.
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, error: `${url} answered HTTP ${response.status}` };
  }
  const counts = CronCounts.safeParse(body);
  return counts.success
    ? { ok: true, counts: counts.data }
    : { ok: false, error: `${url} answered without its counts` };
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const refusal = devExpireRefusal(process.env.APP_ENV);
  if (refusal) {
    process.stderr.write(`dev-expire-request: ${refusal}\n`);
    process.exitCode = 1;
    return;
  }
  const args = parseDevExpireArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const { db, pool } = await import("../src/db/client");
  try {
    const expiresAt = await forceOverdue(db, args.requestId);
    if (!expiresAt) {
      process.stderr.write(
        `dev-expire-request: nothing to do: ${args.requestId} isn't a waiting, unclaimed request.\n`,
      );
      process.exitCode = 1;
      return;
    }
    let cron: CronCounts | null = null;
    if (args.cron) {
      // Both set and valid: importing the client validated the environment (src/server/env.ts).
      const { APP_URL = "", CRON_SECRET = "" } = process.env;
      const answer = await callCron(APP_URL, CRON_SECRET);
      if (!answer.ok) {
        process.stderr.write(
          `dev-expire-request: ${args.requestId} is overdue now, but ${answer.error}.\n`,
        );
        process.exitCode = 1;
        return;
      }
      cron = answer.counts;
    }
    process.stdout.write(
      `${JSON.stringify({ requestId: args.requestId, expiresAt, cron })}\n`,
    );
  } finally {
    await pool.end();
  }
}

// Run directly by tsx (CommonJS); the unit test imports the argument rules, and the [int] test forceOverdue.
if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `dev-expire-request failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
