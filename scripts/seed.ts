// The one seed (03 §8.1, 07 D53, D88): `bun run db:seed` gives every ADMIN_EMAILS user role 'admin', or creates
// seed_user_admin when none of them has signed in yet; `--demo` also adds creator @maya with a synced Demo account (P09)
// and her published Library video "First snow" from the test fixtures (P14b).
// It runs under `--conditions=react-server`, so the server guard import resolves to an empty module. tsx runs this file
// as CommonJS: no top-level await. Env is loaded first and every module that reads it (the client, env.ts and the server
// modules) is imported dynamically after it, because importing src/server/env.ts validates the environment.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import type { db as appDb } from "../src/db/client";
import {
  creatorProfile,
  rateCard,
  rateOption,
  socialAccount,
  socialPost,
  user,
  video,
  videoPosting,
} from "../src/db/schema";
import type { Currency } from "../src/lib/domain/values";
import { LIBRARY_PATH } from "../src/lib/library/filter";
import {
  DEFAULT_BASE_PRICE_CENTS,
  defaultRateOptions,
} from "../src/lib/pricing/presets";
import { DAY_MS, HOUR_MS } from "../src/lib/time";
import { ORIGINAL_MIME, POSTER_MIME } from "../src/lib/upload/limits";
import { creatorUrl, videoUrl } from "../src/lib/urls";
import { verifiedAs } from "../src/lib/videos/ownership";
import type { MockSocialScenario, PaymentsDriverName } from "../src/server/env";
import type {
  ListPostsResult,
  SocialPost,
  SocialProfile,
  TokenSet,
} from "../src/server/social/types";
import type { ObjectStorage } from "../src/server/storage/index";
import { originalKey, posterKey } from "../src/server/storage/keys";

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
// Her published Library video V1 and its source posting (03 §8.1, 07 D53, D65): Demo post 01, from the fixtures.
const V1 = {
  id: "00000000-0000-4000-8000-000000000101",
  postingId: "00000000-0000-4000-8000-000000000201",
  post: "mock_post_c4180ab2_01",
  slug: "first-snow",
  title: "First snow",
  fileName: "first-snow.mp4",
  durationMs: 14_000,
  width: 720,
  height: 1280,
} as const;
const FIXTURES = {
  original: "tests/fixtures/sample.mp4",
  poster: "tests/fixtures/poster.jpg",
} as const;
const DEMO_PATHS = [
  creatorUrl(MAYA.handle),
  videoUrl(MAYA.handle, V1.slug),
  LIBRARY_PATH,
] as const;
const START_OVER = "reset the dev database to start over (03 §8.1)";

type Tx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];
type Reader = Pick<typeof appDb, "select">;

export type SeedOptions = {
  appEnv: string | undefined;
  demo: boolean;
  /** Where --demo stores V1's files: storage() unless a test gives its own driver. */
  storage?: ObjectStorage;
};
/** What --demo added: all false and 0 when @maya was already seeded. */
export type DemoResult = {
  userCreated: boolean;
  profileCreated: boolean;
  rateOptionsAdded: number;
  accountCreated: boolean;
  postsAdded: number;
  /** V1 "First snow" was inserted, published. */
  videoCreated: boolean;
  /** V1's files stored by this run: 2 with a new V1, 0 once both are there. */
  objectsUploaded: number;
};
type MayaResult = Omit<DemoResult, "videoCreated" | "objectsUploaded">;
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

/**
 * Maya's Demo account as the mock adapter reports it, and V1's files: read before the transaction, which then only
 * writes.
 */
