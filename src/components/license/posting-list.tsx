import { useId } from "react";
import { PlatformBadge } from "@/components/platform/platform-badge";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  BUYER_POSTINGS_COPY,
  buyerPostingRow,
} from "@/lib/postings/buyer-rows";
import { POSTINGS_COPY } from "@/lib/postings/copy";
import type { PublicPostingDTO } from "@/lib/postings/types";

/** User-generated links, opened apart from this page (07 D70). */
const POSTING_LINK_REL = "nofollow ugc noopener noreferrer";

/**
 * 04 §9.34 PostingList: "Where it was posted", one row per posting in the order given (verified first, then the creator's
 * order), in one `surface` card with hairline dividers; nothing when there are none. Each link is the stored canonical
 * url, opened in a new tab; no thumbnail, embed or fetch (07 D08, D67). Rows wrap at 320 px: a YouTube channel title or
 * an Other site's name can be one long word (07 D153).
 */
export function PostingList({ postings }: { postings: PublicPostingDTO[] }) {
  const titleId = useId();
  if (postings.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className="text-callout font-semibold text-ink">
        {BUYER_POSTINGS_COPY.title}
      </h2>
      <ul className="flex flex-col divide-y divide-hairline rounded-md border border-hairline bg-surface">
        {postings.map((posting, index) => (
          <PostingRow
            // biome-ignore lint/suspicious/noArrayIndexKey: rows carry no id buyers may see, and never reorder.
            key={index}
            posting={posting}
          />
        ))}
      </ul>
    </section>
  );
}

function PostingRow({ posting }: { posting: PublicPostingDTO }) {
  const row = buyerPostingRow(posting);
  const platform = (
    <PlatformBadge
      platform={posting.platform}
      otherLabel={posting.platform === "other" ? posting.label : null}
    />
  );
  return (
    <li
      data-posting-row
      className="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {row.kind === "also" ? (
          <span className="min-w-0 text-callout text-ink-2">
            {`${BUYER_POSTINGS_COPY.alsoPostedOn} `}
            {platform}
          </span>
        ) : (
          <span className="min-w-0 wrap-anywhere text-callout text-ink">
            {row.handle ? `${row.handle} on ` : null}
            {platform}
          </span>
        )}
        {row.pill ? (
          <StatusPill dot={row.pill === "verified" ? "solid" : "hollow"}>
            {row.pill === "verified"
              ? POSTINGS_COPY.verified
              : POSTINGS_COPY.notVerified}
          </StatusPill>
        ) : null}
      </span>
      {row.link ? (
        <Button
          asChild
          variant="link"
          size="sm"
          className="min-w-0 shrink wrap-anywhere"
        >
          <a
            href={row.link.href}
            target="_blank"
            rel={POSTING_LINK_REL}
            aria-label={row.link.label}
          >
            {row.link.text}
          </a>
        </Button>
      ) : null}
      {row.removed ? (
        <span className="text-footnote text-ink-2">
          {BUYER_POSTINGS_COPY.removed}
        </span>
      ) : null}
    </li>
  );
}
