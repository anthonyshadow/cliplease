import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  adminDisableVideo,
  adminEnableVideo,
} from "../../src/app/admin/actions";
import { db } from "../../src/db/client";
import {
  auditEvent,
  downloadEvent,
  emailLog,
  licenseRequest,
  socialAccount,
  stripeEvent,
  video,
} from "../../src/db/schema";
import type { LicenseRequest, Video } from "../../src/db/schema/types";
import { tileAction } from "../../src/lib/library/post";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { refusedOnYourVideo } from "../../src/lib/postings/copy";
import { GENERIC_ERROR_MESSAGE } from "../../src/lib/result";
import {
  listAdminConnections,
  listAdminCreators,
  listAdminEvents,
  listAdminLicenses,
  listAdminRequests,
  listAdminVideos,
} from "../../src/server/admin/queries";
import { writeAudit } from "../../src/server/audit";
import { type Actor, LAZY } from "../../src/server/auth/actor";
import { env } from "../../src/server/env";
import { getLibraryPost } from "../../src/server/library/queries";
import { approveLicenseRequest } from "../../src/server/licensing/approve";
import {
  autoApproveRequest,
  retryAutoApprovals,
} from "../../src/server/licensing/auto-approve";
import {
  createLicenseRequest,
  declineLicenseRequest,
} from "../../src/server/licensing/requests";
import { claimPaymentAction } from "../../src/server/licensing/state-machine";
import type { PaymentsEvent } from "../../src/server/payments/driver";
import { onWebhookEvent } from "../../src/server/payments/events";
import {
  AlreadyLicensableElsewhereError,
  AlreadyOnYourVideoError,
} from "../../src/server/postings/errors";
import {
  recheckPosting,
  saveVideoPostings,
} from "../../src/server/postings/save";
import { disconnectSocialAccount } from "../../src/server/social/disconnect";
import {
  mockTokensFor,
  setMockScenarioForTests,
} from "../../src/server/social/providers/mock";
import { syncSocialAccount } from "../../src/server/social/sync";
import { sealTokenColumns } from "../../src/server/social/tokens";
import { localDriver } from "../../src/server/storage/index";
import { posterKey } from "../../src/server/storage/keys";
import { adminSetVideoDisabled } from "../../src/server/videos/admin";
import { createVideoFromPost } from "../../src/server/videos/create";
import { confirmSameVideo } from "../../src/server/videos/edit";
import { VideoNotFoundError } from "../../src/server/videos/errors";
import { posterResponse } from "../../src/server/videos/poster";
import { readLicensePageData } from "../../src/server/videos/public";
import { publishVideo as turnOn } from "../../src/server/videos/publish";
import { NOT_FOUND, redirectTo } from "../helpers/actions";
import { flushAfter } from "../helpers/after";
import {
  approvingCreatorWithVideo,
  autoWaitingRequest,
  overdue,
  pendingCheckoutRequest,
  waitingRequest,
} from "../helpers/approval-fixtures";
import {
  creatorActor,
  mockNextHeaders,
  signedInCreator,
  signInWithOtp,
  userByEmail,
} from "../helpers/auth";
import {
  auditsOf,
  insertDemoAccount,
  postNumber,
} from "../helpers/connect-flow";
import {
  insertCreator,
  insertLibraryVideo,
  insertLicense,
  insertLicenseRequest,
  insertMoneyMovement,
  insertRateCard,
  insertSocialAccount,
  insertSocialPost,
  insertUploadVideo,
  insertUser,
  publishVideo,
  randomHex,
  requestRow,
  videoRow,
} from "../helpers/factories";
import { readAllPages, syncedDemo } from "../helpers/library";
import {
  confirmedAt,
  twoCreatorsOnOneAccount,
} from "../helpers/library-videos";
import { AFTER_FAILED, recordStderr } from "../helpers/logs";
import {
  backdateCheckedAt,
  expectOwnershipInvariant,
  postingRow,
  postingsOf,
} from "../helpers/postings";
import { readLatestEmail } from "../helpers/read-latest-email";
import { pricedCreator, readyUpload } from "../helpers/ready-videos";
import { checkoutInput, REQUEST_CTX } from "../helpers/request-flow";
import {
  emailTemplatesOf,
  endingsOf,
  fallbacksOf,
  licensesOf,
  outcomeEmails,
} from "../helpers/request-outcomes";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  expectInvariant,
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";
import { fixture, trackTestStorage } from "../helpers/uploads";

// The admin's Disable and Enable and the admin read model (P21; 01 A.3, A.4, A.6, J7.16, J8.10; 02 §5.6, §6.1; 03 T8,
// T9; 07 D24, D27, D28, D34, D45, D66, D68, D69, D110, D111; owner answers Q-197 a, Q-198 a; design/P21-admin-view.md
// §4.2–§4.10 and §8). Disable is one transaction under the video's lock (the status, the reason and note, the release
// of the verified postings and the ownership), then a sweep outside any transaction that declines each waiting request
// as video_disabled through the decline claim, or expires an overdue one; Enable brings a disabled video back Off. A
// disabled video can't be approved: the capture claim refuses it, and the creator's Approve, auto-approve and its
// give-up decline the request instead (Q-197 a). The six loaders return plain DTOs with no secret and write nothing.
// The payments driver is the scripted double, so every cancel is recorded with the claim it ran under.

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() runs at once: the outcome emails go out, and each test waits for them.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("../helpers/after")).runAfter,
}));

// The actions' session from mocked headers (and the poster route's), their refresh() counted.
vi.mock("next/headers", () => import("../helpers/next-headers"));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

/** In .env.test's ADMIN_EMAILS: its first sign-in makes it an admin (07 D88). */
const ADMIN_EMAIL = "e2e-admin@example.com";

const disk = trackTestStorage();
let scripted: ScriptedPayments;
let admin: Actor;

beforeAll(async () => {
  admin = await newAdmin();
});
beforeEach(() => {
  scripted = installScriptedPayments();
  mockNextHeaders(null);
  vi.mocked(refresh).mockClear();
  recordStderr(AFTER_FAILED);
});
afterEach(async () => {
  setMockScenarioForTests(null);
  await expectOwnershipInvariant();
  await finishScriptedTest();
});
afterAll(() => disk.clean());

/** An admin actor on a real user row (audit_event.actor_user_id references it), as requireAdmin's user builds it. */
async function newAdmin(): Promise<Actor> {
  const row = await insertUser({ role: "admin" });
  return { kind: "admin", userId: row.id };
}

/**
 * Disable as `by` (the shared admin unless given): reason Rights claim, note "ticket-1" unless `change` says otherwise;
 * `sweepOnly` is the sheet's Try again.
 */
const disable = (
  videoId: string,
  change: {
    reason?: "rights_claim" | "prohibited_content" | "other";
    note?: string;
    sweepOnly?: boolean;
  } = {},
  by: Actor = admin,
) =>
  adminSetVideoDisabled(by, {
    disabled: true,
    videoId,
    reason: "rights_claim",
    note: "ticket-1",
    ...change,
  });

