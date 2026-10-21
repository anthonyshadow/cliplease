import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { type LibraryFilter, libraryHref } from "@/lib/library/filter";
import { LIBRARY_TITLE_ID, type LibraryEmptyState } from "./library-messages";
import { SyncButton } from "./sync-button";

/**
 * The EmptyStates that replace the grid under the Library's h1 (04 §11.9, 05 §6.1 States): every post past the 30-day
 * rule (its Sync now stands in for Sync all, rate limit included; with no connected account the Reconnect banners are
 * the action), no search match, and the filtered accounts with no videos. A sync that ends one focuses the h1.
 */
export function LibraryEmpty({
  empty,
  filter,
  blockedHelper,
}: {
  empty: Exclude<LibraryEmptyState, { kind: "no-accounts" }>;
  /** The page's filter, without its cursor. */
  filter: Omit<LibraryFilter, "cursor">;
  /** "Try again in {n} min." when every connected account is rate-limited. */
  blockedHelper: string | null;
}) {
  switch (empty.kind) {
    case "expired":
      return (
        <EmptyState
          title={
            <>
              Your saved list expired.{" "}
              <span className="text-ink-2">Sync to see your videos again.</span>
            </>
          }
          actions={
            empty.anyConnected ? (
              <SyncButton
                all
                label="Sync now"
                variant="primary"
                fullWidth
                blockedHelper={blockedHelper}
                focusAfterRemove={LIBRARY_TITLE_ID}
              />
            ) : undefined
          }
        />
      );
    case "no-match":
      return (
        <EmptyState
          title={empty.title}
          actions={
            <Button asChild variant="tertiary" size="sm">
              <Link href={libraryHref({ ...filter, q: undefined })}>
                Clear search
              </Link>
            </Button>
          }
        />
      );
    case "no-videos":
      return (
        <EmptyState
          title={empty.title}
          description={
            empty.notes.length > 0 ? empty.notes.join(" ") : undefined
          }
          actions={
            empty.target ? (
              <SyncButton
                {...empty.target}
                label="Sync now"
                variant="tertiary"
                focusAfterRemove={LIBRARY_TITLE_ID}
              />
            ) : undefined
          }
        />
      );
  }
}
