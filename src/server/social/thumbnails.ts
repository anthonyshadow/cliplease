import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db/client";
import { socialAccount, socialPost } from "../../db/schema";
import { THUMBNAIL_FALLBACK } from "../../lib/library/post";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { notFoundNoStore } from "../http";
import { mockThumbnailSvg } from "./providers/mock-data";

// The authenticated image proxy (02 §7.6, 07 D42): the creator's browser never loads a platform URL itself. P08 built
// the avatar's mock branch and P09 the post thumbnail's; the real-host branch and its URL validator come with P27. It
// never refreshes a token or calls a platform API.

const MOCK_AVATAR = /^mock:\/\/avatar\/(\d{2})$/;
const MOCK_THUMB = /^mock:\/\/thumb\/(\d{2})$/;

/** The tile number in a mock image URL, or null for anything else; 00 isn't a tile. */
function mockTile(pattern: RegExp, url: string | null): number | null {
  const match = url ? pattern.exec(url) : null;
  const n = match ? Number(match[1]) : 0;
  return n >= 1 ? n : null;
}

/** `mock://avatar/01` → 1. */
export const parseMockAvatar = (url: string | null) =>
  mockTile(MOCK_AVATAR, url);

/** `mock://thumb/01` → 1. */
export const parseMockThumbnail = (url: string | null) =>
  mockTile(MOCK_THUMB, url);

/** 02 §7.6's mock branch: a private, sniff-proof SVG that can run nothing. */
const MOCK_IMAGE_HEADERS = {
  "Content-Type": "image/svg+xml",
  "Cache-Control": "private, max-age=3600",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
};

/** Mock tile `n`, drawn `width` × `height`. */
type MockImage = { n: number; width: number; height: number };

/** The creator's own account avatar (not disconnected). */
async function avatarImage(
  accountId: string,
  creatorId: string,
): Promise<MockImage | null> {
  const [account] = await db
    .select({
      provider: socialAccount.provider,
      avatarUrl: socialAccount.avatarUrl,
    })
    .from(socialAccount)
    .where(
      and(
        eq(socialAccount.id, accountId),
        eq(socialAccount.creatorId, creatorId),
        ne(socialAccount.status, "disconnected"),
      ),
    );
  const n =
    account?.provider === "mock" ? parseMockAvatar(account.avatarUrl) : null;
  return n === null ? null : { n, width: 80, height: 80 };
}

/**
 * The creator's own post thumbnail at the post's size (9:16 1080 × 1920 when unknown). A stale post was scrubbed and
 * shows nothing; a removed one still does (a verified posting's page shows it, P11+).
 */
async function thumbnailImage(
  postId: string,
  creatorId: string,
): Promise<MockImage | null> {
  const [post] = await db
    .select({
      provider: socialPost.provider,
      thumbnailUrl: socialPost.thumbnailUrl,
      width: socialPost.width,
      height: socialPost.height,
    })
    .from(socialPost)
    .where(
      and(
        eq(socialPost.id, postId),
        eq(socialPost.creatorId, creatorId),
        ne(socialPost.status, "stale"),
      ),
    );
  const n =
    post?.provider === "mock" ? parseMockThumbnail(post.thumbnailUrl) : null;
  if (!post || n === null) return null;
  return {
    n,
    width: post.width ?? THUMBNAIL_FALLBACK.width,
    height: post.height ?? THUMBNAIL_FALLBACK.height,
  };
}

/**
 * The image for the creator's own account or post, or an uncached 404 for anything else (a thumbnail that failed comes
 * back after a sync stores its URL again); never throws to the route.
 */
export async function streamPlatformImage(
  i:
    | { kind: "avatar"; accountId: string }
    | { kind: "thumbnail"; postId: string },
  a: Actor,
): Promise<Response> {
  try {
    const { creatorId } = requireCreatorActor(a);
    const image =
      i.kind === "avatar"
        ? await avatarImage(i.accountId, creatorId)
        : await thumbnailImage(i.postId, creatorId);
    if (!image) return notFoundNoStore();
    return new Response(mockThumbnailSvg(image.n, image.width, image.height), {
      headers: MOCK_IMAGE_HEADERS,
    });
  } catch {
    // Also a size mockThumbnailSvg refuses (RangeError).
    return notFoundNoStore();
  }
}