const enable = (videoId: string, by: Actor = admin) =>
  adminSetVideoDisabled(by, { disabled: false, videoId });

/** A waiting request on `live` (`overrides` into its insert), its PaymentIntent tracked as a hold that still waits. */
async function waitingOn(
  live: Pick<Video, "id" | "creatorId">,
  overrides: Partial<LicenseRequest> = {},
) {
  const { row, token } = await waitingRequest(live, overrides);
  scripted.seedPi(`pi_fake_${row.id}`);
  return { row, token };
}

/** An auto_approve request on `live` authorized `minutesAgo`, its hold tracked. */
async function autoWaitingOn(live: Video, minutesAgo?: number) {
  const { row } = await autoWaitingRequest(live, minutesAgo);
  scripted.seedPi(`pi_fake_${row.id}`);
  return row;
}

/** The cancel keys the double saw for `requestId`, in order. */
const cancelKeys = (requestId: string) =>
  scripted
    .callsOf("cancel")
    .filter((call) => call.requestId === requestId)
    .map((call) => call.key);

/** An ending's transition audit (07 D47): a system actor's keeps its source in data. */
function ending(
  to: "declined" | "expired",
  by: "admin" | "lazy" | "auto_approve",
) {
  const data = { from: "awaiting_approval", to, event: to };
  return by === "admin"
    ? { data, actorType: "admin" }
    : { data: { ...data, source: by }, actorType: "system" };
}

/** A request the admin's sweep declined (07 D28): declined / video_disabled, the decline claim kept, never charged. */
const DECLINED_DISABLED = {
  status: "declined",
  statusReason: "video_disabled",
  declinedAt: expect.any(Date),
  paymentAction: "decline",
};

/** The video's audit rows of `action`, with the acting user. */
const videoAudits = (videoId: string, action: string) =>
  db
    .select({
      data: auditEvent.data,
      actorType: auditEvent.actorType,
      actorUserId: auditEvent.actorUserId,
    })
    .from(auditEvent)
    .where(
      and(eq(auditEvent.entityId, videoId), eq(auditEvent.action, action)),
    );

/** One outcome email, sent on the first attempt. */
const sentOnce = (template: string) => ({
  template,
  status: "sent",
  attempts: 1,
});

/** A published Library video (its verified Demo source posting) of a creator with a rate card, and the creator. */
async function liveLibraryVideo() {
  const d = await syncedDemo();
  await insertRateCard({ id: d.account.creatorId });
  const post = await postNumber(d.account.id, "01");
  const { videoId } = await createVideoFromPost(d.actor, post.id);
  const live = await publishVideo(
    { id: videoId, creatorId: d.account.creatorId },
    { sameVideoConfirmedAt: new Date() },
  );
  const [source] = await postingsOf(videoId);
  if (!source) throw new Error("no source posting");
  return { d, post, live, source };
}

describe("A.4 / J8.10: Disable declines the video's waiting requests without charging anyone", () => {
  it("A.4 / J8.10: declines an awaiting_approval request as video_disabled through the decline claim: one cancel after the commit, the claim kept, the buyer's request-declined, no creator email", async () => {
    const { live } = await approvingCreatorWithVideo();
    const { row, token } = await waitingOn(live);
    const since = Date.now();
    let statusAtCancel: string | undefined;
    scripted.onCall(
      "cancel",
      async () => {
        statusAtCancel = (await videoRow(live.id)).status;
      },
      { phase: "before", times: 1 },
    );

    expect(await disable(live.id)).toEqual({
      stillOpen: 0,
      capturing: 0,
      disabled: true,
    });

    expect(await videoRow(live.id)).toMatchObject({
      status: "disabled",
      disabledAt: expect.any(Date),
      disabledReason: "rights_claim",
      disabledNote: "ticket-1",
    });
    // The disable committed before Stripe was called, and so did the decline claim (07 D24).
    expect(statusAtCancel).toBe("disabled");
    expect(scripted.callsOf("cancel")[0]?.committed).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "decline",
      stripeAttempt: 1,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${row.id}:decline:1`, "requested_by_customer"],
    ]);
    expect(scripted.keys("capture")).toEqual([]);
    expect(await requestRow(row.id)).toMatchObject({
      ...DECLINED_DISABLED,
      stripeAttempt: 1,
    });
    expect(await endingsOf(row.id)).toEqual([ending("declined", "admin")]);

    await flushAfter();
    expect(await outcomeEmails(row.id)).toEqual([sentOnce("request-declined")]);
    // Only the authorization's two before it: nothing new for the creator (07 D34).
    expect(await emailTemplatesOf(row.id)).toEqual([
      "request-declined",
      "request-new",
      "request-received",
    ]);
    const sent = await readLatestEmail({
      to: row.buyerEmail,
      template: "request-declined",
      since,
    });
    expect(sent.text).toContain(REQUEST_STATUS_COPY.videoDisabledBody);
    expect(sent.text).toContain(token);
    await expectInvariant(row.id);
  });

  it("declines an auto-approving request too: an admin never waits for auto-approve (07 D28)", async () => {
    const { creator, live } = await approvingCreatorWithVideo();
    const row = await autoWaitingOn(live);
    // The creator would wait (AD-112); the admin doesn't.
    expect(
      await declineLicenseRequest(row.id, {
        kind: "creator",
        userId: creator.userId,
        creatorId: creator.id,
      }),
    ).toMatchObject({ ok: false, reason: "not_actionable" });

    expect(await disable(live.id)).toEqual({
      stillOpen: 0,
      capturing: 0,
      disabled: true,
    });
    expect(await requestRow(row.id)).toMatchObject(DECLINED_DISABLED);
    expect(cancelKeys(row.id)).toEqual([`pi-cancel:${row.id}:decline:1`]);
    expect(await fallbacksOf(row.id)).toEqual([]);
    await expectInvariant(row.id);
  });

  it("expires an overdue request (T9) instead of declining it", async () => {
    const { live } = await approvingCreatorWithVideo();
    const { row } = await waitingOn(live);
    await overdue(row.id);

    expect(await disable(live.id)).toEqual({
      stillOpen: 0,
      capturing: 0,
      disabled: true,
    });
    expect(await requestRow(row.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      paymentAction: "expire",
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${row.id}:expire:1`, "abandoned"],
    ]);
    expect(await endingsOf(row.id)).toEqual([ending("expired", "admin")]);
    await expectInvariant(row.id);
  });

  it("leaves a request under a fresh capture claim to its holder and counts it in capturing, not stillOpen (Q-202); Try again changes nothing else", async () => {
    const { live } = await approvingCreatorWithVideo();
    const { row } = await waitingOn(live);
    const declined = await waitingOn(live);
    const held = await claimPaymentAction(row.id, "capture");
    if (!held || "conflict" in held) throw new Error("not claimed");

    expect(await disable(live.id)).toEqual({
      stillOpen: 0,
      capturing: 1,
      disabled: true,
    });
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      paymentActionAt: held.paymentActionAt,
      stripeAttempt: 1,
    });
    expect(cancelKeys(row.id)).toEqual([]);
    expect(await requestRow(declined.row.id)).toMatchObject(DECLINED_DISABLED);

    // The sheet's Try again (Q-198 a): the sweep again, no second disable.
    expect(
      await disable(live.id, {
        reason: "other",
        note: "again",
        sweepOnly: true,
      }),
    ).toEqual({ stillOpen: 0, capturing: 1, disabled: true });
    expect(await videoRow(live.id)).toMatchObject({
      disabledReason: "rights_claim",
      disabledNote: "ticket-1",
    });
    expect(await videoAudits(live.id, "video.disabled")).toHaveLength(1);
    expect(cancelKeys(row.id)).toEqual([]);
  });

  it("leaves a request whose decline Stripe couldn't confirm waiting, unclaimed, and counted (Q-198 a)", async () => {
    const { live } = await approvingCreatorWithVideo();
    const { row } = await waitingOn(live);
    scripted.next("cancel", "transient");

    expect(await disable(live.id)).toEqual({
      stillOpen: 1,
      capturing: 0,
      disabled: true,
    });
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 1,
    });

    // Try again declines it under the next attempt's key.
    expect(await disable(live.id, { sweepOnly: true })).toEqual({
      stillOpen: 0,
      capturing: 0,
      disabled: true,
    });
    expect(cancelKeys(row.id)).toEqual([
      `pi-cancel:${row.id}:decline:1`,
      `pi-cancel:${row.id}:decline:2`,
    ]);
    expect(await requestRow(row.id)).toMatchObject({
      ...DECLINED_DISABLED,
      stripeAttempt: 2,
    });
    await expectInvariant(row.id);
  });

  it("stops starting requests once another admin enabled the video (07 D88)", async () => {
    const { live } = await approvingCreatorWithVideo();
    const first = await waitingOn(live);
    const second = await waitingOn(live);
    const other = await newAdmin();
    // The first cancel arrives; the other admin enables the video before the sweep reaches the second request.
    scripted.onCall("cancel", () => enable(live.id, other), {
      phase: "before",
      times: 1,
    });

    expect(await disable(live.id)).toEqual({
      stillOpen: 1,
      capturing: 0,
      disabled: false,
    });
    const [firstRow, secondRow] = await Promise.all([
      requestRow(first.row.id),
      requestRow(second.row.id),
    ]);
    const swept = [firstRow, secondRow].filter((r) => r.status === "declined");
    expect(swept).toHaveLength(1);
    expect(scripted.callsOf("cancel")).toHaveLength(1);
    expect((await videoRow(live.id)).status).toBe("unpublished");
  });
});

