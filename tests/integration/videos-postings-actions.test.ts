import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import {
  recheckPosting,
  saveVideoPostings,
} from "../../src/app/(dashboard)/dashboard/videos/[id]/actions";
import { APP_NAME } from "../../src/lib/app-name";
import {
  postingFieldKey,
  verifiedPostingsKey,
} from "../../src/lib/postings/form";
import { GENERIC_ERROR_MESSAGE } from "../../src/lib/result";
import { signInPath } from "../../src/lib/sign-in";
import {
  resolveStep,
  videoHref,
  videoStepFacts,
  videoStepHref,
} from "../../src/lib/videos/steps";
import type { Actor } from "../../src/server/auth/actor";
import {
  listAccountSummaries,
  listPostingAccountStates,
} from "../../src/server/library/queries";
import { listVideoPostings } from "../../src/server/postings/queries";
import { SocialUpstreamError } from "../../src/server/social/errors";
import {
  confirmSameVideo,
  withdrawSameVideo,
} from "../../src/server/videos/edit";
import { getVideoStepFacts } from "../../src/server/videos/queries";
import { formOf, NOT_FOUND, redirectTo } from "../helpers/actions";
import { mockNextHeaders, signedInCreator } from "../helpers/auth";
import { postNumber } from "../helpers/connect-flow";
import { resetDb } from "../helpers/db";
import {
  insertSocialAccount,
  insertUploadVideo,
  markOriginalReady,
  publishVideo,
  videoRow,
} from "../helpers/factories";
import { syncedDemo } from "../helpers/library";
import {
  confirmedAt,
  libraryDraft,
  spyGetPost,
} from "../helpers/library-videos";
import {
  backdateCheckedAt,
  expectOwnershipInvariant,
  insertVerifiedElsewhere,
  postingRow,
  postingsOf,
} from "../helpers/postings";

// Where posted's Server Actions (P11c Task 3; 02 §6.1; 04 §9.33, §11.10; 05 §6.5 States; 07 D68, D69; owner answers
// Q-75 a, Q-78 a, Q-81 a, Q-83 a, Q-84 a): saveVideoPostings, the one Continue that also stores the same-video tick or
// takes it back (P11's File-step confirmSameVideo action is gone), and recheckPosting (Check again). Their session
// gates, the field and form errors the step reads, the tick and where Continue goes; and the step's account read
// (listPostingAccountStates). The domain's own cases are in postings.test.ts. The tick's two domain calls run for real
// behind spies, so a test can turn the video on just before one of them (a race no other hook reaches).
vi.mock("next/headers", () => import("../helpers/next-headers"));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("../../src/server/videos/edit", async (importOriginal) => {
  const edit =
    await importOriginal<typeof import("../../src/server/videos/edit")>();
  return {
    ...edit,
    confirmSameVideo: vi.fn(edit.confirmSameVideo),
    withdrawSameVideo: vi.fn(edit.withdrawSameVideo),
  };
});

afterAll(resetDb);
beforeEach(() => {
  mockNextHeaders(null);
  vi.mocked(refresh).mockClear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await expectOwnershipInvariant();
});

const LOCKED = "Turn off to edit where it was posted.";
const FACEBOOK_REEL = "https://www.facebook.com/reel/1234567890123";

/** A staying Continue's answer. */
const stays = (sameVideoMissing: boolean) => ({
  ok: true,
  data: { sameVideoMissing },
});

/** Where posted's Continue with `fields` posted for `videoId`. */
const continueWith = (videoId: string, fields: Record<string, string> = {}) =>
  saveVideoPostings(null, formOf({ videoId, ...fields }));

/** A posting row's fields at form index `i`. */
const row = (
  i: number,
  platform: string,
  link: string,
  otherLabel?: string,
): Record<string, string> => ({
  [postingFieldKey(i, "platform")]: platform,
  [postingFieldKey(i, "link")]: link,
  ...(otherLabel === undefined
    ? {}
    : { [postingFieldKey(i, "otherLabel")]: otherLabel }),
});

