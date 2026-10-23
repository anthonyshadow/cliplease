import { describe, expect, it, vi } from "vitest";
import { pgError, wrapped } from "../../../tests/helpers/pg-errors";
import type { db } from "../../db/client";
import {
  AlreadyLicensableElsewhereError,
  AlreadyOnYourVideoError,
} from "./errors";
import {
  assertPostingsAvailable,
  isVerifiedPostingConflict,
  type PostingTarget,
  verifiedPostingConflictError,
} from "./ownership";

// uniqueViolationConstraint's reading of an error (SQLSTATE, a missing constraint, plain errors) is db-errors.test.ts's.
const lost = pgError("23505", "video_posting_verified_uidx");

describe("isVerifiedPostingConflict", () => {
  it("spots a lost video_posting_verified_uidx, bare or wrapped by Drizzle", () => {
    expect(isVerifiedPostingConflict(lost)).toBe(true);
    expect(isVerifiedPostingConflict(wrapped(lost))).toBe(true);
  });

  it.each([
    ["another unique index", pgError("23505", "video_posting_video_link_uidx")],
    ["the source index", pgError("23505", "video_posting_source_uidx")],
    [
      "another SQLSTATE on that name",
      pgError("23503", "video_posting_verified_uidx"),
    ],
  ])("is false for %s", (_, error) => {
    expect(isVerifiedPostingConflict(error)).toBe(false);
  });
});

const ME = "creator-me";
const THIS_VIDEO = "video-this";

type Holder = {
  videoId: string;
  creatorId: string;
  title: string;
  platform: PostingTarget["platform"];
  linkKey: string;
};

/** A reader answering the verified-holders select with `holders`, without a database; `select` counts the reads. */
function holdersReader(holders: Holder[]) {
  const select = vi.fn(() => ({
    from: () => ({ innerJoin: () => ({ where: async () => holders }) }),
  }));
  return { exec: { select } as unknown as Pick<typeof db, "select">, select };
}

const target = (linkKey: string, index?: number): PostingTarget => ({
  creatorId: ME,
  videoId: THIS_VIDEO,
  platform: "mock",
  linkKey,
  ...(index === undefined ? {} : { index }),
});

const holder = (linkKey: string, over: Partial<Holder> = {}): Holder => ({
  videoId: THIS_VIDEO,
  creatorId: ME,
  title: "Snow day",
  platform: "mock",
  linkKey,
  ...over,
});

describe("assertPostingsAvailable: the refused row's index (owner answer Q-78 a)", () => {
  it("gives another creator's holder as AlreadyLicensableElsewhereError with the target's index", async () => {
    const { exec } = holdersReader([
      holder("k2", { creatorId: "creator-other", videoId: "video-other" }),
    ]);
    const error = await assertPostingsAvailable(exec, [
      target("k1", 0),
      target("k2", 3),
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AlreadyLicensableElsewhereError);
    expect(error).toMatchObject({ index: 3 });
  });

  it("gives the creator's other video as AlreadyOnYourVideoError with its title and the target's index", async () => {
    const { exec } = holdersReader([
      holder("k1", { videoId: "video-mine", title: "Beach day" }),
    ]);
    const error = await assertPostingsAvailable(exec, [target("k1", 1)]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AlreadyOnYourVideoError);
    expect(error).toMatchObject({ videoTitle: "Beach day", index: 1 });
  });

  it("refuses the first target in order, and a target with no index (Check again) gives none", async () => {
    const { exec } = holdersReader([
      holder("k2", { videoId: "video-mine" }),
      holder("k1", { creatorId: "creator-other", videoId: "video-other" }),
    ]);
    const first = await assertPostingsAvailable(exec, [
      target("k1", 4),
      target("k2", 2),
    ]).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(AlreadyLicensableElsewhereError);
    expect(first).toMatchObject({ index: 4 });

    const unnamed = await assertPostingsAvailable(exec, [target("k2")]).catch(
      (e: unknown) => e,
    );
    expect(unnamed).toBeInstanceOf(AlreadyOnYourVideoError);
    expect(unnamed).toMatchObject({ index: undefined });
  });

  it("passes posts this video holds or nobody holds, and reads nothing for no targets", async () => {
    const { exec, select } = holdersReader([holder("k1")]);
    await expect(
      assertPostingsAvailable(exec, [target("k1", 0), target("k9", 1)]),
    ).resolves.toBeUndefined();
    expect(select).toHaveBeenCalledTimes(1);
    await assertPostingsAvailable(exec, []);
    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe("verifiedPostingConflictError: a lost index keeps the refused row's index through the re-run", () => {
  it("gives the holder's refusal with the target's index, else AlreadyLicensableElsewhereError with none", async () => {
    const held = holdersReader([
      holder("k1", { videoId: "video-mine", title: "Beach day" }),
    ]);
    const mine = await verifiedPostingConflictError(held.exec, lost, [
      target("k1", 5),
    ]).catch((e: unknown) => e);
    expect(mine).toBeInstanceOf(AlreadyOnYourVideoError);
    expect(mine).toMatchObject({ videoTitle: "Beach day", index: 5 });

    const none = await verifiedPostingConflictError(
      holdersReader([]).exec,
      lost,
      [target("k1", 5)],
    );
    expect(none).toBeInstanceOf(AlreadyLicensableElsewhereError);
    expect(none).toMatchObject({ index: undefined });
  });
});