describe("Try again (owner answer Q-198 a): sweepOnly never disables the video again", () => {
  /** The video, its source posting and the request, as rows. */
  const rowsOf = (videoId: string, postingId: string, requestId: string) =>
    Promise.all([
      videoRow(videoId),
      postingRow(postingId),
      requestRow(requestId),
    ]);

  it("on a video that isn't disabled it changes nothing: no audit, no posting released, no request swept, no Stripe call", async () => {
    const { live, source } = await liveLibraryVideo();
    const { row } = await waitingOn(live);
    const before = await rowsOf(live.id, source.id, row.id);

    expect(await disable(live.id, { sweepOnly: true })).toEqual({
      stillOpen: 1,
      capturing: 0,
      disabled: false,
    });
    expect(await rowsOf(live.id, source.id, row.id)).toEqual(before);
    expect(before[0].status).toBe("published");
    expect(before[1].verification).toBe("verified");
    expect(scripted.log).toEqual([]);
    expect(await videoAudits(live.id, "video.disabled")).toEqual([]);
    expect(await auditsOf(source.id, "video_posting.released")).toEqual([]);
  });

  it("after another admin's Enable, the sheet's Try again leaves the video enabled and answers disabled: false", async () => {
    const { live, source } = await liveLibraryVideo();
    const { row } = await waitingOn(live);
    scripted.next("cancel", "transient");
    expect(await disable(live.id)).toEqual({
      stillOpen: 1,
      capturing: 0,
      disabled: true,
    });
    await enable(live.id, await newAdmin());
    const before = await rowsOf(live.id, source.id, row.id);
    const calls = scripted.callsFromNow();

    expect(await disable(live.id, { sweepOnly: true })).toEqual({
      stillOpen: 1,
      capturing: 0,
      disabled: false,
    });
    expect(await rowsOf(live.id, source.id, row.id)).toEqual(before);
    expect(before[0]).toMatchObject({
      status: "unpublished",
      disabledReason: null,
    });
    expect(before[2]).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
    });
    expect(calls()).toEqual([]);
    expect(await videoAudits(live.id, "video.disabled")).toHaveLength(1);
    expect(await videoAudits(live.id, "video.enabled")).toHaveLength(1);
    expect(await auditsOf(source.id, "video_posting.released")).toHaveLength(1);
  });
});

describe("Release (07 D66): Disable frees the video's verified postings for the rightful owner", () => {
  it("releases a published Library video's verified posting in the disable's transaction: unverified / released, its ids kept, one video_posting.released, ownership self_attested, the same-video tick cleared", async () => {
    const { live, source } = await liveLibraryVideo();
    expect(source.verification).toBe("verified");

    await disable(live.id);

    expect(await postingRow(source.id)).toEqual({
      ...source,
      verification: "unverified",
      unverifiedReason: "released",
      updatedAt: expect.any(Date),
    });
    expect(await auditsOf(source.id, "video_posting.released")).toEqual([
      { data: { videoId: live.id, platform: "mock" }, actorType: "admin" },
    ]);
    expect(await videoRow(live.id)).toMatchObject({
      ownership: "self_attested",
      sameVideoConfirmedAt: null,
    });
  });

  it("lets another creator verify the same post with no unique violation, flagged as video_posting.conflict; after Enable the first creator's Check again is refused", async () => {
    setMockScenarioForTests("shared_account");
    const {
      a,
      made: { videoId },
      b,
      bPost,
    } = await twoCreatorsOnOneAccount((creator, id) =>
      createVideoFromPost(creator.actor, id),
    );
    const bUpload = await insertUploadVideo({ id: b.creatorId });
    const save = () =>
      saveVideoPostings(b.actor, {
        videoId: bUpload.id,
        notPosted: false,
        postings: [{ platform: "mock", link: bPost.permalink }],
      });
    await expect(save()).rejects.toBeInstanceOf(
      AlreadyLicensableElsewhereError,
    );

    // A's draft, disabled (Disable works from draft too).
    expect(await disable(videoId)).toEqual({
      stillOpen: 0,
      capturing: 0,
      disabled: true,
    });
    const [released] = await postingsOf(videoId);
    expect(released).toMatchObject({
      verification: "unverified",
      unverifiedReason: "released",
    });

    const saved = await save();
    expect(saved.ok).toBe(true);
    const [theirs] = await postingsOf(bUpload.id);
    expect(theirs).toMatchObject({
      verification: "verified",
      linkKey: bPost.linkKey,
    });
    expect(await auditsOf(theirs?.id ?? "", "video_posting.conflict")).toEqual([
      {
        data: {
          videoPostingId: theirs?.id,
          platform: "mock",
          conflictingPostingIds: [released?.id],
        },
        actorType: "creator",
      },
    ]);

    await enable(videoId);
    expect((await videoRow(videoId)).status).toBe("unpublished");
    if (!released) throw new Error("no released posting");
    await backdateCheckedAt(released.id);
    await expect(
      recheckPosting(a.actor, { postingId: released.id }),
    ).rejects.toBeInstanceOf(AlreadyLicensableElsewhereError);
    expect(await postingRow(released.id)).toMatchObject({
      verification: "unverified",
      unverifiedReason: "released",
    });
  });
});

