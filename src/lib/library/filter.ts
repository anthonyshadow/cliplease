// The Library's URL contract (02 §5.4, 03 §7.2, 07 D48): `?platform=&account=&q=&cursor=`. Client-safe (no server
// imports) so the page, its islands and the Server Action share one parser; src/server/library/queries.ts re-exports it.
import { z } from "zod";
import { SOCIAL_PROVIDERS, type SocialProviderId } from "../domain/values";

export const LIBRARY_PATH = "/dashboard/library";
/** Tiles per page; the query reads one more to know whether there is a next page. */
export const LIBRARY_PAGE_SIZE = 24;
export const LIBRARY_Q_MAX = 100;

export type LibraryFilter = {
  platform?: SocialProviderId;
  accountId?: string;
  q?: string;
  cursor?: string;
};

/** The keyset position after a post: its posted_at (ISO) and id (03 §7.2). */
type LibraryCursor = { p: string; i: string };

// Postgres has no year 0 and the app writes cursors from real post times: a time before 1970 is a crafted one.
const CursorSchema = z.strictObject({
  p: z.iso.datetime().refine((p) => Date.parse(p) >= 0),
  i: z.uuid(),
});
// base64url of `{"p":"<ISO>","i":"<uuid>"}` is about 110 characters; anything longer or outside the alphabet is junk.
const CURSOR_TEXT = /^[A-Za-z0-9_-]{1,200}$/;

// The JSON is ASCII (an ISO time and a uuid), so btoa/atob are safe here and work in the browser and in Node.
const toBase64Url = (text: string) =>
  btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) =>
  atob(text.replace(/-/g, "+").replace(/_/g, "/"));

/** The opaque cursor after `post`: base64url JSON `{ p, i }`. */
export function encodeLibraryCursor(post: { postedAt: Date; id: string }) {
  return toBase64Url(
    JSON.stringify({ p: post.postedAt.toISOString(), i: post.id }),
  );
}

/** The cursor's position, or null for anything that isn't one of ours (a bad cursor shows the first page). */
export function decodeLibraryCursor(raw: string): LibraryCursor | null {
  if (!CURSOR_TEXT.test(raw)) return null;
  try {
    const parsed = CursorSchema.safeParse(JSON.parse(fromBase64Url(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** `q` for ILIKE: `\`, `%` and `_` match themselves (03 §7.2). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `q`: trimmed to 2–100 characters, with no NUL (Postgres refuses 0x00 in text). */
export const LibraryQSchema = z
  .string()
  .trim()
  .min(2)
  .max(LIBRARY_Q_MAX)
  .refine((q) => !q.includes("\0"));

/** A cursor decodeLibraryCursor reads (the page drops another; Show more refuses it). */
export const LibraryCursorSchema = z
  .string()
  .refine((raw) => decodeLibraryCursor(raw) !== null);

/** One query param: a repeated one (string[]) or one that fails its rule is dropped, never an error. */
const param = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v : undefined),
    schema.optional().catch(undefined),
  );

/**
 * The page's searchParams → LibraryFilter. Each param is parsed on its own and an invalid one is dropped: `platform` one
 * of SOCIAL_PROVIDERS, `account` a uuid (the URL's name for accountId), `q` trimmed to 2–100 characters, `cursor` one
 * decodeLibraryCursor reads.
 */
export const LibraryFilterSchema = z
  .object({
    platform: param(z.enum(SOCIAL_PROVIDERS)),
    account: param(z.uuid()),
    q: param(LibraryQSchema),
    cursor: param(LibraryCursorSchema),
  })
  .transform(
    ({ platform, account, q, cursor }): LibraryFilter => ({
      ...(platform && { platform }),
      ...(account && { accountId: account }),
      ...(q && { q }),
      ...(cursor && { cursor }),
    }),
  );

/** The Library URL for `f`, params in a fixed order; a link built with it never carries ?connected= or ?error=. */
export function libraryHref(f: LibraryFilter): string {
  const query = new URLSearchParams();
  if (f.platform) query.set("platform", f.platform);
  if (f.accountId) query.set("account", f.accountId);
  if (f.q) query.set("q", f.q);
  if (f.cursor) query.set("cursor", f.cursor);
  const search = query.toString();
  return search ? `${LIBRARY_PATH}?${search}` : LIBRARY_PATH;
}
