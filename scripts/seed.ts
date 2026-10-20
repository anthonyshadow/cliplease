// The one seed (03 §8.1, 07 D53, D88): `bun run db:seed` gives every ADMIN_EMAILS user role 'admin', or creates
// seed_user_admin when none of them has signed in yet; `--demo` also adds creator @maya with a synced Demo account (P09).
// It runs under `--conditions=react-server`, so the server guard import resolves to an empty module. tsx runs this file
// as CommonJS: no top-level await. Env is loaded first and every module that reads it (the client, env.ts and the server
// modules) is imported dynamically after it, because importing src/server/env.ts validates the environment.
import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import type { db as appDb } from "../src/db/client";
import {
  creatorProfile,
  rateCard,
  rateOption,
  socialAccount,
  user,
} from "../src/db/schema";
import type { Currency } from "../src/lib/domain/values";
import {
  DEFAULT_BASE_PRICE_CENTS,
  defaultRateOptions,
} from "../src/lib/pricing/presets";
import { DAY_MS, HOUR_MS } from "../src/lib/time";
import type { MockSocialScenario, PaymentsDriverName } from "../src/server/env";
import type {
  ListPostsResult,
  SocialPost,
  SocialProfile,
  TokenSet,
} from "../src/server/social/types";

const SEED_ADMIN_ID = "seed_user_admin";
const FALLBACK_ADMIN_EMAIL = "admin@example.com";

// The demo creator's fixed rows (03 §8.1). Her Demo account id derives from the user id (07 D36): mock_acct_c4180ab2.
const MAYA = {
  userId: "seed_user_maya",
  email: "maya@example.com",
  name: "Maya R.",
  handle: "maya",
  creatorId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000011",
  currency: "cad",
} as const;
const DEMO_PATHS = ["/@maya", "/dashboard/library"] as const;
const START_OVER = "reset the dev database to start over (03 §8.1)";

type Tx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];

export type SeedOptions = { appEnv: string | undefined; demo: boolean };
/** What --demo added: all false and 0 when @maya was already seeded. */
export type DemoResult = {
  userCreated: boolean;
  profileCreated: boolean;
  rateOptionsAdded: number;
  accountCreated: boolean;
  postsAdded: number;
};
export type SeedResult = {
  promoted: number;
  created: boolean;
  demo?: DemoResult;
};

/** Why the seed must not run in `appEnv`, or null. Checked before anything touches env or the database. */
export function seedRefusal(appEnv: string | undefined): string | null {
  return appEnv === "production"
    ? "refusing to run with APP_ENV=production (07 D51)."
    : null;
}

export type DemoChecks = {
  currencies: readonly Currency[];
  mockEnabled: boolean;
  scenario: MockSocialScenario;
};

/** Why --demo can't seed @maya in this environment, or null. Checked after env loads, before any write. */
export function demoRefusal({
  currencies,
  mockEnabled,
  scenario,
}: DemoChecks): string | null {
  if (!currencies.includes(MAYA.currency)) {
    return "--demo needs ENABLED_CURRENCIES to contain cad (Maya's payout currency, 07 D94).";
  }
  if (!mockEnabled) {
    return "--demo needs ENABLED_SOCIAL_PROVIDERS to contain mock.";
  }
  // Every other scenario lists 0 or 23 posts, or fails.
  if (scenario !== "default") {
    return `--demo needs MOCK_SOCIAL_SCENARIO=default, not ${scenario}.`;
  }
  return null;
}

/** Maya's payouts (03 §8.1): the fake driver's account (it names them acct_fake_<creatorId>), active; none with Stripe. */
export function mayaPayoutColumns(driver: PaymentsDriverName) {
  return driver === "fake"
    ? {
        stripeAccountId: `acct_fake_${MAYA.creatorId}`,
        payoutsStatus: "active" as const,
      }
    : { stripeAccountId: null, payoutsStatus: "not_started" as const };
}

/** Maya's Demo account as the mock adapter reports it: read before the transaction, which then only writes. */
type DemoSource = {
  externalAccountId: string;
  profile: SocialProfile;
  tokens: TokenSet;
  posts: SocialPost[];
  payments: PaymentsDriverName;
};