describe("Q-204: while a video is disabled, the post it released stays its creator's", () => {
  /** The post's tiles in the creator's Library (every page) and its Source page's post, as the creator reads them. */
  async function libraryRows(actor: Actor, postId: string) {
    const pages = await readAllPages(actor);
    return {
      tiles: pages.flat().filter((p) => p.id === postId),
      source: await getLibraryPost(actor, postId),
    };
  }
  const videoCount = (creatorId: string) =>
    db.$count(video, eq(video.creatorId, creatorId));

  it("the creator's Make licensable opens the disabled video instead of a new one, and their Library shows the post as already used", async () => {
    const { d, post, live } = await liveLibraryVideo();
    await disable(live.id);
    const videos = await videoCount(d.account.creatorId);

    // A second press opens the video that holds the post (07 D72), as for any of the creator's own videos.
    expect(await createVideoFromPost(d.actor, post.id)).toEqual({
      videoId: live.id,
    });
    expect(await videoCount(d.account.creatorId)).toBe(videos);

    const { tiles, source } = await libraryRows(d.actor, post.id);
    const used = { id: live.id, status: "disabled" };
    expect(tiles.map((tile) => [tile.video, tileAction(tile)])).toEqual([
      [used, "Open video"],
    ]);
    expect(source?.video).toEqual(used);
  });

  it("refuses the creator's verify of it on another of their videos with the already-on-your-video refusal naming the disabled video", async () => {
    const { d, post, live } = await liveLibraryVideo();
    await disable(live.id);
    const upload = await insertUploadVideo({ id: d.account.creatorId });

    const refused = await saveVideoPostings(d.actor, {
      videoId: upload.id,
      notPosted: false,
      postings: [{ platform: "mock", link: post.permalink }],
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AlreadyOnYourVideoError);
    expect(refused).toMatchObject({ videoTitle: live.title, index: 0 });
    expect(refusedOnYourVideo(live.title)).toBe(
      `This post is already on your video “${live.title}”.`,
    );
    expect(await postingsOf(upload.id)).toEqual([]);
  });

  it("lets another creator make the same post licensable (07 D66)", async () => {
    const { d, post, live } = await liveLibraryVideo();
    await disable(live.id);
    // The platform account changes hands: its creator disconnects it, another creator links it and syncs it.
    await disconnectSocialAccount(d.account.id, d.actor);
    const other = await insertCreator();
    const id = randomUUID();
    const account = await insertSocialAccount(other, {
      id,
      providerAccountId: d.account.providerAccountId,
      username: "demo.creator",
      ...sealTokenColumns(id, mockTokensFor(d.userId, "other")),
    });
    const actor = creatorActor({ creatorId: other.id, userId: other.userId });
    expect(await syncSocialAccount(account.id, actor)).toMatchObject({
      ok: true,
    });
    const theirPost = await postNumber(account.id, "01");
    expect(theirPost.linkKey).toBe(post.linkKey);

    const theirs = await createVideoFromPost(actor, theirPost.id);
    expect(theirs.videoId).not.toBe(live.id);
    expect(await postingsOf(theirs.videoId)).toMatchObject([
      { creatorId: other.id, verification: "verified", linkKey: post.linkKey },
    ]);
    expect((await libraryRows(actor, theirPost.id)).source?.video).toEqual({
      id: theirs.videoId,
      status: "draft",
    });
    // The disabled video's released posting is untouched.
    expect(await postingsOf(live.id)).toMatchObject([
      { verification: "unverified", unverifiedReason: "released" },
    ]);
  });

  it("after Enable the hold ends: the Library offers the post again and the creator's Check again on the same video verifies it", async () => {
    const { d, post, live, source } = await liveLibraryVideo();
    await disable(live.id);
    await enable(live.id);
    expect((await libraryRows(d.actor, post.id)).source?.video).toBeNull();

    await backdateCheckedAt(source.id);
    expect(
      await recheckPosting(d.actor, { postingId: source.id }),
    ).toMatchObject({ verification: "verified", unverifiedReason: null });
    expect((await libraryRows(d.actor, post.id)).source?.video).toEqual({
      id: live.id,
      status: "unpublished",
    });
  });

  it("a post re-listed after an Enable stays on its new video when the old one is disabled again: one Library row, and that video's own Check again isn't refused", async () => {
    const { d, post, live } = await liveLibraryVideo();
    await disable(live.id);
    await enable(live.id);
    const { videoId: relisted } = await createVideoFromPost(d.actor, post.id);
    expect(relisted).not.toBe(live.id);
    // The old video, disabled again: its posting was released the first time and still is.
    await disable(live.id);
    expect((await postingsOf(live.id))[0]).toMatchObject({
      unverifiedReason: "released",
    });

    const { tiles, source } = await libraryRows(d.actor, post.id);
    const onRelisted = { id: relisted, status: "draft" };
    expect(tiles.map((tile) => tile.video)).toEqual([onRelisted]);
    expect(source?.video).toEqual(onRelisted);
    expect(await createVideoFromPost(d.actor, post.id)).toEqual({
      videoId: relisted,
    });
    const [relistedSource] = await postingsOf(relisted);
    if (!relistedSource) throw new Error("no source posting");
    await backdateCheckedAt(relistedSource.id);
    expect(
      await recheckPosting(d.actor, { postingId: relistedSource.id }),
    ).toMatchObject({ verification: "verified" });
    // Another of the creator's videos is refused, naming the verified holder first.
    const upload = await insertUploadVideo({ id: d.account.creatorId });
    await expect(
      saveVideoPostings(d.actor, {
        videoId: upload.id,
        notPosted: false,
        postings: [{ platform: "mock", link: post.permalink }],
      }),
    ).rejects.toMatchObject({
      name: "AlreadyOnYourVideoError",
      videoTitle: (await videoRow(relisted)).title,
    });
  });
});

describe("Q-197 a: a disabled video can't be approved", () => {
  /** A request Disable couldn't decline yet (its cancel transient): still waiting on the disabled video. */
  async function leftOpen(row: LicenseRequest, live: Video) {
    scripted.next("cancel", "transient");
    expect(await disable(live.id)).toEqual({
      stillOpen: 1,
      capturing: 0,
      disabled: true,
    });
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
    });
  }

  it("a creator's Approve declines the request as the system with video_disabled: nothing captured or issued", async () => {
    const { actor, live } = await approvingCreatorWithVideo();
    const { row } = await waitingOn(live);
    await leftOpen(row, live);

    expect(await approveLicenseRequest(row.id, actor)).toEqual({
      ok: false,
      reason: "not_actionable",
      status: "declined",
    });
    expect(scripted.keys("capture")).toEqual([]);
    expect(await licensesOf(row.id)).toEqual([]);
    expect(await requestRow(row.id)).toMatchObject({
      ...DECLINED_DISABLED,
      stripeAttempt: 2,
    });
    expect(cancelKeys(row.id)).toEqual([
      `pi-cancel:${row.id}:decline:1`,
      `pi-cancel:${row.id}:decline:2`,
    ]);
    expect(await endingsOf(row.id)).toEqual([ending("declined", "lazy")]);
    await flushAfter();
    expect(await outcomeEmails(row.id)).toEqual([sentOnce("request-declined")]);
    await expectInvariant(row.id);
  });

  it("the capture claim refuses a disabled video with nothing written; an unpublished one stays approvable (01 J5.20)", async () => {
    const { live } = await approvingCreatorWithVideo();
    const { row } = await waitingOn(live);
    await db
      .update(video)
      .set({ status: "unpublished" })
      .where(eq(video.id, live.id));
    const claimed = await claimPaymentAction(row.id, "capture");
    expect(claimed).toMatchObject({ paymentAction: "capture" });
    if (!claimed || "conflict" in claimed) throw new Error("not claimed");

    const other = await waitingOn(live);
    await db
      .update(video)
      .set({
        status: "disabled",
        disabledAt: new Date(),
        disabledReason: "other",
      })
      .where(eq(video.id, live.id));
    const before = await requestRow(other.row.id);
    expect(await claimPaymentAction(other.row.id, "capture")).toEqual({
      conflict: "video_disabled",
    });
    expect(await requestRow(other.row.id)).toEqual(before);
  });

  it("an auto-approval declines it as auto_approve: never captured nor handed to the creator", async () => {
    const { live } = await approvingCreatorWithVideo();
    const row = await autoWaitingOn(live, 3);
    await leftOpen(row, live);

    expect(await autoApproveRequest(row.id)).toBe("skipped");
    expect(scripted.keys("capture")).toEqual([]);
    expect(await requestRow(row.id)).toMatchObject({
      ...DECLINED_DISABLED,
      autoApproveFallbackAt: null,
      stripeAttempt: 2,
    });
    expect(await endingsOf(row.id)).toEqual([
      ending("declined", "auto_approve"),
    ]);
    expect(await fallbacksOf(row.id)).toEqual([]);
    expect(await emailTemplatesOf(row.id)).not.toContain("request-new");
    await expectInvariant(row.id);
  });

  it.each([
    ["payouts not active", "payouts"],
    ["an elevated risk level", "risk"],
  ] as const)(
    "the disabled video comes before the guards (%s): declined video_disabled, never handed to the creator (Q-197 a)",
    async (_, guard) => {
      const { live } = await approvingCreatorWithVideo(
        guard === "payouts"
          ? { payoutsStatus: "restricted", payoutsStatusSyncedAt: new Date() }
          : {},
      );
      if (guard === "risk") {
        scripted.script({ getAuthorization: { riskLevel: "elevated" } });
      }
      const row = await autoWaitingOn(live, 3);
      await leftOpen(row, live);
      const calls = scripted.callsFromNow();

      expect(await autoApproveRequest(row.id)).toBe("skipped");
      // No guard ran: the decline's cancel is the only call (the risk guard would have read the authorization).
      expect(calls()).toEqual(["cancel"]);
      expect(await requestRow(row.id)).toMatchObject({
        ...DECLINED_DISABLED,
        autoApproveFallbackAt: null,
        stripeAttempt: 2,
      });
      expect(await endingsOf(row.id)).toEqual([
        ending("declined", "auto_approve"),
      ]);
      expect(await fallbacksOf(row.id)).toEqual([]);
      expect(await emailTemplatesOf(row.id)).not.toContain("request-new");
      await expectInvariant(row.id);
    },
  );

  it("auto-approve's give-up declines it as video_disabled instead of falling back gave_up", async () => {
    const { creator, live } = await approvingCreatorWithVideo();
    const row = await autoWaitingOn(live, 11);
    await leftOpen(row, live);
    const calls = scripted.callsFromNow();

    expect(await retryAutoApprovals({ limit: 10, creatorId: creator.id })).toBe(
      0,
    );
    // No guard and no capture: the give-up's decline is a cancel that can only release the hold.
    expect(calls()).toEqual(["cancel"]);
    expect(await requestRow(row.id)).toMatchObject({
      ...DECLINED_DISABLED,
      autoApproveFallbackAt: null,
    });
    expect(await endingsOf(row.id)).toEqual([
      ending("declined", "auto_approve"),
    ]);
    expect(await fallbacksOf(row.id)).toEqual([]);
    expect(await emailTemplatesOf(row.id)).not.toContain("request-new");
  });

  it("who may decline as video_disabled: the system and an admin; a creator never, and an admin with no other reason", async () => {
    const { actor, live } = await approvingCreatorWithVideo();
    const { row } = await waitingOn(live);
    const before = await requestRow(row.id);
    for (const [who, reason] of [
      [actor, "video_disabled"],
      [admin, "creator"],
      [admin, "exclusive_conflict"],
    ] as const) {
      expect(await declineLicenseRequest(row.id, who, reason)).toEqual({
        ok: false,
        reason: "not_actionable",
        status: null,
      });
    }
    expect(await requestRow(row.id)).toEqual(before);
    expect(scripted.log).toEqual([]);

    expect(await declineLicenseRequest(row.id, LAZY, "video_disabled")).toEqual(
      { ok: true },
    );
    expect(await requestRow(row.id)).toMatchObject(DECLINED_DISABLED);
  });
});

