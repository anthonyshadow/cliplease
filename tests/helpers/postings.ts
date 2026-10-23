// Postings [int] helpers (P11b): the no-network guard on globalThis.fetch, the ownership invariant (03 I28), links to
// mock posts a test never synced, the title mock post 01 gives a video, "verified elsewhere" drafts built by the
// factories, and the postings as stored.
import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { expect, vi } from "vitest";
import { db } from "../../src/db/client";
import { auditEvent, video, videoPosting } from "../../src/db/schema";
import type {
  CreatorProfile,
  SocialAccount,
  Video,
  VideoPosting,
} from "../../src/db/schema/types";
import type { PostingPlatform } from "../../src/lib/domain/values";
import { parsePostingLink } from "../../src/lib/postings/parse";
import { mockPermalink } from "../../src/lib/social/mock-ids";
import { HOUR_MS } from "../../src/lib/time";
import type { Actor } from "../../src/server/auth/actor";
import { refreshVideoOwnership } from "../../src/server/postings/ownership";
import { mockProvider } from "../../src/server/social/providers/mock";
import { insertDemoAccount } from "./connect-flow";
import { insertCreator } from "./factories";
import { libraryDraft } from "./library-videos";

const spyFetch = () => vi.spyOn(globalThis, "fetch");

/** The URL a fetch call asked for, whichever form it was given in. */
function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * The no-network guard (07 D67, D73). `install` spies on globalThis.fetch and refuses every call, so nothing reaches
 * the network. vi.restoreAllMocks() removes the spy and its record, so install it in beforeAll and again in beforeEach,
 * and `collect` in afterEach before restoring. `remember` records a pasted link and its canonical URL; `requested` is
 * every URL fetch was asked for, `pasted` every link remembered.
 */
export function fetchGuard() {
  const requested: string[] = [];
  const pasted = new Set<string>();
  let spy: ReturnType<typeof spyFetch> | null = null;
  return {
    install() {
      spy = spyFetch().mockImplementation(async () => {
        throw new Error("the postings suite makes no network request");
      });
    },
    collect() {
      if (spy) requested.push(...spy.mock.calls.map(([input]) => urlOf(input)));
      spy = null;
    },
    remember(platform: PostingPlatform, link: string) {
      const trimmed = link.trim();
      if (trimmed === "") return;
      pasted.add(trimmed);
      const parsed = parsePostingLink(platform, trimmed, { allowMock: true });
      if (parsed.ok) pasted.add(parsed.link.url);
    },
    requested: (): string[] => [...requested],
    pasted: (): string[] => [...pasted],
  };
}

/**
 * 03 I28 over every video in the database: ownership is 'verified_owner' iff a verified posting exists, a Library
 * video has exactly one is_source posting and an upload none. Rows build up across a file, so it checks them all.
 */
export async function expectOwnershipInvariant(): Promise<void> {
  const broken = await db.execute<{
    id: string;
    source: string;
    ownership: string;
    verified: number;
    sources: number;
  }>(sql`
    select v.id, v.source, v.ownership,
      (count(p.id) filter (where p.verification = 'verified'))::int as verified,
      (count(p.id) filter (where p.is_source))::int as sources
    from ${video} v
    left join ${videoPosting} p on p.video_id = v.id
    group by v.id
    having (v.ownership = 'verified_owner') <> (count(p.id) filter (where p.verification = 'verified') > 0)
      or (count(p.id) filter (where p.is_source)) <> (case when v.source = 'library' then 1 else 0 end)
  `);
  expect(broken.rows).toEqual([]);
}

/** The id the mock gives post `nn` ("05") of a Demo account, synced or not (own, "_2" and shared accounts). */
export const mockPostId = (
  account: Pick<SocialAccount, "providerAccountId">,
  nn: string,
) => `${account.providerAccountId.replace(/^mock_acct_/, "mock_post_")}_${nn}`;

/** The Demo link of post `nn` of `account`, as the creator would paste it. */
export const mockLink = (
  account: Pick<SocialAccount, "providerAccountId">,
  nn: string,
) => mockPermalink(mockPostId(account, nn));

