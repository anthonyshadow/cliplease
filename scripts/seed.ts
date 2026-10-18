// The one seed (03 §8.1, 07 D53, D88): `bun run db:seed` gives every ADMIN_EMAILS user role 'admin', or creates
// seed_user_admin when none of them has signed in yet. It runs under `--conditions=react-server`, so audit.ts's server
// guard import resolves to an empty module. tsx runs this file as CommonJS: no top-level await. Env is loaded first and
// every app module is imported dynamically after it, because importing src/server/env.ts validates the environment.
import { loadEnvConfig } from "@next/env";

const SEED_ADMIN_ID = "seed_user_admin";
const FALLBACK_ADMIN_EMAIL = "admin@example.com";

export type SeedOptions = { appEnv: string | undefined; demo: boolean };
export type SeedResult = { promoted: number; created: boolean };

/** Why the seed must not run with these options, or null. Checked before anything touches env or the database. */
export function seedRefusal({ appEnv, demo }: SeedOptions): string | null {
  if (appEnv === "production") {
    return "refusing to run with APP_ENV=production (07 D51).";
  }
  if (demo) return "--demo is not built yet.";
  return null;
}

/**
 * Promotes the listed users that aren't admins yet; when no listed address has a user, creates seed_user_admin with the
 * first one (the owner, 07 D88). One `seed.applied` audit row when something changed, so a second run writes nothing.
 * Throws on a refusal; never ends the pool (main does).
 */
export async function runSeed(options: SeedOptions): Promise<SeedResult> {
  const refusal = seedRefusal(options);
  if (refusal) throw new Error(refusal);
  const { and, eq, inArray, ne } = await import("drizzle-orm");
  const { db } = await import("../src/db/client");
  const { user } = await import("../src/db/schema");
  const { writeAudit } = await import("../src/server/audit");
  const { env } = await import("../src/server/env");

  const emails =
    env.ADMIN_EMAILS.length > 0 ? env.ADMIN_EMAILS : [FALLBACK_ADMIN_EMAIL];
  return db.transaction(async (tx) => {
    const promoted = await tx
      .update(user)
      .set({ role: "admin" })
      .where(and(inArray(user.email, emails), ne(user.role, "admin")))
      .returning({ id: user.id });
    const [listed] = await tx
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.email, emails))
      .limit(1);
    const created = !listed;
    if (created) {
      const [taken] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, SEED_ADMIN_ID));
      if (taken) {
        throw new Error(
          `${SEED_ADMIN_ID} exists with an address that is no longer listed: put it back in ADMIN_EMAILS, or have a listed admin sign in first.`,
        );
      }
      await tx.insert(user).values({
        id: SEED_ADMIN_ID,
        name: "",
        email: emails[0],
        emailVerified: true,
        role: "admin",
      });
    }
    const changedId = created ? SEED_ADMIN_ID : promoted[0]?.id;
    if (changedId) {
      await writeAudit(
        tx,
        { kind: "system", source: "seed" },
        {
          action: "seed.applied",
          entityType: "user",
          entityId: changedId,
          data: { promoted: promoted.length, created },
        },
      );
    }
    return { promoted: promoted.length, created };
  });
}

function summary({ promoted, created }: SeedResult): string {
  const parts = [
    promoted > 0
      ? `promoted ${promoted} admin${promoted === 1 ? "" : "s"}`
      : "",
    created
      ? `created ${SEED_ADMIN_ID} with the first ADMIN_EMAILS address`
      : "",
  ].filter(Boolean);
  return `db:seed: ${parts.length > 0 ? parts.join(", ") : "nothing to change"}.`;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const options: SeedOptions = {
    appEnv: process.env.APP_ENV,
    demo: process.argv.slice(2).includes("--demo"),
  };
  const refusal = seedRefusal(options);
  if (refusal) {
    process.stderr.write(`db:seed: ${refusal}\n`);
    process.exitCode = 1;
    return;
  }
  const { pool } = await import("../src/db/client");
  const { redact } = await import("../src/lib/redact");
  try {
    process.stdout.write(`${summary(await runSeed(options))}\n`);
  } catch (error) {
    // Redacted: a query error carries its parameters (emails) in its message.
    process.stderr.write(`db:seed failed: ${JSON.stringify(redact(error))}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// Run directly by tsx (CommonJS); the [int] test imports runSeed instead.
if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `db:seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
