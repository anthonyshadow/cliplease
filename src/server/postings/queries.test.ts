import { describe, expect, it } from "vitest";
import {
  type OwnerPostingRow,
  type PublicPostingRow,
  toOwnerPosting,
  toPublicPostings,
} from "./queries";

const CHECKED_AT = new Date("2026-10-21T12:00:00.000Z");
const FETCHED_AT = new Date("2026-10-20T08:30:00.000Z");
const LINKED_AT = new Date("2026-10-01T09:00:00.000Z");
const REMOVED_AT = new Date("2026-10-14T12:00:00.000Z");

const VERIFIED_ROW: OwnerPostingRow = {
  id: "posting-1",
  videoId: "video-1",
  platform: "mock",
  otherLabel: null,
  url: "https://example.com/mock/mock_post_c4180ab2_01",
  isSource: true,
  verification: "verified",
  unverifiedReason: null,
  verifiedUsername: "@demo.creator",
  verifiedAccountLinkedAt: LINKED_AT,
  showLink: true,
  checkedAt: CHECKED_AT,
  position: 0,
  accountStatus: "connected",
  postId: "post-1",
  thumbnailUrl: "mock://thumb/01",
  thumbnailFetchedAt: FETCHED_AT,
  durationSec: 14,
  visibility: "unlisted",
  removedAt: REMOVED_AT,
};

describe("toOwnerPosting", () => {
  it("gives a verified posting its label, handle, thumbnail (with P11's ?v=), duration, visibility and removal", () => {
    expect(toOwnerPosting(VERIFIED_ROW)).toEqual({
      id: "posting-1",
      platform: "mock",
      label: "Demo",
      url: "https://example.com/mock/mock_post_c4180ab2_01",
      isSource: true,
      verification: "verified",
      unverifiedReason: null,
      verifiedUsername: "@demo.creator",
      verifiedAccountLinkedAt: LINKED_AT.toISOString(),
      accountStatus: "connected",
      thumbnailSrc: `/api/library/thumbnails/post-1?v=${encodeURIComponent(FETCHED_AT.toISOString())}`,
      durationSec: 14,
      visibility: "unlisted",
      removedAt: REMOVED_AT.toISOString(),
      showLink: true,
      checkedAt: CHECKED_AT.toISOString(),
      position: 0,
    });
  });

  it("gives a released posting no handle, thumbnail, duration, visibility or removal, though it keeps its post", () => {
    expect(
      toOwnerPosting({
        ...VERIFIED_ROW,
        verification: "unverified",
        unverifiedReason: "released",
      }),
    ).toMatchObject({
      verification: "unverified",
      unverifiedReason: "released",
      verifiedUsername: null,
      verifiedAccountLinkedAt: null,
      accountStatus: "connected",
      thumbnailSrc: null,
      durationSec: null,
      visibility: null,
      removedAt: null,
    });
  });

  it("gives a verified post with no stored image no thumbnail", () => {
    expect(
      toOwnerPosting({ ...VERIFIED_ROW, thumbnailUrl: null }).thumbnailSrc,
    ).toBeNull();
  });

  it("names an Other posting by the creator's name, and a never-checked posting has no checkedAt", () => {
    const other: OwnerPostingRow = {
      ...VERIFIED_ROW,
      platform: "other",
      otherLabel: "Vimeo",
      url: "https://vimeo.com/1",
      isSource: false,
      verification: "unverified",
      unverifiedReason: "unverifiable",
      verifiedUsername: null,
      checkedAt: null,
      position: 1,
      accountStatus: null,
      postId: null,
      thumbnailUrl: null,
      thumbnailFetchedAt: null,
      durationSec: null,
      visibility: null,
    };
    expect(toOwnerPosting(other)).toMatchObject({
      label: "Vimeo",
      checkedAt: null,
      accountStatus: null,
    });
  });
});

