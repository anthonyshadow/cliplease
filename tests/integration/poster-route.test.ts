import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET } from "../../src/app/api/media/posters/[videoId]/route";
import { db } from "../../src/db/client";
import { video } from "../../src/db/schema";
import { env } from "../../src/server/env";
import {
  mockNextHeaders,
  newCreatorEmail,
  type SignedInCreator,
  signInWithOtp,
  userByEmail,
} from "../helpers/auth";
import {
  type Bytes,
  fixture,
  newDraft,
  objectPath,
  signedIn,
  trackTestStorage,
  uploadPoster,
} from "../helpers/uploads";

// GET /api/media/posters/[videoId], the owner/admin branch (P10b; 02 §4.2, §6.2): the owner or an admin gets the stored
// JPEG, private and uncached; everyone and everything else gets the same empty, uncached 404.
vi.mock("next/headers", () => import("../helpers/next-headers"));

const disk = trackTestStorage();

afterAll(() => disk.clean());
beforeEach(() => mockNextHeaders(null));

/** In .env.test's ADMIN_EMAILS: its first sign-in makes it an admin (07 D88). */
const ADMIN_EMAIL = "e2e-admin@example.com";

let jpeg: Bytes;
let owner: SignedInCreator;
/** The owner's draft with a stored poster. */
let withPoster: { id: string; key: string };

async function draftWithPoster(me: SignedInCreator) {
  const id = await newDraft(disk, me);
  const { upload, result } = await uploadPoster(me.actor, id, jpeg);
  if (!result.ok) throw new Error(`poster refused: ${result.code}`);
  return { id, key: upload.key };
}

beforeAll(async () => {
  jpeg = await fixture("poster.jpg");
  owner = await signedIn(disk);
  withPoster = await draftWithPoster(owner);
});

/** The browser's GET, through the route's handler with the session the mocked next/headers holds. */
function getPoster(videoId: string, query = "") {
  const url = new URL(
    `/api/media/posters/${encodeURIComponent(videoId)}${query}`,
    env.APP_URL,
  );
  return GET(new NextRequest(url), { params: Promise.resolve({ videoId }) });
}

async function expectPoster(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-length")).toBe(String(jpeg.length));
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg);
}

async function expectNotFound(response: Response) {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toBe("");
}

describe("the poster's owner and admins", () => {
  it("serves the owner the stored JPEG, private and uncached, whatever ?v= says", async () => {
    mockNextHeaders(owner.session);
    for (const query of ["", "?v=0badf00d", "?v=anything"]) {
      await expectPoster(await getPoster(withPoster.id, query));
    }
  });

  it("serves an admin with no creator profile", async () => {
    mockNextHeaders(await signInWithOtp(ADMIN_EMAIL));
    expect((await userByEmail(ADMIN_EMAIL))?.role).toBe("admin");
    await expectPoster(await getPoster(withPoster.id));
  });
});

describe("everyone else and everything else: an empty 404", () => {
  it("when signed out", async () => {
    await expectNotFound(await getPoster(withPoster.id));
  });

  it("for another creator", async () => {
    await signedIn(disk);
    await expectNotFound(await getPoster(withPoster.id));
  });

  it("for a signed-in user without a creator profile", async () => {
    mockNextHeaders(await signInWithOtp(newCreatorEmail()));
    await expectNotFound(await getPoster(withPoster.id));
  });

  it("for an id that isn't a uuid, and a uuid with no video", async () => {
    mockNextHeaders(owner.session);
    for (const id of ["not-a-uuid", `${withPoster.id}x`, randomUUID()]) {
      await expectNotFound(await getPoster(id));
    }
  });

  it("for the owner's video without a poster", async () => {
    mockNextHeaders(owner.session);
    await expectNotFound(await getPoster(await newDraft(disk, owner)));
  });

  it("for a poster key that names another video", async () => {
    const id = await newDraft(disk, owner);
    await db
      .update(video)
      .set({ posterObjectKey: withPoster.key, posterOrigin: "frame_capture" })
      .where(eq(video.id, id));
    mockNextHeaders(owner.session);
    await expectNotFound(await getPoster(id));
  });

  it("for a poster whose object is gone from storage", async () => {
    const gone = await draftWithPoster(owner);
    await rm(objectPath(gone.key));
    mockNextHeaders(owner.session);
    await expectNotFound(await getPoster(gone.id));
  });
});