/** The verifiedKey the step renders for the video's postings as saved now. */
const keyOf = async (actor: Actor, videoId: string) =>
  verifiedPostingsKey(await listVideoPostings(actor, videoId));

/** How many times the actions asked for a refresh since the test began. */
const refreshes = () => vi.mocked(refresh).mock.calls.length;

/** A signed-in creator with a synced Demo account, a draft upload with a ready original and the link of their post `nn`. */
async function uploadWithDemo(nn = "01") {
  const me = await signedInCreator();
  const d = await syncedDemo({ id: me.creatorId, userId: me.userId });
  const upload = await insertUploadVideo({ id: me.creatorId });
  await markOriginalReady(upload);
  const { permalink } = await postNumber(d.account.id, nn);
  return { me, d, upload, link: permalink };
}

/** uploadWithDemo with its post `nn` saved by a first Continue (verified), and the key the step then renders. */
async function savedDemoUpload(nn = "01") {
  const setup = await uploadWithDemo(nn);
  await continueWith(setup.upload.id, row(0, "mock", setup.link));
  return { ...setup, key: await keyOf(setup.me.actor, setup.upload.id) };
}

/** savedDemoUpload with the tick stored by a second Continue (which goes to Rights), and that ticked form. */
async function tickedDemoUpload() {
  const setup = await savedDemoUpload();
  const ticked = {
    ...row(0, "mock", setup.link),
    sameVideo: "on",
    verifiedKey: setup.key,
  };
  await expect(continueWith(setup.upload.id, ticked)).rejects.toMatchObject(
    redirectTo(videoStepHref(setup.upload.id, "rights")),
  );
  vi.mocked(refresh).mockClear();
  return { ...setup, ticked };
}

type TickCall = (a: Actor, videoId: string) => Promise<void>;

/** The real tick call behind `spy`, run once just after the video is turned on (published) under the action's feet. */
function turnOnBefore(spy: Mock<TickCall>, real: TickCall, videoId: string) {
  spy.mockImplementationOnce(async (a, id) => {
    await publishVideo(await videoRow(videoId));
    await real(a, id);
  });
}