type DemoSource = {
  externalAccountId: string;
  profile: SocialProfile;
  tokens: TokenSet;
  posts: SocialPost[];
  payments: PaymentsDriverName;
  files: { original: Uint8Array; poster: Uint8Array };
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
  // From the repo root, as `bun run db:seed` runs.
  const [original, poster] = await Promise.all(
    [FIXTURES.original, FIXTURES.poster].map((file) =>
      readFile(path.join(process.cwd(), file)),
    ),
  );
  return {
    externalAccountId: mockAccountIdFor(MAYA.userId),
    profile: await mockProvider.getProfile(tokens.accessToken),
    tokens,
    posts,
    payments: env.PAYMENTS_DRIVER,
    files: { original, poster },
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
): Promise<MayaResult> {
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

/**
 * V1's original status and stored keys, or null when V1 isn't there (`lock`: FOR UPDATE, in the transaction). Refuses a
 * row that holds V1's id or @maya's slug but isn't V1: a clear refusal, never a raw unique violation (P04).
 */
async function readDemoVideo(exec: Reader, { lock = false } = {}) {
  const query = exec
    .select({
      id: video.id,
      creatorId: video.creatorId,
      slug: video.slug,
      originalStatus: video.originalStatus,
      originalObjectKey: video.originalObjectKey,
      posterObjectKey: video.posterObjectKey,
    })
    .from(video)
    .where(
      or(
        eq(video.id, V1.id),
        and(eq(video.creatorId, MAYA.creatorId), eq(video.slug, V1.slug)),
      ),
    );
  const rows = await (lock ? query.for("update") : query);
  if (
    rows.some(
      (r) =>
        r.id !== V1.id || r.creatorId !== MAYA.creatorId || r.slug !== V1.slug,
    )
  ) {
    throw new Error(
      `--demo: video ${V1.id} or @${MAYA.handle}'s ${V1.slug} is another video: ${START_OVER}.`,
    );
  }
  return rows[0] ?? null;
}

/** Refuses when post 01 is verified on another video, Maya's (a draft made from the Library) or another creator's. */
async function refuseHeldPost(exec: Reader) {
  const { assertPostingAvailable } = await import(
    "../src/server/postings/ownership"
  );
  const { AlreadyLicensableElsewhereError, AlreadyOnYourVideoError } =
    await import("../src/server/postings/errors");
  try {
    await assertPostingAvailable(exec, {
      creatorId: MAYA.creatorId,
      videoId: V1.id,
      platform: "mock",
      linkKey: V1.post,
    });
  } catch (error) {
    if (
      error instanceof AlreadyOnYourVideoError ||
      error instanceof AlreadyLicensableElsewhereError
    ) {
      throw new Error(
        `--demo: ${V1.post} is already licensable on another video: ${START_OVER}.`,
      );
    }
    throw error;
  }
}

/** What storeDemoObjects found and did: V1's keys as read before it stored anything, and the keys it stored. */
type DemoObjects = {
  /** null when V1 wasn't there. */
  read: { original: string | null; poster: string | null } | null;
  /** A file stored by this run, null when the stored one is kept. */
  original: string | null;
  poster: string | null;
};

/**
 * V1's original and poster in `store` (07 D53): both for a new V1; for an existing one, a file whose object is gone is
 * stored again, the original only while it is `ready` (an upload in progress or failed is the creator's own). Always
 * under fresh keys (originalKey, posterKey), never over an existing one. Runs before the transaction (no storage call
 * inside one, 07 D12), after the refusals that need no transaction; every key it stores is pushed to `stored`, so a
 * later failure can delete them.
 */
async function storeDemoObjects(
  exec: Reader,
  store: ObjectStorage,
  files: DemoSource["files"],
  stored: string[],
): Promise<DemoObjects> {
  const row = await readDemoVideo(exec);
  if (!row) await refuseHeldPost(exec);
  const gone = async (key: string | null) =>
    key === null || (await store.head(key)) === null;
  const put = async (key: string, body: Uint8Array, contentType: string) => {
    await store.putSmall(key, body, contentType);
    stored.push(key);
    return key;
  };
  const [originalGone, posterGone] = await Promise.all([
    row ? row.originalStatus === "ready" && gone(row.originalObjectKey) : true,
    row ? gone(row.posterObjectKey) : true,
  ]);
  const [original, poster] = await Promise.all([
    originalGone
      ? put(
          originalKey(MAYA.creatorId, V1.id, "mp4"),
          files.original,
          ORIGINAL_MIME[0],
        )
      : null,
    posterGone ? put(posterKey(V1.id), files.poster, POSTER_MIME) : null,
  ]);
  return {
    read: row && {
      original: row.originalObjectKey,
      poster: row.posterObjectKey,
    },
    original,
    poster,
  };
}

/** The fixture original's columns (03 §8.1) at `key`. */
const fixtureOriginal = (key: string, bytes: number) =>
  ({
    originalStatus: "ready",
    originalObjectKey: key,
    originalBytes: bytes,
    originalMime: ORIGINAL_MIME[0],
    originalFilename: V1.fileName,
    durationMs: V1.durationMs,
    width: V1.width,
    height: V1.height,
  }) as const;

/**
 * V1 (03 §8.1): inserted published, its steps done two days ago, under both payments drivers (publishing needs no
 * payouts, 07 D74); an existing V1 only takes the files stored again (an original with the fixture's own columns). V1
 * is read again under its row lock: changed since storeDemoObjects read it, the run refuses (and its files go). Its
 * source posting …0201 is inserted when missing (by video and position), verified as createVideoFromPost writes it,
 * then auditNewlyVerified and refreshVideoOwnership set `verified_owner` (07 D66). Nothing changes on a second run.
 */
async function seedDemoVideo(
  tx: Tx,
  objects: DemoObjects,
  source: DemoSource,
  now: Date,
): Promise<boolean> {
  const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS);
  const row = await readDemoVideo(tx, { lock: true });
  const { read } = objects;
  const same =
    row && read
      ? row.originalObjectKey === read.original &&
        row.posterObjectKey === read.poster
      : !row && !read;
  if (!same) {
    throw new Error(
      `--demo: ${V1.title} changed while the seed ran: run it again.`,
    );
  }
  const bytes = source.files.original.byteLength;
  if (row) {
    if (objects.original || objects.poster) {
      await tx
        .update(video)
        .set({
          ...(objects.original
            ? {
                ...fixtureOriginal(objects.original, bytes),
                originalUpdatedAt: now,
              }
            : {}),
          ...(objects.poster ? { posterObjectKey: objects.poster } : {}),
        })
        .where(eq(video.id, V1.id));
    }
  } else {
    if (!objects.original || !objects.poster) {
      throw new Error("--demo: V1's files weren't stored.");
    }
    await refuseHeldPost(tx);
    await tx.insert(video).values({
      id: V1.id,
      creatorId: MAYA.creatorId,
      slug: V1.slug,
      title: V1.title,
      source: "library",
      // refreshVideoOwnership below sets it from the posting (07 D66).
      ownership: "self_attested",
      status: "published",
      publishedAt: twoDaysAgo,
      ...fixtureOriginal(objects.original, bytes),
      originalUpdatedAt: twoDaysAgo,
      posterObjectKey: objects.poster,
      posterOrigin: "frame_capture",
      postingsConfirmedAt: twoDaysAgo,
      sameVideoConfirmedAt: twoDaysAgo,
      containsMusic: false,
      identifiablePeople: false,
      rightsAttestedAt: twoDaysAgo,
      attestationVersion: "v1",
      createdAt: twoDaysAgo,
    });
  }
  const [posting] = await tx
    .select({ id: videoPosting.id })
    .from(videoPosting)
    .where(and(eq(videoPosting.videoId, V1.id), eq(videoPosting.position, 0)));
  if (!posting) await seedSourcePosting(tx, twoDaysAgo);
  return !row;
}

/** V1's source posting …0201 on post 01 (03 §8.1); refuses unless the post is listed and the account connected. */
async function seedSourcePosting(tx: Tx, verifiedAt: Date) {
  const { auditNewlyVerified, refreshVideoOwnership } = await import(
    "../src/server/postings/ownership"
  );
  const [post] = await tx
    .select({
      id: socialPost.id,
      status: socialPost.status,
      permalink: socialPost.permalink,
      linkKey: socialPost.linkKey,
    })
    .from(socialPost)
    .where(
      and(
        eq(socialPost.socialAccountId, MAYA.accountId),
        eq(socialPost.providerPostId, V1.post),
      ),
    );
  const [account] = await tx
    .select({
      status: socialAccount.status,
      username: socialAccount.username,
      displayName: socialAccount.displayName,
      connectedAt: socialAccount.connectedAt,
    })
    .from(socialAccount)
    .where(eq(socialAccount.id, MAYA.accountId));
  const verifiedUsername = account ? verifiedAs(account) : null;
  if (post?.status !== "available" || !account || !verifiedUsername) {
    throw new Error(
      `--demo: ${V1.post} isn't listed on Maya's connected Demo account: ${START_OVER}.`,
    );
  }
  await tx
    .insert(videoPosting)
    .values({
      id: V1.postingId,
      videoId: V1.id,
      creatorId: MAYA.creatorId,
      platform: "mock",
      url: post.permalink,
      linkKey: post.linkKey,
      verification: "verified",
      unverifiedReason: null,
      isSource: true,
      position: 0,
      socialAccountId: MAYA.accountId,
      socialPostId: post.id,
      verifiedUsername,
      verifiedAccountLinkedAt: account.connectedAt,
      verifiedAt,
      checkedAt: verifiedAt,
      showLink: true,
      createdAt: verifiedAt,
    })
    .onConflictDoNothing({
      target: [videoPosting.videoId, videoPosting.position],
    });
  await auditNewlyVerified(
    tx,
    { kind: "system", source: "seed" },
    V1.id,
    new Set(),
  );
  await refreshVideoOwnership(tx, V1.id);
}

const demoChanged = (d: DemoResult) =>
  d.userCreated ||
  d.profileCreated ||
  d.rateOptionsAdded > 0 ||
  d.accountCreated ||
  d.videoCreated ||
  d.objectsUploaded > 0;

/**
 * The admin roles, plus @maya and V1 with `demo`, in one transaction, after V1's files are stored (storeDemoObjects).
 * One `seed.applied` audit row (counts only) when something changed, so a second run writes nothing. Throws on a
 * refusal, writing nothing and deleting the files this run stored; never ends the pool (main does).
 */
export async function runSeed(options: SeedOptions): Promise<SeedResult> {
  const refusal = seedRefusal(options.appEnv);
  if (refusal) throw new Error(refusal);
  const { db } = await import("../src/db/client");
  const { writeAudit } = await import("../src/server/audit");
  const now = new Date();
  const source = options.demo ? await readDemoSource(now) : null;
  const store = source
    ? (options.storage ??
      (await import("../src/server/storage/index")).storage())
    : null;
  // V1's files stored by this run: deleted again when the run fails.
  const stored: string[] = [];
  try {
    const objects =
      source && store
        ? await storeDemoObjects(db, store, source.files, stored)
        : null;
    return await db.transaction(async (tx) => {
      const admins = await seedAdmins(tx);
      const demo =
        source && objects
          ? {
              ...(await seedMaya(tx, source, now)),
              videoCreated: await seedDemoVideo(tx, objects, source, now),
              objectsUploaded: stored.length,
            }
          : undefined;
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
  } catch (error) {
    await Promise.all(
      stored.map((key) => store?.delete(key).catch(() => undefined)),
    );
    throw error;
  }
}

function demoSummary(d: DemoResult): string {
  if (!demoChanged(d)) return "@maya already seeded";
  const parts = [
    d.accountCreated ? `${d.postsAdded} posts` : "kept its Demo account",
    d.videoCreated
      ? `published ${V1.title}`
      : d.objectsUploaded > 0
        ? `stored ${V1.title}'s files again`
        : "",
  ].filter(Boolean);
  return `seeded @maya (${parts.join(", ")})`;
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
