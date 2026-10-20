import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as thumbnailGET } from "../../../src/app/api/library/thumbnails/[postId]/route";
import { db } from "../../../src/db/client";
import { socialPost } from "../../../src/db/schema";
import { streamPlatformImage } from "../../../src/server/social/thumbnails";
import { mockNextHeaders, signedInCreator } from "../../helpers/auth";
import { at, postNumber } from "../../helpers/connect-flow";
import { resetDb } from "../../helpers/db";
import { insertSocialAccount, insertSocialPost } from "../../helpers/factories";
import { syncedDemo } from "../../helpers/library";

// The Library thumbnail proxy, mock branch (02 §6.2, §7.6; 07 D42, D150) against the real route handler and the test
// database. It serves only the signed-in creator's own mock thumbnails and never calls a platform.
vi.mock("next/headers", () => import("../../helpers/next-headers"));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));

const thumbnail = (postId: string) =>
  thumbnailGET(new NextRequest(at(`/api/library/thumbnails/${postId}`)), {
    params: Promise.resolve({ postId }),
  });

/** 02 §7.6's mock image headers, exactly. */
const SVG_HEADERS = {
  "content-type": "image/svg+xml",
  "cache-control": "private, max-age=3600",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
};

const updatePost = (id: string, set: PgUpdateSetSource<typeof socialPost>) =>
  db.update(socialPost).set(set).where(eq(socialPost.id, id));

/** A signed-in creator (the current session) with a synced Demo account. */
async function signedInWithDemo() {
  const me = await signedInCreator();
  const demo = await syncedDemo({ id: me.creatorId, userId: me.userId });
  return { me, demo };
}

/** A 200 with the locked-down headers and mock tile `label` drawn width × height, and nothing that could run. */
async function expectSvg(
  response: Response,
  label: string,
  width: number,
  height: number,
) {
  expect(response.status).toBe(200);
  expect(
    Object.fromEntries(
      Object.keys(SVG_HEADERS).map((name) => [
        name,
        response.headers.get(name),
      ]),
    ),
  ).toEqual(SVG_HEADERS);
  const svg = await response.text();
  expect(svg).toMatch(
    new RegExp(
      `^<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ),
  );
  expect(svg).toContain(`>${label}</text></svg>`);
  expect(svg).not.toMatch(/<script|<image|<foreignObject|\shref=|\son[a-z]+=/i);
}

/** An empty, uncached 404. */
async function expectNotFound(response: Response) {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBeNull();
  expect(await response.text()).toBe("");
}

describe("the thumbnail proxy (02 §7.6, 07 D42)", () => {
  it("serves the owner's mock thumbnail at the post's size", async () => {
    const { demo } = await signedInWithDemo();
    const post01 = await postNumber(demo.account.id, "01");
    const post02 = await postNumber(demo.account.id, "02");
    await expectSvg(await thumbnail(post01.id), "01", 720, 1280);
    await expectSvg(await thumbnail(post02.id), "02", 1080, 1920);
  });

  it("draws a post without a stored size at 1080 × 1920 (07 D150)", async () => {
    const { demo } = await signedInWithDemo();
    const post = await insertSocialPost(demo.account, {
      thumbnailUrl: "mock://thumb/07",
      width: null,
      height: null,
    });
    await expectSvg(await thumbnail(post.id), "07", 1080, 1920);
  });

  it("answers 401 JSON, uncached, without a session", async () => {
    const { demo } = await signedInWithDemo();
    const post01 = await postNumber(demo.account.id, "01");
    mockNextHeaders(null);
    const response = await thumbnail(post01.id);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "unauthorized" } });
  });

  it("answers 404 for an id that isn't a uuid or isn't a post", async () => {
    await signedInWithDemo();
    for (const id of ["not-a-uuid", "1", "%00"]) {
      expect((await thumbnail(id)).status, id).toBe(404);
    }
    await expectNotFound(await thumbnail(randomUUID()));
  });

  it("answers 404 for another creator's post", async () => {
    const { me, demo } = await signedInWithDemo();
    const post01 = await postNumber(demo.account.id, "01");
    await signedInCreator();
    await expectNotFound(await thumbnail(post01.id));
    mockNextHeaders(me.session);
    await expectSvg(await thumbnail(post01.id), "01", 720, 1280);
  });

  it("answers 404 for a stale post, and still serves a removed one", async () => {
    const { demo } = await signedInWithDemo();
    const stale = await postNumber(demo.account.id, "03");
    const removed = await postNumber(demo.account.id, "04");
    await updatePost(stale.id, { status: "stale" });
    await updatePost(removed.id, { status: "removed", removedAt: new Date() });
    await expectNotFound(await thumbnail(stale.id));
    await expectSvg(await thumbnail(removed.id), "04", 1080, 1920);
  });

  it("answers 404 when there is no stored thumbnail or it isn't a mock thumbnail", async () => {
    const { demo } = await signedInWithDemo();
    for (const thumbnailUrl of [
      null,
      "mock://avatar/01",
      "mock://thumb/00",
      "mock://thumb/1",
      "mock://thumb/100",
      "mock://thumb/01/",
      "https://example.com/thumb/01.jpg",
    ]) {
      const post = await insertSocialPost(demo.account, { thumbnailUrl });
      await expectNotFound(await thumbnail(post.id));
    }
  });

  it("answers 404 for a mock URL on a real platform's post", async () => {
    const { me } = await signedInWithDemo();
    const youtube = await insertSocialAccount(
      { id: me.creatorId },
      { provider: "youtube" },
    );
    const post = await insertSocialPost(youtube, {
      thumbnailUrl: "mock://thumb/01",
    });
    await expectNotFound(await thumbnail(post.id));
  });
});

describe("streamPlatformImage({ kind: 'thumbnail' })", () => {
  it("serves the creator's own post and 404s for any other actor", async () => {
    const owner = await syncedDemo();
    const other = await syncedDemo();
    const post01 = await postNumber(owner.account.id, "01");
    const image = (actor: typeof owner.actor) =>
      streamPlatformImage({ kind: "thumbnail", postId: post01.id }, actor);

    await expectSvg(await image(owner.actor), "01", 720, 1280);
    await expectNotFound(await image(other.actor));
    await expectNotFound(await image({ kind: "system", source: "cron" }));
  });
});