describe("saveVideoPostings (Where posted's Continue)", () => {
  it("sends a signed-out visitor to sign-in, back to the step; a bad id back to the videos list", async () => {
    const id = randomUUID();
    await expect(continueWith(id, { notPosted: "on" })).rejects.toMatchObject(
      redirectTo(signInPath(videoStepHref(id, "postings"))),
    );
    await expect(
      continueWith("not-a-uuid", { notPosted: "on" }),
    ).rejects.toMatchObject(redirectTo(signInPath("/dashboard/videos")));
  });

  it("answers a bad id, an unknown video and another creator's video with the 404, saving nothing", async () => {
    const owner = await signedInCreator();
    const upload = await insertUploadVideo({ id: owner.creatorId });
    await signedInCreator();

    for (const form of [
      formOf({ videoId: "not-a-uuid", notPosted: "on" }),
      formOf({ notPosted: "on" }),
      formOf({ videoId: randomUUID(), notPosted: "on" }),
      formOf({ videoId: upload.id, notPosted: "on" }),
    ]) {
      await expect(saveVideoPostings(null, form)).rejects.toMatchObject(
        NOT_FOUND,
      );
    }
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
  });

  it("answers a published video with the Locked copy and changes nothing", async () => {
    const me = await signedInCreator();
    const live = await publishVideo(
      await insertUploadVideo({ id: me.creatorId }),
    );

    expect(
      await continueWith(
        live.id,
        row(0, "facebook", "https://www.facebook.com/reel/1234567890123"),
      ),
    ).toEqual({
      ok: false,
      error: { code: "postings_locked", message: LOCKED },
    });
    expect(await postingsOf(live.id)).toEqual([]);
    expect(refreshes()).toBe(0);
  });

  it("refuses an upload with nothing chosen: “Say where it was posted” under the chips, nothing saved (05 §6.5 States)", async () => {
    const me = await signedInCreator();
    const upload = await insertUploadVideo({ id: me.creatorId });

    const message = "Say where it was posted";
    expect(await continueWith(upload.id)).toEqual({
      ok: false,
      error: {
        code: "nothing_chosen",
        message,
        fields: { platforms: [message] },
      },
    });
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
    expect(refreshes()).toBe(0);
  });

  it("saves “I haven't posted it anywhere yet.” as zero postings and goes to Rights; Continue again goes there again", async () => {
    const me = await signedInCreator();
    const upload = await insertUploadVideo({ id: me.creatorId });
    await markOriginalReady(upload);
    const rights = redirectTo(videoStepHref(upload.id, "rights"));

    await expect(
      continueWith(upload.id, { notPosted: "on" }),
    ).rejects.toMatchObject(rights);
    const saved = await videoRow(upload.id);
    expect(saved.postingsConfirmedAt).toBeInstanceOf(Date);
    expect(saved.ownership).toBe("self_attested");
    expect(await postingsOf(upload.id)).toEqual([]);

    await expect(
      continueWith(upload.id, { notPosted: "on" }),
    ).rejects.toMatchObject(rights);
    expect((await videoRow(upload.id)).postingsConfirmedAt).toEqual(
      saved.postingsConfirmedAt,
    );
    expect(refreshes()).toBe(0);
  });

  it("saves an upload's own Demo link verified and stays for the tick, which it doesn't ask for yet (no block was shown)", async () => {
    const { upload, link } = await uploadWithDemo();

    expect(await continueWith(upload.id, row(0, "mock", link))).toEqual(
      stays(false),
    );
    expect(refreshes()).toBe(1);
    const [posting] = await postingsOf(upload.id);
    expect(posting).toMatchObject({
      platform: "mock",
      url: link,
      verification: "verified",
      verifiedUsername: "@demo.creator",
      isSource: false,
      position: 1,
    });
    const saved = await videoRow(upload.id);
    expect(saved.ownership).toBe("verified_owner");
    expect(saved.postingsConfirmedAt).toBeInstanceOf(Date);
    expect(saved.sameVideoConfirmedAt).toBeNull();
  });

  it("answers an unchanged Continue without the tick with sameVideoMissing, writing nothing (owner answer Q-75 a)", async () => {
    const { upload, link, key } = await savedDemoUpload();
    const before = await postingsOf(upload.id);

    expect(
      await continueWith(upload.id, {
        ...row(0, "mock", link),
        verifiedKey: key,
      }),
    ).toEqual(stays(true));
    expect(await postingsOf(upload.id)).toEqual(before);
    expect(await confirmedAt(upload.id)).toBeNull();
  });

  it("stores no tick for a stale, tampered or missing key: the tick confirms exactly the posts shown (07 D69)", async () => {
    const { upload, link, key } = await savedDemoUpload();

    for (const verifiedKey of [
      "",
      `${key} mock https://example.com/mock/mock_post_0badc0de_02`,
      "mock https://example.com/mock/mock_post_0badc0de_01",
    ]) {
      expect(
        await continueWith(upload.id, {
          ...row(0, "mock", link),
          sameVideo: "on",
          verifiedKey,
        }),
      ).toEqual(stays(false));
    }
    expect(await confirmedAt(upload.id)).toBeNull();
  });

  it("stores the tick with the key shown and goes to Rights; Continue again keeps the first time", async () => {
    const { me, upload, link, key } = await savedDemoUpload();
    const ticked = {
      ...row(0, "mock", link),
      sameVideo: "on",
      verifiedKey: key,
    };
    const rights = redirectTo(videoStepHref(upload.id, "rights"));
    const ids = (await postingsOf(upload.id)).map((p) => p.id);

    await expect(continueWith(upload.id, ticked)).rejects.toMatchObject(rights);
    const first = await confirmedAt(upload.id);
    expect(first).toBeInstanceOf(Date);
    // Unchanged: no save, so the posting keeps its id.
    expect((await postingsOf(upload.id)).map((p) => p.id)).toEqual(ids);
    const facts = await getVideoStepFacts(me.actor, upload.id);
    if (!facts) throw new Error("no facts");
    expect(resolveStep(videoStepFacts(facts), "rights")).toEqual({
      kind: "render",
      step: "rights",
    });

    await expect(continueWith(upload.id, ticked)).rejects.toMatchObject(rights);
    expect(await confirmedAt(upload.id)).toEqual(first);
  });

  it("brings the tick back unticked when the verified posts change, and doesn't store it for the old ones", async () => {
    const { d, upload, link, key } = await savedDemoUpload();
    await expect(
      continueWith(upload.id, {
        ...row(0, "mock", link),
        sameVideo: "on",
        verifiedKey: key,
      }),
    ).rejects.toMatchObject(redirectTo(videoStepHref(upload.id, "rights")));
    const { permalink: second } = await postNumber(d.account.id, "02");

    expect(
      await continueWith(upload.id, {
        ...row(0, "mock", link),
        ...row(1, "mock", second),
        sameVideo: "on",
        verifiedKey: key,
      }),
    ).toEqual(stays(false));
    expect(await confirmedAt(upload.id)).toBeNull();
    expect((await postingsOf(upload.id)).map((p) => p.verification)).toEqual([
      "verified",
      "verified",
    ]);
  });

  it("takes a stored tick back when the block showed it unticked: the step stays and asks for it (owner answer Q-83 a)", async () => {
    const { me, upload, link, key, ticked } = await tickedDemoUpload();
    const ids = (await postingsOf(upload.id)).map((p) => p.id);

    expect(
      await continueWith(upload.id, {
        ...row(0, "mock", link),
        verifiedKey: key,
      }),
    ).toEqual(stays(true));
    expect(await confirmedAt(upload.id)).toBeNull();
    expect(refreshes()).toBe(1);
    // Nothing else changed: no save, so the posting keeps its id.
    expect((await postingsOf(upload.id)).map((p) => p.id)).toEqual(ids);
    const facts = await getVideoStepFacts(me.actor, upload.id);
    if (!facts) throw new Error("no facts");
    expect(videoStepFacts(facts).postingsDone).toBe(false);

    // Ticked again: stored anew, and on to Rights.
    await expect(continueWith(upload.id, ticked)).rejects.toMatchObject(
      redirectTo(videoStepHref(upload.id, "rights")),
    );
    expect(await confirmedAt(upload.id)).toBeInstanceOf(Date);
  });

  it("takes the tick back in the Continue that also saves a change keeping the verified posts", async () => {
    const { upload, link, key } = await tickedDemoUpload();

    expect(
      await continueWith(upload.id, {
        ...row(0, "mock", link),
        ...row(1, "facebook", FACEBOOK_REEL),
        verifiedKey: key,
      }),
    ).toEqual(stays(true));
    expect(await confirmedAt(upload.id)).toBeNull();
    expect((await postingsOf(upload.id)).map((p) => p.platform)).toEqual([
      "mock",
      "facebook",
    ]);
  });

  it("keeps a stored tick when the form didn't show the block for these posts (a missing or stale key) and moves on", async () => {
    const { upload, link } = await tickedDemoUpload();
    const first = await confirmedAt(upload.id);
    vi.mocked(withdrawSameVideo).mockClear();

    for (const verifiedKey of [
      "",
      "mock https://example.com/mock/mock_post_0badc0de_01",
    ]) {
      await expect(
        continueWith(upload.id, { ...row(0, "mock", link), verifiedKey }),
      ).rejects.toMatchObject(redirectTo(videoStepHref(upload.id, "rights")));
    }
    expect(await confirmedAt(upload.id)).toEqual(first);
    expect(vi.mocked(withdrawSameVideo)).not.toHaveBeenCalled();
  });

  it("answers a video turned on before the tick is stored or taken back with the Locked copy, changing nothing", async () => {
    const real = await vi.importActual<
      typeof import("../../src/server/videos/edit")
    >("../../src/server/videos/edit");
    const locked = {
      ok: false,
      error: { code: "postings_locked", message: LOCKED },
    };

    const ticking = await savedDemoUpload();
    turnOnBefore(
      vi.mocked(confirmSameVideo),
      real.confirmSameVideo,
      ticking.upload.id,
    );
    expect(
      await continueWith(ticking.upload.id, {
        ...row(0, "mock", ticking.link),
        sameVideo: "on",
        verifiedKey: ticking.key,
      }),
    ).toEqual(locked);
    expect(await confirmedAt(ticking.upload.id)).toBeNull();

    const unticking = await tickedDemoUpload();
    const stored = await confirmedAt(unticking.upload.id);
    turnOnBefore(
      vi.mocked(withdrawSameVideo),
      real.withdrawSameVideo,
      unticking.upload.id,
    );
    expect(
      await continueWith(unticking.upload.id, {
        ...row(0, "mock", unticking.link),
        verifiedKey: unticking.key,
      }),
    ).toEqual(locked);
    expect(await confirmedAt(unticking.upload.id)).toEqual(stored);
    expect(refreshes()).toBe(1);
  });

  it("moves an unpublished video on to its page, not to Rights (it is past the draft)", async () => {
    const me = await signedInCreator();
    const off = await insertUploadVideo(
      { id: me.creatorId },
      { status: "unpublished" },
    );
    const page = redirectTo(videoHref(off.id));

    await expect(
      continueWith(off.id, row(0, "facebook", FACEBOOK_REEL)),
    ).rejects.toMatchObject(page);
    expect(await postingsOf(off.id)).toMatchObject([
      { platform: "facebook", position: 1 },
    ]);
    await expect(
      continueWith(off.id, row(0, "facebook", FACEBOOK_REEL)),
    ).rejects.toMatchObject(page);
    expect(refreshes()).toBe(0);
  });

  it("on a Library draft, asks for the tick on the first Continue; with it, stores it, the source row's Switch and goes to Rights (Q-73 a)", async () => {
    const me = await signedInCreator();
    const draft = await libraryDraft(me);
    const [source] = await postingsOf(draft.id);
    if (!source) throw new Error("no source posting");
    const key = await keyOf(me.actor, draft.id);
    expect(key).not.toBe("");

    expect(await continueWith(draft.id, { verifiedKey: key })).toEqual(
      stays(true),
    );
    expect((await videoRow(draft.id)).postingsConfirmedAt).toBeInstanceOf(Date);
    expect(await confirmedAt(draft.id)).toBeNull();

    await expect(
      continueWith(draft.id, {
        verifiedKey: key,
        sameVideo: "on",
        sourceShowLink: "false",
      }),
    ).rejects.toMatchObject(redirectTo(videoStepHref(draft.id, "rights")));
    expect(await confirmedAt(draft.id)).toBeInstanceOf(Date);
    expect(await postingRow(source.id)).toMatchObject({
      showLink: false,
      verification: "verified",
      url: source.url,
    });
  });

  it("asks for the original again when it isn't ready: the tick confirms a file", async () => {
    const me = await signedInCreator();
    const draft = await libraryDraft(me, { ready: false });
    const key = await keyOf(me.actor, draft.id);

    expect(
      await continueWith(draft.id, { verifiedKey: key, sameVideo: "on" }),
    ).toEqual({
      ok: false,
      error: {
        code: "original_not_ready",
        message: "Choose the original file to continue.",
      },
    });
    expect(await confirmedAt(draft.id)).toBeNull();
    // The postings were saved before the tick was refused: the page shows them.
    expect((await videoRow(draft.id)).postingsConfirmedAt).toBeInstanceOf(Date);
    expect(refreshes()).toBe(1);
  });

  it("answers 02 §6.1's Zod with field errors at the rows' form indices: Other's name, a link too long; nothing saved", async () => {
    const me = await signedInCreator();
    const upload = await insertUploadVideo({ id: me.creatorId });
    const nameMissing = "Add the name of the site.";
    const tooLong = "That link is too long. Paste the link to the post.";

    expect(
      await continueWith(upload.id, {
        ...row(1, "other", "https://vimeo.com/1", "  "),
        ...row(3, "other", `https://vimeo.com/${"1".repeat(2048)}`, "Vimeo"),
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: nameMissing,
        fields: {
          "postings.1.otherLabel": [nameMissing],
          "postings.3.link": [tooLong],
        },
      },
    });
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
  });

  it("answers a crafted form (an unknown platform) with the generic error", async () => {
    const me = await signedInCreator();
    const upload = await insertUploadVideo({ id: me.creatorId });

    expect(
      await continueWith(upload.id, row(0, "myspace", "https://myspace.com/1")),
    ).toEqual({
      ok: false,
      error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
    });
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
  });

  it("puts each link the server can't read under its field in 04 §11.10's words (wrong platform with its article), nothing saved", async () => {
    const me = await signedInCreator();
    const upload = await insertUploadVideo({ id: me.creatorId });
    const instagram = "This is an Instagram link. Move it there?";
    const shortLink =
      "That's a short link. Open it in your browser, then copy the full address from the address bar.";

    expect(
      await continueWith(upload.id, {
        ...row(0, "tiktok", "https://www.instagram.com/reel/C0dEaBcDeF1/"),
        ...row(2, "tiktok", "https://vm.tiktok.com/ZMabc123/"),
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_link",
        message: instagram,
        fields: {
          "postings.0.link": [instagram],
          "postings.2.link": [shortLink],
        },
      },
    });
    expect(await postingsOf(upload.id)).toEqual([]);
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
  });

  it("puts the two cross-creator refusals under the refused link (owner answer Q-78 a) and saves nothing", async () => {
    const me = await signedInCreator();
    const upload = await insertUploadVideo({ id: me.creatorId });
    const elsewhere = "mock_post_0badc0de_02";
    await insertVerifiedElsewhere(elsewhere);
    const mine = "mock_post_0badc0de_03";
    const myOther = await libraryDraft(me, {
      ready: false,
      post: { providerPostId: mine, linkKey: mine },
    });
    const facebook = row(
      0,
      "facebook",
      "https://www.facebook.com/reel/1234567890123",
    );

    const theirs = `This post is already licensable from another ${APP_NAME} account.`;
    expect(
      await continueWith(upload.id, {
        ...facebook,
        ...row(2, "mock", `https://example.com/mock/${elsewhere}`),
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "already_licensable_elsewhere",
        message: theirs,
        fields: { "postings.2.link": [theirs] },
      },
    });

    const onMine = `This post is already on your video “${myOther.title}”.`;
    expect(
      await continueWith(upload.id, {
        ...facebook,
        ...row(1, "mock", `https://example.com/mock/${mine}`),
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "already_on_your_video",
        message: onMine,
        fields: { "postings.1.link": [onMine] },
      },
    });
    expect(await postingsOf(upload.id)).toEqual([]);
    expect((await videoRow(upload.id)).postingsConfirmedAt).toBeNull();
    expect(refreshes()).toBe(0);
  });
});

