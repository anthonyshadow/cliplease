import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVideoFromPost as makeLicensable } from "../../src/app/(dashboard)/dashboard/videos/new/actions";
import { db } from "../../src/db/client";
import { socialAccount, socialPost } from "../../src/db/schema";
import { APP_NAME } from "../../src/lib/app-name";
import { GENERIC_ERROR_MESSAGE } from "../../src/lib/result";
import { videoStepHref } from "../../src/lib/videos/steps";
import {
  SocialRateLimitError,
  SocialUpstreamError,
} from "../../src/server/social/errors";
import { setMockScenarioForTests } from "../../src/server/social/providers/mock";
import { formOf, NOT_FOUND, redirectTo } from "../helpers/actions";
import { mockNextHeaders, signedInCreator } from "../helpers/auth";
import { postNumber } from "../helpers/connect-flow";
import { syncedDemo } from "../helpers/library";
import {
  expectNothingWritten,
  liveGetPost,
  postingsOn,
  spyGetPost,
  twoCreatorsOnOneAccount,
  videosOf,
} from "../helpers/library-videos";

// The Source page's Make licensable action (P11; 02 §6.1; 01 J5.2–J5.4; 07 D18, D39; owner answers Q-62 a, Q-65 a):
// the gate, the 404s, the redirect to the File step, and each refusal's ActionResult code and words, against the test
// database and the mock provider. The domain function itself is tests/integration/ownership.test.ts's.
vi.mock("next/headers", () => import("../helpers/next-headers"));

beforeEach(() => mockNextHeaders(null));
afterEach(() => {
  vi.restoreAllMocks();
  setMockScenarioForTests(null);
});

/** A signed-in creator (the session the action's gate reads) with a synced Demo account, and its post `nn`. */
async function signedInDemo(nn = "01") {
  const me = await signedInCreator();
  const d = await syncedDemo({ id: me.creatorId, userId: me.userId });
  return { me, d, post: await postNumber(d.account.id, nn) };
}

const press = (socialPostId: string) =>
  makeLicensable(null, formOf({ socialPostId }));

/** Expects the refusal `code` with its words, and nothing written. */
async function expectRefused(
  socialPostId: string,
  creatorId: string,
  code: string,
  message: string,
) {
  expect(await press(socialPostId)).toEqual({
    ok: false,
    error: { code, message },
  });
  await expectNothingWritten(creatorId, socialPostId);
}

describe("Make licensable (the Source page's action)", () => {
  it("sends a signed-out visitor to sign-in, writing nothing", async () => {
    await expect(press(randomUUID())).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fdashboard"),
    );
  });

  it("makes the post licensable and goes to its File step; a second press opens the same video", async () => {
    const { me, post } = await signedInDemo();

    const thrown = await press(post.id).catch((error: unknown) => error);
    const [row, ...others] = await videosOf(me.creatorId);
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      source: "library",
      ownership: "verified_owner",
      status: "draft",
      originalStatus: "none",
    });
    expect(thrown).toMatchObject(redirectTo(videoStepHref(row.id, "file")));
    expect(await postingsOn(post.id)).toMatchObject([
      { videoId: row.id, isSource: true, verification: "verified" },
    ]);

    await expect(press(post.id)).rejects.toMatchObject(
      redirectTo(videoStepHref(row.id, "file")),
    );
    expect(await videosOf(me.creatorId)).toHaveLength(1);
    expect(await postingsOn(post.id)).toHaveLength(1);
  });

  it("answers a malformed or missing id, an unknown post, another creator's post and a removed post with 404, with no platform call", async () => {
    const { me, d } = await signedInDemo();
    const other = await syncedDemo();
    const theirs = await postNumber(other.account.id, "01");
    const removed = await postNumber(d.account.id, "03");
    await db
      .update(socialPost)
      .set({ status: "removed", removedAt: new Date() })
      .where(eq(socialPost.id, removed.id));
    const getPost = spyGetPost();

    for (const socialPostId of [
      "not-a-uuid",
      "",
      randomUUID(),
      theirs.id,
      removed.id,
    ]) {
      await expect(press(socialPostId)).rejects.toMatchObject(NOT_FOUND);
    }
    await expect(makeLicensable(null, formOf({}))).rejects.toMatchObject(
      NOT_FOUND,
    );
    expect(getPost).not.toHaveBeenCalled();
    expect(await videosOf(me.creatorId)).toEqual([]);
    expect(await videosOf(other.account.creatorId)).toEqual([]);
  });
});

describe("Make licensable: refusals come back as codes with the page's words", () => {
  it("not on the account (post_removed, post 05): J5.2's words with the platform", async () => {
    const { me, post } = await signedInDemo("05");
    setMockScenarioForTests("post_removed");

    await expectRefused(
      post.id,
      me.creatorId,
      "not_on_account",
      "We couldn't find this post on your Demo account. Sync and try again.",
    );
  });

  it("a post the live check finds private: the private line (07 D18)", async () => {
    const { me, post } = await signedInDemo();
    liveGetPost({ visibility: "private" });

    await expectRefused(
      post.id,
      me.creatorId,
      "not_public",
      "Make it public or unlisted on YouTube first, or upload it instead.",
    );
  });

  it("an account that needs reconnecting: the reconnect line, so the page shows its reconnect state", async () => {
    const { me, d, post } = await signedInDemo();
    await db
      .update(socialAccount)
      .set({ status: "needs_reconnect" })
      .where(eq(socialAccount.id, d.account.id));

    await expectRefused(
      post.id,
      me.creatorId,
      "needs_reconnect",
      "Reconnect Demo to verify this post",
    );
  });

  it.each([
    ["a platform failure", new SocialUpstreamError()],
    ["a rate limit", new SocialRateLimitError(900)],
  ])(
    "%s: the generic line (the page keeps Make licensable as the retry)",
    async (_, failure) => {
      const { me, post } = await signedInDemo();
      spyGetPost().mockRejectedValue(failure);

      await expectRefused(
        post.id,
        me.creatorId,
        "upstream",
        GENERIC_ERROR_MESSAGE,
      );
    },
  );

  it("a post another creator already made licensable (shared_account): J5.4's words", async () => {
    const { a, b, bPost } = await twoCreatorsOnOneAccount((_, id) =>
      press(id).catch(() => null),
    );
    expect(await videosOf(a.creatorId)).toHaveLength(1);

    // B linked the same platform account, synced, and presses Make licensable on the same post 01.

    await expectRefused(
      bPost.id,
      b.creatorId,
      "already_licensable_elsewhere",
      `This post is already licensable from another ${APP_NAME} account.`,
    );
  });
});