describe("J7.16 and what buyers meet on a disabled video", () => {
  const completed = (row: LicenseRequest): PaymentsEvent => ({
    id: `evt_test_${randomUUID()}`,
    livemode: false,
    appUrl: env.APP_URL,
    type: "checkout.session.completed",
    sessionId: `cs_fake_${row.id}`,
    requestId: row.id,
    paymentIntentId: `pi_fake_${row.id}`,
  });

  it("J7.16: a checkout_pending request the sweep left alone, paid after Disable, is abandoned as video_unavailable and its hold canceled", async () => {
    const { live } = await approvingCreatorWithVideo();
    const { row } = await pendingCheckoutRequest(live);

    expect(await disable(live.id)).toEqual({
      stillOpen: 0,
      capturing: 0,
      disabled: true,
    });
    expect((await requestRow(row.id)).status).toBe("checkout_pending");
    expect(scripted.log).toEqual([]);

    expect(await onWebhookEvent(completed(row), "cad")).toBe("processed");
    expect(await requestRow(row.id)).toMatchObject({
      status: "abandoned",
      statusReason: "video_unavailable",
      stripeAttempt: 1,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${row.id}:video_unavailable:1`, "abandoned"],
    ]);
  });

  it("the license page has nothing, Checkout refuses, and the poster 404s signed out", async () => {
    const { creator } = await pricedCreator();
    const draft = await readyUpload(creator.id);
    disk.video(draft.id);
    const key = posterKey(draft.id);
    await localDriver().putSmall(
      key,
      await fixture("poster.jpg"),
      "image/jpeg",
    );
    const live = await publishVideo(draft, { posterObjectKey: key });
    expect(await readLicensePageData(creator.handle, live.slug)).not.toBeNull();
    expect((await posterResponse(live.id)).status).toBe(200);

    await disable(live.id);

    expect(await readLicensePageData(creator.handle, live.slug)).toBeNull();
    expect(
      await createLicenseRequest(checkoutInput(live.id), REQUEST_CTX),
    ).toEqual({ ok: false, reason: "not_available" });
    const poster = await posterResponse(live.id);
    expect(poster.status).toBe(404);
    expect(poster.headers.get("cache-control")).toBe("no-store");
  });
});

describe("Enable (07 D45, D66)", () => {
  it("brings the video back Off with the disabled fields cleared; the released posting stays unverified until Check again, then Turn on works", async () => {
    const { d, live, source } = await liveLibraryVideo();
    await disable(live.id);

    await enable(live.id);
    expect(await videoRow(live.id)).toMatchObject({
      status: "unpublished",
      disabledAt: null,
      disabledReason: null,
      disabledNote: null,
      ownership: "self_attested",
    });
    expect(await postingRow(source.id)).toMatchObject({
      verification: "unverified",
      unverifiedReason: "released",
    });

    await backdateCheckedAt(source.id);
    expect(
      await recheckPosting(d.actor, { postingId: source.id }),
    ).toMatchObject({ verification: "verified", unverifiedReason: null });
    expect((await videoRow(live.id)).ownership).toBe("verified_owner");
    // Re-verifying changed the verified posts: the tick is asked for again (07 D69).
    expect(await confirmedAt(live.id)).toBeNull();
    expect(await turnOn(d.actor, { videoId: live.id })).toEqual({
      ok: false,
      blockers: ["same_video_unconfirmed"],
    });
    await confirmSameVideo(d.actor, live.id);
    expect(await turnOn(d.actor, { videoId: live.id })).toEqual({
      ok: true,
      slug: live.slug,
    });
    expect((await videoRow(live.id)).status).toBe("published");
  });

  it("brings a disabled draft back unpublished, with no publish date", async () => {
    const { creator } = await pricedCreator();
    const draft = await readyUpload(creator.id);
    await disable(draft.id);
    await enable(draft.id);
    expect(await videoRow(draft.id)).toMatchObject({
      status: "unpublished",
      publishedAt: null,
      disabledReason: null,
    });
  });
});

describe("A.6: one audit row per effective admin action", () => {
  it("A.6: Disable and Enable each write exactly one video.disabled / video.enabled row with the admin actor; the declines add their own transitions; no-ops add none", async () => {
    const { live } = await approvingCreatorWithVideo();
    const { row } = await waitingOn(live);
    const adminUserId = admin.kind === "admin" ? admin.userId : null;

    // Enabling a live video is a no-op.
    await enable(live.id);
    expect(await videoAudits(live.id, "video.enabled")).toEqual([]);
    expect((await videoRow(live.id)).status).toBe("published");

    await disable(live.id, { reason: "other", note: "ticket-7" });
    await disable(live.id);
    expect(await videoAudits(live.id, "video.disabled")).toEqual([
      {
        data: { reason: "other", note: "ticket-7" },
        actorType: "admin",
        actorUserId: adminUserId,
      },
    ]);
    expect(await endingsOf(row.id)).toEqual([ending("declined", "admin")]);

    await enable(live.id);
    await enable(live.id);
    expect(await videoAudits(live.id, "video.enabled")).toEqual([
      {
        data: { previousReason: "other" },
        actorType: "admin",
        actorUserId: adminUserId,
      },
    ]);
  });

  it("writes a disable with no note as note null", async () => {
    const { creator } = await pricedCreator();
    const draft = await readyUpload(creator.id);
    await adminSetVideoDisabled(admin, {
      disabled: true,
      videoId: draft.id,
      reason: "prohibited_content",
    });
    expect(await videoRow(draft.id)).toMatchObject({ disabledNote: null });
    expect(await videoAudits(draft.id, "video.disabled")).toMatchObject([
      { data: { reason: "prohibited_content", note: null } },
    ]);
  });
});

describe("who may call it", () => {
  it("refuses a creator actor (and any other non-admin) with nothing written", async () => {
    const { actor, live } = await approvingCreatorWithVideo();
    const before = await videoRow(live.id);
    for (const who of [actor, LAZY]) {
      await expect(disable(live.id, {}, who)).rejects.toThrow(
        "an admin actor is required",
      );
      await expect(enable(live.id, who)).rejects.toThrow(
        "an admin actor is required",
      );
    }
    expect(await videoRow(live.id)).toEqual(before);
    expect(await videoAudits(live.id, "video.disabled")).toEqual([]);
  });

  it("answers an unknown video with VideoNotFoundError and a bad input with a ZodError", async () => {
    await expect(disable(randomUUID())).rejects.toBeInstanceOf(
      VideoNotFoundError,
    );
    await expect(enable(randomUUID())).rejects.toBeInstanceOf(
      VideoNotFoundError,
    );
    await expect(
      disable(randomUUID(), { sweepOnly: true }),
    ).rejects.toBeInstanceOf(VideoNotFoundError);
    await expect(
      disable(randomUUID(), { note: "x".repeat(201) }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("the admin actions (02 §6.1)", () => {
  it("disable and enable as a signed-in admin: the domain's result as data, then refresh()", async () => {
    const { live } = await approvingCreatorWithVideo();
    mockNextHeaders(await signInWithOtp(ADMIN_EMAIL));
    const signedIn = await userByEmail(ADMIN_EMAIL);
    expect(signedIn?.role).toBe("admin");

    expect(
      await adminDisableVideo({
        videoId: live.id,
        reason: "other",
        note: "  ticket-9  ",
      }),
    ).toEqual({
      ok: true,
      data: { stillOpen: 0, capturing: 0, disabled: true },
    });
    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(1);
    const disabledAudit = [
      {
        data: { reason: "other", note: "ticket-9" },
        actorType: "admin",
        actorUserId: signedIn?.id,
      },
    ];
    expect(await videoAudits(live.id, "video.disabled")).toEqual(disabledAudit);

    // The sheet's Try again passes sweepOnly through: the sweep alone, no second disable.
    expect(
      await adminDisableVideo({
        videoId: live.id,
        reason: "rights_claim",
        sweepOnly: true,
      }),
    ).toEqual({
      ok: true,
      data: { stillOpen: 0, capturing: 0, disabled: true },
    });
    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(2);
    expect(await videoAudits(live.id, "video.disabled")).toEqual(disabledAudit);
    expect((await videoRow(live.id)).disabledReason).toBe("other");

    expect(await adminEnableVideo({ videoId: live.id })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(3);
    expect((await videoRow(live.id)).status).toBe("unpublished");
  });

  it("answers a missing reason with its field error, other bad input and an unknown video with a form error", async () => {
    mockNextHeaders(await signInWithOtp(ADMIN_EMAIL));
    expect(
      await adminDisableVideo({ videoId: randomUUID(), reason: "" }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Choose a reason.",
        fields: { reason: ["Choose a reason."] },
      },
    });
    for (const result of [
      await adminDisableVideo({ videoId: "v1", reason: "other" }),
      await adminEnableVideo({ videoId: "v1" }),
    ]) {
      expect(result).toEqual({
        ok: false,
        error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
      });
    }
    for (const result of [
      await adminDisableVideo({ videoId: randomUUID(), reason: "other" }),
      await adminEnableVideo({ videoId: randomUUID() }),
    ]) {
      expect(result).toEqual({
        ok: false,
        error: { code: "not_found", message: GENERIC_ERROR_MESSAGE },
      });
    }
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
  });

  it("gives a creator the 404 and sends a signed-out visitor to sign in, with nothing written", async () => {
    const { live } = await approvingCreatorWithVideo();
    const input = { videoId: live.id, reason: "other" };
    await signedInCreator();
    await expect(adminDisableVideo(input)).rejects.toMatchObject(NOT_FOUND);
    await expect(adminEnableVideo(input)).rejects.toMatchObject(NOT_FOUND);
    mockNextHeaders(null);
    await expect(adminDisableVideo(input)).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fadmin"),
    );
    expect((await videoRow(live.id)).status).toBe("published");
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
  });
});

describe("the admin read model (01 A.2, A.3; 03 §7.9)", () => {
  /** Every value a loader must never return (01 A.3, G.3, G.4; design §4.6). */
  const SECRETS = {
    accessToken: "v1.kid.iv.tag.access-secret",
    refreshToken: "v1.kid.iv.tag.refresh-secret",
    providerAccountId: `acct-secret-${randomHex(4)}`,
    avatarUrl: "mock://avatar/secret",
    profileUrl: "https://example.com/profile/secret",
    buyerTokenHash: randomHex(32),
    buyerTokenEnc: "v1.kid.iv.tag.buyer-secret",
    ip: "203.0.113.77",
    userAgent: "SecretAgent/1.0",
    downloadIp: "198.51.100.23",
    downloadAgent: "DownloadAgent/2.0",
    originalFilename: "secret-original-name.mp4",
    recipientHash: randomHex(32),
    emailSubject: "Secret subject line",
    providerPostId: `secretpost${randomHex(4)}`,
  };

  /** One of everything, its secrets set, as the newest rows of each table. */
  async function world() {
    const creator = await insertCreator({ payoutCurrency: "cad" });
    const account = await insertDemoAccount(creator);
    const [secretAccount] = await db
      .update(socialAccount)
      .set({
        accessTokenEnc: SECRETS.accessToken,
        refreshTokenEnc: SECRETS.refreshToken,
        providerAccountId: SECRETS.providerAccountId,
        avatarUrl: SECRETS.avatarUrl,
        profileUrl: SECRETS.profileUrl,
      })
      .where(eq(socialAccount.id, account.id))
      .returning();
    if (!secretAccount) throw new Error("no account");
    const post = await insertSocialPost(account, {
      providerPostId: SECRETS.providerPostId,
    });
    const { video: draft, posting } = await insertLibraryVideo(account, post);
    const live = await publishVideo(draft, {
      originalFilename: SECRETS.originalFilename,
      sameVideoConfirmedAt: new Date(),
    });
    const request = await insertLicenseRequest(live, {
      status: "approved",
      exclusive: false,
      buyerTokenHash: SECRETS.buyerTokenHash,
      buyerTokenEnc: SECRETS.buyerTokenEnc,
      termsAcceptedIp: SECRETS.ip,
      termsAcceptedUserAgent: SECRETS.userAgent,
      stripeCheckoutSessionId: `cs_test_${randomHex(4)}`,
      stripePaymentIntentId: `pi_test_${randomHex(4)}`,
      stripeChargeId: `ch_test_${randomHex(4)}`,
    });
    const issued = await insertLicense(request);
    await insertMoneyMovement(request, {
      status: "failed",
      lastError: "account_closed",
    });
    await db.insert(downloadEvent).values({
      licenseId: issued.id,
      kind: "pdf",
      ip: SECRETS.downloadIp,
      userAgent: SECRETS.downloadAgent,
    });
    const [email] = await db
      .insert(emailLog)
      .values({
        template: "request-declined",
        recipientHash: SECRETS.recipientHash,
        subject: SECRETS.emailSubject,
        entityType: "license_request",
        entityId: request.id,
        idempotencyKey: `request-declined/${randomUUID()}`,
        status: "failed",
        attempts: 3,
        provider: "console",
        error: "SmtpError",
      })
      .returning();
    const [event] = await db
      .insert(stripeEvent)
      .values({
        id: `evt_test_${randomUUID()}`,
        platformCurrency: "cad",
        type: "charge.dispute.created",
        livemode: false,
        account: "acct_test_1",
        attempts: 2,
        lastError: "currency_mismatch",
      })
      .returning();
    await writeAudit(db, LAZY, {
      action: "license_request.exclusive_conflict",
      entityType: "license_request",
      entityId: request.id,
      data: { exclusive: true },
    });
    await writeAudit(db, admin, {
      action: "video.enabled",
      entityType: "video",
      entityId: live.id,
      data: { previousReason: "other" },
    });
    return {
      creator,
      account: secretAccount,
      post,
      live,
      posting,
      request,
      issued,
      email,
      event,
    };
  }

  it("A.3: each loader's rows have exactly their DTO's keys, and no token, ciphertext, hash, key, IP, agent, raw social id or snapshot", async () => {
    const w = await world();
    const [creators, connections, videos, requests, licenses, events] =
      await Promise.all([
        listAdminCreators(admin),
        listAdminConnections(admin),
        listAdminVideos(admin),
        listAdminRequests(admin),
        listAdminLicenses(admin),
        listAdminEvents(admin),
      ]);

    const creatorRow = creators.find((r) => r.id === w.creator.id);
    expect(creatorRow).toEqual({
      id: w.creator.id,
      handle: w.creator.handle,
      displayName: w.creator.displayName,
      email: expect.stringMatching(/@example\.com$/),
      payoutCurrency: "cad",
      payoutsStatus: "not_started",
      videoCount: 1,
      createdAt: w.creator.createdAt.toISOString(),
    });
    expect(connections.find((r) => r.id === w.account.id)).toEqual({
      id: w.account.id,
      provider: "mock",
      username: "demo.creator",
      ownerHandle: w.creator.handle,
      status: "connected",
      syncProblem: false,
      lastSyncedAt: null,
      lastSyncError: null,
      connectedAt: w.account.connectedAt.toISOString(),
      disconnectedAt: null,
    });
    expect(videos.find((r) => r.id === w.live.id)).toEqual({
      id: w.live.id,
      title: w.live.title,
      creatorHandle: w.creator.handle,
      verifiedPlatform: "mock",
      postingCount: 1,
      verifiedPostingCount: 1,
      status: "published",
      disabledReason: null,
      disabledNote: null,
      waitingCount: 0,
      createdAt: w.live.createdAt.toISOString(),
    });
    expect(requests.find((r) => r.id === w.request.id)).toEqual({
      id: w.request.id,
      licenseeName: "Acme Studio",
      buyerEmail: w.request.buyerEmail,
      videoTitle: w.live.title,
      scope: "Organic social repost · 30 days · Canada",
      exclusive: false,
      currency: "cad",
      licensePriceCents: 15000,
      platformFeeCents: 1500,
      amountTotalCents: 16500,
      stripeCheckoutSessionId: w.request.stripeCheckoutSessionId,
      stripePaymentIntentId: w.request.stripePaymentIntentId,
      stripeChargeId: w.request.stripeChargeId,
      status: "approved",
      claimed: false,
      statusReason: null,
      autoApprove: false,
      autoApproveFellBack: false,
      expiresAt: null,
      createdAt: w.request.createdAt.toISOString(),
    });
    expect(licenses.find((r) => r.id === w.issued.id)).toEqual({
      id: w.issued.id,
      code: w.issued.code,
      licenseeName: "Acme Studio",
      videoTitle: w.live.title,
      status: "valid",
      exclusive: false,
      issuedAt: w.issued.createdAt.toISOString(),
      downloads: 1,
      transfer: {
        status: "failed",
        amountCents: 15000,
        currency: "cad",
        lastError: "account_closed",
      },
      revokedAt: null,
    });
    expect(events.failedEmails.find((r) => r.id === w.email?.id)).toEqual({
      id: w.email?.id,
      createdAt: w.email?.createdAt.toISOString(),
      template: "request-declined",
      entityType: "license_request",
      entityId: w.request.id,
      attempts: 3,
      error: "SmtpError",
    });
    expect(events.stripeEvents.find((r) => r.id === w.event?.id)).toEqual({
      id: w.event?.id,
      receivedAt: w.event?.receivedAt.toISOString(),
      type: "charge.dispute.created",
      platformCurrency: "cad",
      account: "acct_test_1",
      attempts: 2,
      lastError: "currency_mismatch",
    });
    const [enabledRow, conflictRow] = events.audit;
    expect(enabledRow).toEqual({
      id: expect.any(String),
      createdAt: expect.any(String),
      action: "video.enabled",
      actorType: "admin",
      actorEmail: expect.stringMatching(/@example\.com$/),
      actorSource: null,
      entityType: "video",
      entityId: w.live.id,
      details: JSON.stringify({ previousReason: "other" }),
      flagged: false,
    });
    expect(conflictRow).toEqual({
      id: expect.any(String),
      createdAt: expect.any(String),
      action: "license_request.exclusive_conflict",
      actorType: "system",
      actorEmail: null,
      actorSource: "lazy",
      entityType: "license_request",
      entityId: w.request.id,
      details: JSON.stringify({ exclusive: true }),
      flagged: true,
    });

    const all = JSON.stringify([
      creators,
      connections,
      videos,
      requests,
      licenses,
      events,
    ]);
    const leaked = [
      ...Object.values(SECRETS),
      w.post.permalink,
      w.live.posterObjectKey,
      w.live.originalObjectKey,
      w.issued.originalObjectKey,
      w.issued.snapshot.creditLine,
      w.posting.socialPostId,
    ].filter((value): value is string => !!value && all.includes(value));
    expect(leaked).toEqual([]);
  });

  it("writes nothing and moves nothing: an overdue request stays waiting, no audit row, no Stripe call", async () => {
    const { live } = await approvingCreatorWithVideo();
    const { row } = await waitingOn(live);
    await overdue(row.id);
    const audits = await db.$count(auditEvent);
    const requests = await db.$count(licenseRequest);

    await listAdminCreators(admin);
    await listAdminConnections(admin);
    await listAdminVideos(admin);
    const listed = await listAdminRequests(admin);
    await listAdminLicenses(admin);
    await listAdminEvents(admin);

    expect(listed.find((r) => r.id === row.id)).toMatchObject({
      status: "awaiting_approval",
      claimed: false,
    });
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
    });
    expect(await db.$count(auditEvent)).toBe(audits);
    expect(await db.$count(licenseRequest)).toBe(requests);
    expect(scripted.log).toEqual([]);
  });

  it("shows a claimed waiting request as claimed, a fallback as fell back, and the waiting count on its video", async () => {
    const { live } = await approvingCreatorWithVideo();
    const { row } = await waitingOn(live);
    const auto = await autoWaitingOn(live);
    await db
      .update(licenseRequest)
      .set({ autoApproveFallbackAt: new Date() })
      .where(eq(licenseRequest.id, auto.id));
    const held = await claimPaymentAction(row.id, "decline");
    expect(held?.paymentAction).toBe("decline");

    const requests = await listAdminRequests(admin);
    expect(requests.find((r) => r.id === row.id)).toMatchObject({
      claimed: true,
      expiresAt: row.expiresAt?.toISOString(),
    });
    expect(requests.find((r) => r.id === auto.id)).toMatchObject({
      autoApprove: true,
      autoApproveFellBack: true,
      claimed: false,
    });
    expect(
      (await listAdminVideos(admin)).find((r) => r.id === live.id),
    ).toMatchObject({ waitingCount: 2, verifiedPlatform: null });
  });

  it("refuses any actor but an admin", async () => {
    const { actor } = await approvingCreatorWithVideo();
    for (const load of [
      listAdminCreators,
      listAdminConnections,
      listAdminVideos,
      listAdminRequests,
      listAdminLicenses,
      listAdminEvents,
    ]) {
      await expect(load(actor)).rejects.toThrow("an admin actor is required");
    }
  });
});