describe("recheckPosting (Check again)", () => {
  it("sends a signed-out visitor to sign-in, back to the page it was pressed on", async () => {
    await expect(
      recheckPosting({ postingId: randomUUID() }),
    ).rejects.toMatchObject(redirectTo(signInPath("/dashboard")));
  });

  it("checks a posting again (check_failed → verified), answers it and refreshes the page", async () => {
    const { upload, link } = await uploadWithDemo();
    const failing = spyGetPost().mockRejectedValue(new SocialUpstreamError());
    expect(await continueWith(upload.id, row(0, "mock", link))).toEqual(
      stays(false),
    );
    failing.mockRestore();
    const [posting] = await postingsOf(upload.id);
    if (!posting) throw new Error("no posting");
    expect(posting.unverifiedReason).toBe("check_failed");
    // Past Q-84 a's 30 s, so the platform is asked again.
    await backdateCheckedAt(posting.id);
    vi.mocked(refresh).mockClear();

    expect(await recheckPosting({ postingId: posting.id })).toEqual({
      ok: true,
      data: {
        posting: expect.objectContaining({
          id: posting.id,
          verification: "verified",
          unverifiedReason: null,
          verifiedUsername: "@demo.creator",
        }),
      },
    });
    expect(refreshes()).toBe(1);
    expect((await videoRow(upload.id)).ownership).toBe("verified_owner");
  });

  it("answers a posting checked in the last 30 s with “Checked a moment ago…”, asking the platform nothing (owner answer Q-84 a)", async () => {
    const { upload, link } = await uploadWithDemo();
    await continueWith(upload.id, row(0, "mock", link));
    const [posting] = await postingsOf(upload.id);
    if (!posting) throw new Error("no posting");
    const getPost = spyGetPost();
    vi.mocked(refresh).mockClear();

    expect(await recheckPosting({ postingId: posting.id })).toEqual({
      ok: false,
      error: {
        code: "checked_recently",
        message: "Checked a moment ago. Try again in a few seconds.",
      },
    });
    expect(getPost).not.toHaveBeenCalled();
    expect(await postingRow(posting.id)).toEqual(posting);
    expect(refreshes()).toBe(1);
  });

  it("answers a posting on a published video with the Locked copy and checks nothing", async () => {
    const { upload, link } = await uploadWithDemo();
    await continueWith(upload.id, row(0, "mock", link));
    const [saved] = await postingsOf(upload.id);
    if (!saved) throw new Error("no posting");
    // Past Q-84 a's 30 s: the lock alone refuses it.
    await backdateCheckedAt(saved.id);
    const posting = await postingRow(saved.id);
    await publishVideo(upload);
    const getPost = spyGetPost();

    expect(await recheckPosting({ postingId: posting.id })).toEqual({
      ok: false,
      error: { code: "postings_locked", message: LOCKED },
    });
    expect(getPost).not.toHaveBeenCalled();
    expect(await postingRow(posting.id)).toEqual(posting);
  });

  it("answers a posting that is gone or another creator's with the generic error and a refresh; a bad id with the generic error", async () => {
    const { upload, link } = await uploadWithDemo();
    await continueWith(upload.id, row(0, "mock", link));
    const [posting] = await postingsOf(upload.id);
    if (!posting) throw new Error("no posting");
    await signedInCreator();
    vi.mocked(refresh).mockClear();

    for (const postingId of [randomUUID(), posting.id]) {
      expect(await recheckPosting({ postingId })).toEqual({
        ok: false,
        error: { code: "not_found", message: GENERIC_ERROR_MESSAGE },
      });
    }
    expect(refreshes()).toBe(2);
    expect(await recheckPosting({ postingId: "not-a-uuid" })).toEqual({
      ok: false,
      error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
    });
    expect(refreshes()).toBe(2);
    expect(await postingRow(posting.id)).toEqual(posting);
  });
});

describe("listPostingAccountStates (the step's account facts)", () => {
  it("is listAccountSummaries' rows, in its order (platform, then oldest connect), with only the id, platform and status", async () => {
    const me = await signedInCreator();
    const creator = { id: me.creatorId };
    const at = (minute: number) => ({
      connectedAt: new Date(Date.UTC(2026, 9, 1, 9, minute)),
    });
    await insertSocialAccount(creator, {
      ...at(30),
      status: "needs_reconnect",
    });
    await insertSocialAccount(creator, at(10));
    await insertSocialAccount(creator, { ...at(20), provider: "youtube" });
    await insertSocialAccount(creator, {
      ...at(5),
      status: "disconnected",
      accessTokenEnc: null,
      disconnectedAt: new Date(),
    });
    const other = await signedInCreator();
    await insertSocialAccount({ id: other.creatorId });

    const states = await listPostingAccountStates(me.actor);
    expect(states).toEqual(
      (await listAccountSummaries(me.actor)).map(
        ({ id, platform, status }) => ({ id, platform, status }),
      ),
    );
    expect(states.map(({ platform, status }) => [platform, status])).toEqual([
      ["youtube", "connected"],
      ["mock", "connected"],
      ["mock", "needs_reconnect"],
    ]);
  });
});