function publicRow(row: Partial<PublicPostingRow>): PublicPostingRow {
  return {
    videoId: "video-1",
    platform: "youtube",
    otherLabel: null,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    isSource: false,
    verification: "verified",
    verifiedUsername: "@maya.films",
    verifiedAccountLinkedAt: LINKED_AT,
    showLink: true,
    position: 1,
    accountStatus: "connected",
    postRemovedAt: null,
    ...row,
  };
}

describe("toPublicPostings", () => {
  it("lists verified postings first, then the rest, each by position", () => {
    const { postings } = toPublicPostings([
      publicRow({ platform: "x", verification: "unverified", position: 1 }),
      publicRow({ platform: "tiktok", position: 3 }),
      publicRow({
        platform: "facebook",
        verification: "unverified",
        position: 0,
      }),
      publicRow({ platform: "youtube", position: 2 }),
    ]);
    expect(postings.map((p) => p.platform)).toEqual([
      "youtube",
      "tiktok",
      "facebook",
      "x",
    ]);
  });

  it("makes the verified source posting primary, else the lowest-position verified one, else none", () => {
    const source = publicRow({ platform: "mock", isSource: true, position: 0 });
    const tiktok = publicRow({ platform: "tiktok", position: 2 });
    const youtube = publicRow({ platform: "youtube", position: 1 });
    expect(toPublicPostings([tiktok, source, youtube]).primary?.platform).toBe(
      "mock",
    );
    expect(
      toPublicPostings([
        { ...source, verification: "unverified" },
        tiktok,
        youtube,
      ]).primary?.platform,
    ).toBe("youtube");
    expect(
      toPublicPostings([publicRow({ verification: "unverified" })]).primary,
    ).toBeNull();
    expect(toPublicPostings([])).toEqual({ primary: null, postings: [] });
  });

  it("shows a verified posting's handle and link date, and says when its account is disconnected", () => {
    expect(toPublicPostings([publicRow({})]).postings[0]).toEqual({
      platform: "youtube",
      label: "YouTube",
      verified: true,
      verifiedUsername: "@maya.films",
      linkedAt: LINKED_AT.toISOString(),
      noLongerLinked: false,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      hostLabel: null,
      removed: false,
      hasLink: true,
    });
    expect(
      toPublicPostings([publicRow({ accountStatus: "disconnected" })])
        .postings[0]?.noLongerLinked,
    ).toBe(true);
  });

  it("never shows a handle or a link date on a Not verified posting", () => {
    expect(
      toPublicPostings([
        publicRow({
          verification: "unverified",
          accountStatus: "disconnected",
        }),
      ]).postings[0],
    ).toMatchObject({
      verified: false,
      verifiedUsername: null,
      linkedAt: null,
      noLongerLinked: false,
    });
  });

  it("gives the link only when shown, and not for a verified post that was removed (a stale post kept its removal)", () => {
    const posting = (row: Partial<PublicPostingRow>) =>
      toPublicPostings([publicRow(row)]).postings[0];
    const REMOVED = new Date("2026-10-14T12:00:00.000Z");
    expect(posting({ showLink: false })).toMatchObject({
      url: null,
      hasLink: true,
      removed: false,
    });
    expect(posting({ url: null })).toMatchObject({ url: null, hasLink: false });
    expect(posting({ postRemovedAt: REMOVED })).toMatchObject({
      url: null,
      hasLink: true,
      removed: true,
    });
    expect(
      posting({ verification: "unverified", postRemovedAt: REMOVED }),
    ).toMatchObject({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      removed: false,
    });
  });

  it("labels an Other link by its host, without www., only when the link shows", () => {
    const vimeo = publicRow({
      platform: "other",
      otherLabel: "Vimeo",
      url: "https://www.vimeo.com/1",
      verification: "unverified",
      verifiedUsername: null,
      verifiedAccountLinkedAt: null,
      accountStatus: null,
      postRemovedAt: null,
    });
    expect(toPublicPostings([vimeo]).postings[0]).toMatchObject({
      label: "Vimeo",
      url: "https://www.vimeo.com/1",
      hostLabel: "vimeo.com",
    });
    expect(
      toPublicPostings([{ ...vimeo, showLink: false }]).postings[0]?.hostLabel,
    ).toBeNull();
  });
});
