// "Where was it posted?"'s one planning rule (02 §5.12, 07 D67, D69): which posted rows a save writes, and with which
// canonical url and link key. Pure and client-safe: saveVideoPostings plans its write with it, and the Continue's
// postingsInputChanged compares the same plan with the saved rows, so the two never disagree on what a save would keep.
// Nothing here fetches a link (07 D67): links are only parsed (parsePostingLink).
import type { PostingLinkError, PostingPlatform } from "../domain/values";
import { parsePostingLink } from "./parse";

/** One posting as 02 §6.1's Zod gives it (saveVideoPostingsInput's output): a platform, Other's name, a link, the Switch. */
export type PostingPlanRow = {
  platform: PostingPlatform;
  otherLabel?: string;
  link?: string;
  showLink?: boolean;
};

/** A posting the save writes: its canonical url and link key come from the server's own parse. */
export type PlannedPosting = {
  /** The row's index in the input, the key of its field error. */
  index: number;
  platform: PostingPlatform;
  otherLabel: string | null;
  url: string | null;
  linkKey: string | null;
  showLink: boolean | undefined;
};

/** A platform post as one string, for the copies check only (the server's postKey is server-only). */
const copyKey = (platform: PostingPlatform, linkKey: string) =>
  `${platform}:${linkKey}`;

/**
 * Save steps 2 and 3: every non-empty link read again by parsePostingLink → the rows to write, or each failing row's
 * error by its input index. An empty or absent link is a row with no link. Rows naming the same platform post collapse
 * to the first, and a copy of the source posting is dropped: it is already there.
 */
export function planPostings(
  postings: readonly PostingPlanRow[],
  opts: {
    allowMock: boolean;
    source: { platform: PostingPlatform; linkKey: string | null } | null;
  },
):
  | { ok: true; rows: PlannedPosting[] }
  | { ok: false; fields: Record<number, PostingLinkError> } {
  const fields: Record<number, PostingLinkError> = {};
  const read: PlannedPosting[] = [];
  postings.forEach((posting, index) => {
    const row: PlannedPosting = {
      index,
      platform: posting.platform,
      otherLabel: posting.otherLabel ?? null,
      url: null,
      linkKey: null,
      showLink: posting.showLink,
    };
    const text = posting.link?.trim() ?? "";
    if (text !== "") {
      const parsed = parsePostingLink(posting.platform, text, {
        allowMock: opts.allowMock,
      });
      if (!parsed.ok) {
        fields[index] = parsed.error;
        return;
      }
      row.url = parsed.link.url;
      row.linkKey = parsed.link.linkKey;
    }
    read.push(row);
  });
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  const seen = new Set<string>();
  if (opts.source?.linkKey) {
    seen.add(copyKey(opts.source.platform, opts.source.linkKey));
  }
  const rows = read.filter((row) => {
    if (row.linkKey === null) return true;
    const key = copyKey(row.platform, row.linkKey);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ok: true, rows };
}
