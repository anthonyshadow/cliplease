"use server";

import { z } from "zod";
import { SOCIAL_PROVIDERS } from "@/lib/domain/values";
import {
  LIBRARY_PATH,
  LibraryCursorSchema,
  type LibraryFilter,
  LibraryQSchema,
} from "@/lib/library/filter";
import type { LibraryPostDTO } from "@/lib/library/post";
import { type ActionResult, formError } from "@/lib/result";
import { requireCreator, toActor } from "@/server/auth/session";
import { queryLibraryPage } from "@/server/library/queries";
import { redactErrors } from "@/server/rethrow-redacted";

// Show more (05 §6.1 callout 14): the next 24 tiles for the same filters. It reads the page only; the summaries and chip
// counts on screen stay as they are.

const loadMoreInput = z.strictObject({
  platform: z.enum(SOCIAL_PROVIDERS).optional(),
  account: z.uuid().optional(),
  q: LibraryQSchema.optional(),
  // Required and one of ours: a bad cursor here would append the first page again.
  cursor: LibraryCursorSchema,
});

export async function loadMoreLibraryPosts(
  input: z.input<typeof loadMoreInput>,
): Promise<
  ActionResult<{ posts: LibraryPostDTO[]; nextCursor: string | null }>
> {
  return redactErrors("library.load_more_failed", async () => {
    const parsed = loadMoreInput.safeParse(input);
    if (!parsed.success) return formError("invalid_input");
    const ctx = await requireCreator(LIBRARY_PATH);
    const { platform, account, q, cursor } = parsed.data;
    const filter: LibraryFilter = { platform, accountId: account, q, cursor };
    return { ok: true, data: await queryLibraryPage(toActor(ctx), filter) };
  });
}