async function readDemoSource(now: Date): Promise<DemoSource> {
  const { env } = await import("../src/server/env");
  const { getProvider } = await import("../src/server/social/registry");
  const { currentMockScenario, mockAccountIdFor, mockProvider, mockTokensFor } =
    await import("../src/server/social/providers/mock");
  const { isKeptVideo } = await import("../src/server/social/sync");
  const refusal = demoRefusal({
    currencies: env.ENABLED_CURRENCIES,
    mockEnabled: getProvider("mock") !== null,
    scenario: currentMockScenario(),
  });
  if (refusal) throw new Error(refusal);

  const tokens: TokenSet = {
    ...mockTokensFor(MAYA.userId, "seed"),
    accessTokenExpiresAt: new Date(now.getTime() + HOUR_MS),
    refreshTokenExpiresAt: new Date(now.getTime() + 30 * DAY_MS),
  };
  const posts: SocialPost[] = [];
  let cursor: string | null = null;
  do {
    const page: ListPostsResult = await mockProvider.listPosts(
      tokens.accessToken,
      { cursor },
    );
    posts.push(...page.posts.filter(isKeptVideo));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return {
    externalAccountId: mockAccountIdFor(MAYA.userId),
    profile: await mockProvider.getProfile(tokens.accessToken),
    tokens,
    posts,
    payments: env.PAYMENTS_DRIVER,
  };
}

/**
 * Promotes the listed users that aren't admins yet; when no listed address has a user, creates seed_user_admin with the
 * first one (the owner, 07 D88). Returns the promoted ids.
 */
async function seedAdmins(
  tx: Tx,
): Promise<{ promoted: string[]; created: boolean }> {
  const { env } = await import("../src/server/env");
  const emails =
    env.ADMIN_EMAILS.length > 0 ? env.ADMIN_EMAILS : [FALLBACK_ADMIN_EMAIL];
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
  return { promoted: promoted.map((row) => row.id), created };
}

/**
 * Throws when one of Maya's keys (her id or address, the handle, her profile or account ids, her Demo account live
 * elsewhere) belongs to another row: a clear refusal, never a raw unique violation (P04). Returns whether Maya's Demo
 * account exists already.
 */
async function checkDemoKeys(
  tx: Tx,
  externalAccountId: string,
): Promise<boolean> {
  const users = await tx
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(or(eq(user.id, MAYA.userId), eq(user.email, MAYA.email)));
  if (users.some((u) => u.id !== MAYA.userId)) {
    throw new Error(
      `--demo: Maya's address belongs to a user other than ${MAYA.userId}: ${START_OVER}.`,
    );
  }
  if (users.some((u) => u.email !== MAYA.email)) {
    throw new Error(
      `--demo: ${MAYA.userId} exists with another address: ${START_OVER}.`,
    );
  }

  const profiles = await tx
    .select({
      id: creatorProfile.id,
      userId: creatorProfile.userId,
      handle: creatorProfile.handle,
    })
    .from(creatorProfile)
    .where(
      or(
        eq(creatorProfile.id, MAYA.creatorId),
        eq(creatorProfile.userId, MAYA.userId),
        eq(creatorProfile.handle, MAYA.handle),
      ),
    );
  const stray = profiles.find(
    (p) =>
      p.id !== MAYA.creatorId ||
      p.userId !== MAYA.userId ||
      p.handle !== MAYA.handle,
  );
  if (stray) {
    throw new Error(
      stray.handle === MAYA.handle && stray.userId !== MAYA.userId
        ? `--demo: the handle ${MAYA.handle} belongs to another creator: ${START_OVER}.`
        : `--demo: creator ${MAYA.creatorId} or ${MAYA.userId}'s profile is not the seed's @${MAYA.handle}: ${START_OVER}.`,
    );
  }

  const accounts = await tx
    .select({
      id: socialAccount.id,
      creatorId: socialAccount.creatorId,
      provider: socialAccount.provider,
      providerAccountId: socialAccount.providerAccountId,
      status: socialAccount.status,
    })
    .from(socialAccount)
    .where(
      or(
        eq(socialAccount.id, MAYA.accountId),
        and(
          eq(socialAccount.provider, "mock"),
          eq(socialAccount.providerAccountId, externalAccountId),
        ),
      ),
    );
  const own = accounts.some(
    (a) =>
      a.creatorId === MAYA.creatorId &&
      a.provider === "mock" &&
      a.providerAccountId === externalAccountId,
  );
  if (own) return true;
  if (accounts.some((a) => a.id === MAYA.accountId)) {
    throw new Error(
      `--demo: social_account ${MAYA.accountId} is another account: ${START_OVER}.`,
    );
  }
  if (accounts.some((a) => a.status !== "disconnected")) {
    throw new Error(
      `--demo: ${externalAccountId} is linked to another creator: ${START_OVER}.`,
    );
  }
  return false;
}

/**
 * Maya's rows (03 §8.1), each inserted only when it is missing (natural keys: user id, profile id, the rate card's
 * creator, (rate card, option key), (creator, provider, provider account)). An existing Demo account keeps its tokens
 * and posts as they are.
 */
async function seedMaya(
  tx: Tx,
  source: DemoSource,
  now: Date,
): Promise<DemoResult> {
  const accountExists = await checkDemoKeys(tx, source.externalAccountId);
  const { profileColumns } = await import("../src/server/social/link");
  const { sealTokenColumns } = await import("../src/server/social/tokens");
  const { upsertPosts } = await import("../src/server/social/sync");
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const users = await tx
    .insert(user)
    .values({
      id: MAYA.userId,
      name: MAYA.name,
      email: MAYA.email,
      emailVerified: true,
      role: "creator",
    })
    .onConflictDoNothing({ target: user.id })
    .returning({ id: user.id });
  // A profile is all the onboarding gate checks (requireCreator); user.name is set as onboarding sets it.
  const profiles = await tx
    .insert(creatorProfile)
    .values({
      id: MAYA.creatorId,
      userId: MAYA.userId,
      handle: MAYA.handle,
      displayName: MAYA.name,
      ageConfirmedAt: daysAgo(10),
      timeZone: "UTC",
      approvalWindowHours: 72,
      autoApprove: false,
      payoutCurrency: MAYA.currency,
      ...mayaPayoutColumns(source.payments),
    })
    .onConflictDoNothing({ target: creatorProfile.id })
    .returning({ id: creatorProfile.id });
  await tx
    .insert(rateCard)
    .values({
      creatorId: MAYA.creatorId,
      basePriceCents: DEFAULT_BASE_PRICE_CENTS[MAYA.currency],
    })
    .onConflictDoNothing({ target: rateCard.creatorId });
  const [card] = await tx
    .select({ id: rateCard.id })
    .from(rateCard)
    .where(eq(rateCard.creatorId, MAYA.creatorId));
  const options = await tx
    .insert(rateOption)
    .values(defaultRateOptions().map((o) => ({ ...o, rateCardId: card.id })))
    .onConflictDoNothing({
      target: [rateOption.rateCardId, rateOption.optionKey],
    })
    .returning({ id: rateOption.id });
  const added = {
    userCreated: users.length > 0,
    profileCreated: profiles.length > 0,
    rateOptionsAdded: options.length,
  };
  if (accountExists) return { ...added, accountCreated: false, postsAdded: 0 };

  // The token AAD names the row id, so the tokens are sealed for the id the row gets.
  await tx.insert(socialAccount).values({
    id: MAYA.accountId,
    creatorId: MAYA.creatorId,
    provider: "mock",
    providerAccountId: source.externalAccountId,
    ...profileColumns(source.profile),
    ...sealTokenColumns(MAYA.accountId, source.tokens, now),
    status: "connected",
    connectedAt: daysAgo(3),
    lastSyncedAt: now,
    hasOlder: false,
  });
  const posts = await upsertPosts(
    tx,
    { id: MAYA.accountId, creatorId: MAYA.creatorId, provider: "mock" },
    source.posts,
    now,
  );
  return { ...added, accountCreated: true, postsAdded: posts.added };
}

const demoChanged = (d: DemoResult) =>
  d.userCreated ||
  d.profileCreated ||
  d.rateOptionsAdded > 0 ||
  d.accountCreated;

/**
 * The admin roles, plus @maya with `demo`, in one transaction. One `seed.applied` audit row (counts only) when something
 * changed, so a second run writes nothing. Throws on a refusal, writing nothing; never ends the pool (main does).
 */
export async function runSeed(options: SeedOptions): Promise<SeedResult> {
  const refusal = seedRefusal(options.appEnv);
  if (refusal) throw new Error(refusal);
  const { db } = await import("../src/db/client");
  const { writeAudit } = await import("../src/server/audit");
  const now = new Date();
  const source = options.demo ? await readDemoSource(now) : null;
  return db.transaction(async (tx) => {
    const admins = await seedAdmins(tx);
    const demo = source ? await seedMaya(tx, source, now) : undefined;
    const result: SeedResult = {
      promoted: admins.promoted.length,
      created: admins.created,
      ...(demo ? { demo } : {}),
    };
    const changedId = admins.created
      ? SEED_ADMIN_ID
      : (admins.promoted[0] ??
        (demo && demoChanged(demo) ? MAYA.userId : undefined));
    if (changedId) {
      await writeAudit(
        tx,
        { kind: "system", source: "seed" },
        {
          action: "seed.applied",
          entityType: "user",
          entityId: changedId,
          data: result,
        },
      );
    }
    return result;
  });
}

function demoSummary(d: DemoResult): string {
  if (!demoChanged(d)) return "@maya already seeded";
  return d.accountCreated
    ? `seeded @maya (${d.postsAdded} posts)`
    : "seeded @maya (kept its Demo account)";
}

function summary({ promoted, created, demo }: SeedResult): string {
  const parts = [
    promoted > 0
      ? `promoted ${promoted} admin${promoted === 1 ? "" : "s"}`
      : "",
    created
      ? `created ${SEED_ADMIN_ID} with the first ADMIN_EMAILS address`
      : "",
    demo ? demoSummary(demo) : "",
  ].filter(Boolean);
  return `db:seed: ${parts.length > 0 ? parts.join(", ") : "nothing to change"}.`;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const options: SeedOptions = {
    appEnv: process.env.APP_ENV,
    demo: process.argv.slice(2).includes("--demo"),
  };
  const refusal = seedRefusal(options.appEnv);
  if (refusal) {
    process.stderr.write(`db:seed: ${refusal}\n`);
    process.exitCode = 1;
    return;
  }
  const { pool } = await import("../src/db/client");
  const { redact } = await import("../src/lib/redact");
  try {
    const result = await runSeed(options);
    process.stdout.write(`${summary(result)}\n`);
    if (result.demo) {
      const { env } = await import("../src/server/env");
      process.stdout.write(
        DEMO_PATHS.map((path) => `${env.APP_URL}${path}\n`).join(""),
      );
    }
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
