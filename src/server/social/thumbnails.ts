import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db/client";
import { socialAccount } from "../../db/schema";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { mockThumbnailSvg } from "./providers/mock-data";

// The authenticated image proxy (02 §7.6, 07 D42): the creator's browser never loads a platform URL itself. P08 builds
// the avatar's mock branch; the real-host branch, its URL validator and the thumbnail kind come with P27 and P09. It
// never refreshes a token or calls a platform API.

const MOCK_AVATAR = /^mock:\/\/avatar\/(\d{2})$/;

/** The tile number of a mock avatar URL (`mock://avatar/01` → 1), or null for anything else; 00 isn't a tile. */
export function parseMockAvatar(url: string | null): number | null {
  const match = url ? MOCK_AVATAR.exec(url) : null;
  const n = match ? Number(match[1]) : 0;
  return n >= 1 ? n : null;
}

/** 02 §7.6's mock branch: a private, sniff-proof SVG that can run nothing. */
const MOCK_IMAGE_HEADERS = {
  "Content-Type": "image/svg+xml",
  "Cache-Control": "private, max-age=3600",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
};

const notFound = () => new Response(null, { status: 404 });

/** The image for the creator's own account, or a 404 Response for anything else; never throws to the route. */
export async function streamPlatformImage(
  i: { kind: "avatar"; accountId: string },
  a: Actor,
): Promise<Response> {
  try {
    const actor = requireCreatorActor(a);
    const [account] = await db
      .select({
        provider: socialAccount.provider,
        avatarUrl: socialAccount.avatarUrl,
      })
      .from(socialAccount)
      .where(
        and(
          eq(socialAccount.id, i.accountId),
          eq(socialAccount.creatorId, actor.creatorId),
          ne(socialAccount.status, "disconnected"),
        ),
      );
    const tile =
      account?.provider === "mock" ? parseMockAvatar(account.avatarUrl) : null;
    if (tile === null) return notFound();
    return new Response(mockThumbnailSvg(tile, 80, 80), {
      headers: MOCK_IMAGE_HEADERS,
    });
  } catch {
    return notFound();
  }
}