/** Counts findPostByLinkKey calls on the raw adapter (the mock's lookup calls its getPost too). */
export const spyFind = () => vi.spyOn(mockProvider, "findPostByLinkKey");

/** An admin actor (listVideoPostings reads any video for one). */
export const adminActor = (): Actor => ({
  kind: "admin",
  userId: randomUUID(),
});

/** The title Make licensable gives a video made from mock post 01. */
export const SNOW_TITLE = "He saw snow for the first time and lost it";

/**
 * Another connected Demo account of `creator` (insertDemoAccount), for a user id of its own (so its posts are
 * mock_post_<that suffix>_NN), linked at `connectedAt`: for the lookup's account order.
 */
export const extraDemoAccount = (
  creator: Pick<CreatorProfile, "id">,
  connectedAt: Date,
): Promise<SocialAccount> =>
  insertDemoAccount({ id: creator.id, userId: randomUUID() }, { connectedAt });

/**
 * Another creator's Library draft holding mock post `linkKey` verified (its source posting), built by libraryDraft with
 * its original not ready: no sync and no live check, and the ownership invariant holds.
 */
export async function insertVerifiedElsewhere(linkKey: string): Promise<Video> {
  const other = await insertCreator();
  return libraryDraft(
    { creatorId: other.id },
    { ready: false, post: { providerPostId: linkKey, linkKey } },
  );
}

/** The video's postings, by position. */
export const postingsOf = (videoId: string) =>
  db
    .select()
    .from(videoPosting)
    .where(eq(videoPosting.videoId, videoId))
    .orderBy(asc(videoPosting.position));

/** One posting as stored. */
export async function postingRow(id: string): Promise<VideoPosting> {
  const [row] = await db
    .select()
    .from(videoPosting)
    .where(eq(videoPosting.id, id));
  if (!row) throw new Error("no posting");
  return row;
}

/**
 * Every `video_posting.conflict` audit naming one of `postingIds`, as the posting that became verified or among the
 * conflicting ones: for "exactly one audit, written when a posting became verified".
 */
export async function conflictAuditsNaming(
  postingIds: readonly string[],
): Promise<{ entityId: string; data: Record<string, unknown> }[]> {
  const audits = await db
    .select({ entityId: auditEvent.entityId, data: auditEvent.data })
    .from(auditEvent)
    .where(eq(auditEvent.action, "video_posting.conflict"));
  return audits.filter((audit) => {
    const conflicting = audit.data.conflictingPostingIds;
    const named = [
      audit.entityId,
      ...(Array.isArray(conflicting) ? conflicting : []),
    ];
    return named.some((id) => postingIds.includes(id));
  });
}

/** Releases a posting as admin Disable will (P21): unverified 'released', social ids kept, ownership refreshed. */
export async function releasePosting(
  posting: Pick<VideoPosting, "id" | "videoId">,
): Promise<void> {
  await db
    .update(videoPosting)
    .set({ verification: "unverified", unverifiedReason: "released" })
    .where(eq(videoPosting.id, posting.id));
  await refreshVideoOwnership(db, posting.videoId);
}

/** Moves the posting's checked_at an hour back, so a later check visibly moves it. Returns the new value. */
export async function backdateCheckedAt(postingId: string): Promise<Date> {
  const at = new Date(Date.now() - HOUR_MS);
  await db
    .update(videoPosting)
    .set({ checkedAt: at })
    .where(eq(videoPosting.id, postingId));
  return at;
}

/** Sets the video's same-video tick an hour back, without confirmSameVideo's guards (07 D69). Returns the value. */
export async function setSameVideoConfirmed(videoId: string): Promise<Date> {
  const at = new Date(Date.now() - HOUR_MS);
  await db
    .update(video)
    .set({ sameVideoConfirmedAt: at })
    .where(eq(video.id, videoId));
  return at;
}

/** Stored posting URLs that still carry a tracking parameter or a fragment (07 D67): always 0. */
export async function trackingUrlCount(): Promise<number> {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${videoPosting} where url ~ '(igsh|utm_|si=|is_from_webapp|#)'`,
  );
  return result.rows[0]?.n ?? 0;
}
