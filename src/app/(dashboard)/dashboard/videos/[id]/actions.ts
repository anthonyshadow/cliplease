"use server";

import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { type ZodError, z } from "zod";
import { isOneOf, POSTING_PLATFORMS } from "@/lib/domain/values";
import {
  POSTINGS_COPY,
  type PostingFieldError,
  postingLinkErrorCopy,
  refusedOnYourVideo,
} from "@/lib/postings/copy";
import {
  isNothingChosen,
  needsAttention,
  PLATFORMS_FIELD,
  type PostingsFormData,
  postingFieldKey,
  postingsFromFormData,
  postingsInputChanged,
  postingsStepMode,
  postingsStepOutcome,
  type SavePostingsState,
  verifiedPostingsKey,
} from "@/lib/postings/form";
import { POSTING_URL_MAX, POSTINGS_MAX } from "@/lib/postings/limits";
import { parsePostingLink } from "@/lib/postings/parse";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import {
  type ActionError,
  type ActionResult,
  fieldError,
  fieldErrors,
  formError,
  GENERIC_ERROR_MESSAGE,
} from "@/lib/result";
import { DROPZONE_COPY } from "@/lib/upload/messages";
import { isUuid } from "@/lib/validation/uuid";
import { REVIEW_COPY } from "@/lib/videos/review";
import { videoHref, videoStepFacts, videoStepHref } from "@/lib/videos/steps";
import type { Actor } from "@/server/auth/actor";
import { requireCreator, toActor } from "@/server/auth/session";
import {
  AlreadyLicensableElsewhereError,
  AlreadyOnYourVideoError,
  CheckedRecentlyError,
  type InvalidPostingsCode,
  InvalidPostingsError,
  NotPublicError,
  PostingsLockedError,
} from "@/server/postings/errors";
import { listVideoPostings } from "@/server/postings/queries";
import {
  type PostingInput,
  recheckPosting as recheckPostingFor,
  type SaveVideoPostingsInput,
  type SaveVideoPostingsResult,
  saveVideoPostings as saveVideoPostingsFor,
  saveVideoPostingsInput,
} from "@/server/postings/save";
import { mockEnabled } from "@/server/social/registry";
import { confirmSameVideo, withdrawSameVideo } from "@/server/videos/edit";
import {
  confirmSameVideoErrorCode,
  VideoNotFoundError,
} from "@/server/videos/errors";
import {
  type PublishResult,
  publishVideo as publish,
} from "@/server/videos/publish";
import {
  getVideoStepFacts,
  type VideoStepState,
} from "@/server/videos/queries";
import { shareUrl } from "@/server/videos/visibility";

// The Where posted step's Server Actions, and Review's Publish (02 §6.1; 07 D69): Continue (saveVideoPostings, which also stores the same-video
// tick or takes it back: no separate confirmSameVideo action, P11c Task 3; owner answer Q-83 a) and Check again
// (recheckPosting). Thin: the form read (postingsFromFormData), the session gate, 02 §6.1's Zod (saveVideoPostingsInput),
// the domain, and its refusals in 04 §11.10's words. Error shapes the step reads:
//   - a field error (§9.6 style under that field, focus on the first) under `error.fields[key]`, its first message also
//     `error.message`: `postings.<i>.link` (a link that doesn't parse, too long, private, or one of the two
//     cross-creator refusals, owner answer Q-78 a), `postings.<i>.otherLabel` ("Add the name of the site."),
//     PLATFORMS_FIELD ("Say where it was posted", 05 §6.5 States: the action's own check, and the domain's). <i> is the
//     row's form index (`indices`);
//   - a form-level error (`error.fields` absent: an error Banner above the cards, focus on it): the Locked copy (also a
//     video turned on before the tick was stored or taken back), the 12-place limit, a cross-creator refusal that names
//     no row, "Choose the original file to continue." and the generic error;
//   - a staying Continue: `{ ok: true, data: { sameVideoMissing } }` after refresh(); `sameVideoMissing` true is the
//     same-video tick's field error, SAME_VIDEO_COPY.missingTick under the tick with focus on the box (Q-75 a);
//   - Check again pressed within 30 s of the posting's last check (the server's POSTING_CHECK_COOLDOWN_MS), with no
//     account on its platform linked or synced since: `checked_recently` with POSTINGS_COPY.checkedRecently, which the row shows as a helper, not an error (Q-84 a).
// Moving on is redirect(): a draft to ?step=rights, an unpublished video to its page (videoHref). redirect() and
// notFound() throw, so they stay outside every try that maps a refusal. Nothing here fetches a pasted link (07 D67): the
// domain parses it and matches it by id.

/**
 * The same-video tick's two fields (Zod at the boundary, AGENTS.md §8): ticked or not, and the verified posts the block
 * showed (verifiedPostingsKey: at most POSTINGS_MAX "platform url" lines).
 */
const sameVideoInput = z.object({
  sameVideo: z.boolean(),
  verifiedKey: z.string().max(POSTINGS_MAX * (POSTING_URL_MAX + 16)),
});

/** The video's step facts read now (uncached); none → the 404. */
async function stepFactsNow(
  actor: Actor,
  videoId: string,
): Promise<VideoStepState> {
  const facts = await getVideoStepFacts(actor, videoId);
  if (!facts) notFound();
  return facts;
}

/**
 * A link field's error in 04 §11.10's words. wrong_platform names the platform the link belongs to, read again from the
 * link here (the domain answers the code only, 02 §5.12), so the row offers **Move**.
 */
function linkErrorMessage(
  row: PostingInput,
  error: PostingFieldError,
  allowMock: boolean,
): string {
  const parsed =
    error === "wrong_platform"
      ? parsePostingLink(row.platform, row.link?.trim() ?? "", { allowMock })
      : null;
  return postingLinkErrorCopy(error, {
    platform: row.platform,
    otherLabel: row.otherLabel ?? null,
    detected: parsed?.ok === false ? parsed.detected : undefined,
  });
}

/**
 * 02 §6.1's Zod refusing the form: an Other row without its name and an over-long link get their field's words; any
 * other issue (only a crafted form gets one: an unknown platform, Demo while mock is off, a name on a non-Other row,
 * "I haven't posted it anywhere yet." with rows) is the generic error. A row on an unknown platform always has that
 * issue too, so its over-long link answers the generic error at once.
 */
function inputError(
  error: ZodError,
  form: PostingsFormData,
  allowMock: boolean,
): ActionError {
  const fields: [string, string][] = [];
  for (const issue of error.issues) {
    const [top, k, field] = issue.path;
    const row = typeof k === "number" ? form.postings[k] : undefined;
    const i = typeof k === "number" ? form.indices[k] : undefined;
    if (top !== "postings" || row === undefined || i === undefined) {
      return formError("invalid_input");
    }
    if (
      field === "otherLabel" &&
      (issue.code === "too_small" || issue.message === "other_label_required")
    ) {
      fields.push([
        postingFieldKey(i, "otherLabel"),
        POSTINGS_COPY.otherNameMissing,
      ]);
    } else if (
      field === "link" &&
      issue.code === "too_big" &&
      isOneOf(POSTING_PLATFORMS, row.platform)
    ) {
      fields.push([
        postingFieldKey(i, "link"),
        linkErrorMessage(
          { ...row, platform: row.platform },
          "too_long",
          allowMock,
        ),
      ]);
    } else {
      return formError("invalid_input");
    }
  }
  return fieldErrors("invalid_input", fields);
}

/**
 * A postings refusal in words (07 D68, 01 J5.27, J5.30), and where a save shows it: under the refused row's link
 * (`index`, its input index: Q-78 a), under the chips (`chips`), else above the cards.
 */
type PostingRefusal = {
  code: string;
  message: string;
  index?: number;
  chips?: true;
};

/**
 * InvalidPostingsError's words: the 12-place limit above the cards, nothing chosen under the chips (05 §6.5 States; the
 * domain refuses it too), and "I haven't posted it anywhere yet." on a Library video (only a crafted form) the generic
 * error.
 */
const INVALID_POSTINGS: Record<InvalidPostingsCode, PostingRefusal> = {
  too_many: { code: "too_many", message: POSTINGS_COPY.limit },
  not_posted_library: {
    code: "not_posted_library",
    message: GENERIC_ERROR_MESSAGE,
  },
  nothing_chosen: {
    code: "nothing_chosen",
    message: POSTINGS_COPY.nothingChosen,
    chips: true,
  },
};

/** The postings domain's refusals (02 §5.12, 04 §11.10); null for anything else, which is rethrown. */
function postingRefusal(error: unknown): PostingRefusal | null {
  if (error instanceof AlreadyLicensableElsewhereError) {
    return {
      code: "already_licensable_elsewhere",
      message: POSTINGS_COPY.refusedElsewhere,
      index: error.index,
    };
  }
  if (error instanceof AlreadyOnYourVideoError) {
    return {
      code: "already_on_your_video",
      message: refusedOnYourVideo(error.videoTitle),
      index: error.index,
    };
  }
  if (error instanceof NotPublicError) {
    return { code: "not_public", message: POSTINGS_COPY.refusedPrivate };
  }
  if (error instanceof PostingsLockedError) {
    return { code: "postings_locked", message: POSTINGS_COPY.locked };
  }
  if (error instanceof CheckedRecentlyError) {
    return { code: "checked_recently", message: POSTINGS_COPY.checkedRecently };
  }
  if (error instanceof InvalidPostingsError) {
    return INVALID_POSTINGS[error.code];
  }
  return null;
}

/** What a save wrote: the postings as saved (the source row included) and the step facts after it. */
type SavedPostings = { postings: OwnerPostingDTO[]; facts: VideoStepState };

/**
 * The domain save (02 §5.12) of `input`, the form as 02 §6.1's Zod read it: what it wrote (the facts as its last write
 * returned them, so nothing is read again), or its refusal with nothing saved: each link it couldn't take under its
 * field (the parse's error, or `private`), a cross-creator refusal under the refused link (Q-78 a; above the cards when
 * it names no row), nothing chosen under the chips, anything else above the cards. The domain's row indices are
 * `input.postings`', the form's rows in the same order (`indices`).
 */
async function savePostings(
  actor: Actor,
  input: SaveVideoPostingsInput,
  form: PostingsFormData,
  allowMock: boolean,
): Promise<ActionResult<SavedPostings>> {
  let result: SaveVideoPostingsResult;
  try {
    result = await saveVideoPostingsFor(actor, input);
  } catch (error) {
    if (error instanceof VideoNotFoundError) notFound();
    const refused = postingRefusal(error);
    if (refused === null) throw error;
    if (refused.chips) {
      return fieldError(refused.code, PLATFORMS_FIELD, refused.message);
    }
    const i =
      refused.index === undefined ? undefined : form.indices[refused.index];
    return i === undefined
      ? formError(refused.code, refused.message)
      : fieldError(refused.code, postingFieldKey(i, "link"), refused.message);
  }
  if (result.ok) {
    return {
      ok: true,
      data: { postings: result.postings, facts: result.facts },
    };
  }
  const { fields } = result;
  return fieldErrors(
    "invalid_link",
    input.postings.flatMap((row, k) => {
      const error = fields[k];
      return error === undefined
        ? []
        : [
            [
              postingFieldKey(form.indices[k], "link"),
              linkErrorMessage(row, error, allowMock),
            ] as const,
          ];
    }),
  );
}

/**
 * "These posts show this same video" set to the box the block showed (07 D69): ticked stores it (confirmSameVideo; the
 * first time is kept), unticked takes a stored one back (withdrawSameVideo; owner answer Q-83 a). `data` is the step
 * facts after it: `current` with the tick as written, with no read. The verified posts changing meanwhile
 * (no_verified_posting) stores nothing and refuses nothing: the facts are read again, and the refreshed block shows the
 * new set unticked. A video turned on meanwhile is the Locked copy; an original replaced since the page loaded asks for
 * it again.
 */
async function setTick(
  actor: Actor,
  videoId: string,
  ticked: boolean,
  current: VideoStepState,
): Promise<ActionResult<VideoStepState>> {
  try {
    if (ticked) await confirmSameVideo(actor, videoId);
    else await withdrawSameVideo(actor, videoId);
    return { ok: true, data: { ...current, sameVideoConfirmed: ticked } };
  } catch (error) {
    const code = confirmSameVideoErrorCode(error);
    if (code === null) throw error;
    if (code === "not_found") notFound();
    if (code === "no_verified_posting") {
      return { ok: true, data: await stepFactsNow(actor, videoId) };
    }
    if (code === "postings_locked") {
      return formError(code, POSTINGS_COPY.locked);
    }
    return formError(code, DROPZONE_COPY.continueHelper);
  }
}

/**
 * Where posted's **Continue** (02 §6.1 saveVideoPostings + confirmSameVideo as one Continue; 04 §9.33 Footer; 05 §6.5
 * States; 07 D69). In order: the session (back to ?step=postings; a bad id → the videos list), the creator's own video
 * (else the 404), `draft`/`unpublished` (else "Turn off to edit where it was posted."), 02 §6.1's Zod, an upload with
 * nothing chosen ("Say where it was posted" under the chips, nothing saved). The domain save runs when the postings
 * changed (postingsInputChanged) or were never saved, and hands back the step facts it wrote. Then the tick, when the
 * verified posts the block showed (`verifiedKey`) are the ones saved now: stored when ticked, taken back when unticked
 * and stored (Q-83 a: the step then stays with "Confirm these posts show this same video"). Then postingsStepOutcome:
 * complete (videoStepFacts), unless this Continue changed the postings and a link came back not_found, no_account or
 * check_failed (the save checks every non-source link again, keeping a result checked in the last 30 s: Q-84 a), →
 * ?step=rights for a draft, the video's page once it is past the draft; otherwise refresh() and stay, so a second
 * Continue with nothing changed moves on.
 */
export async function saveVideoPostings(
  _previous: SavePostingsState,
  formData: FormData,
): Promise<SavePostingsState> {
  const form = postingsFromFormData(formData);
  const { videoId } = form;
  const ctx = await requireCreator(
    isUuid(videoId) ? videoStepHref(videoId, "postings") : "/dashboard/videos",
  );
  const actor = toActor(ctx);
  const facts = await stepFactsNow(actor, videoId);
  if (postingsStepMode(facts.status) !== "edit") {
    return formError("postings_locked", POSTINGS_COPY.locked);
  }
  const allowMock = mockEnabled();
  const parsed = saveVideoPostingsInput.safeParse({
    videoId,
    notPosted: form.notPosted,
    postings: form.postings,
    sourceShowLink: form.sourceShowLink,
  });
  if (!parsed.success) return inputError(parsed.error, form, allowMock);
  const tick = sameVideoInput.safeParse(form);
  if (!tick.success) return formError("invalid_input");
  const input = parsed.data;
  const before = await listVideoPostings(actor, videoId);
  if (
    isNothingChosen({
      hasSource: before.some((posting) => posting.isSource),
      rowCount: input.postings.length,
      notPosted: input.notPosted,
    })
  ) {
    return fieldError(
      "nothing_chosen",
      PLATFORMS_FIELD,
      POSTINGS_COPY.nothingChosen,
    );
  }

  const changed = postingsInputChanged(before, input, { allowMock });
  let after = before;
  let current = facts;
  if (changed || facts.postingsConfirmedAt === null) {
    const saved = await savePostings(actor, input, form, allowMock);
    if (!saved.ok) return saved;
    after = saved.data.postings;
    current = saved.data.facts;
  }

  // The tick answers for exactly the posts the block showed: a stale, tampered or missing key changes nothing (07 D69).
  const key = verifiedPostingsKey(after);
  const sawThesePosts = key !== "" && tick.data.verifiedKey === key;
  if (sawThesePosts && tick.data.sameVideo !== current.sameVideoConfirmed) {
    const set = await setTick(actor, videoId, tick.data.sameVideo, current);
    if (!set.ok) {
      refresh();
      return set;
    }
    current = set.data;
  }

  const outcome = postingsStepOutcome({
    complete: videoStepFacts(current).postingsDone,
    changed,
    needsAttention: after.some(needsAttention),
  });
  if (outcome === "next") {
    redirect(
      current.status === "draft"
        ? videoStepHref(videoId, "rights")
        : videoHref(videoId),
    );
  }
  refresh();
  return {
    ok: true,
    data: {
      sameVideoMissing:
        !tick.data.sameVideo && sawThesePosts && !current.sameVideoConfirmed,
    },
  };
}

const recheckInput = z.object({ postingId: z.uuid() });

/**
 * **Check again** on one saved posting (02 §6.1 recheckPosting; 07 D66): the posting as checked now, then refresh().
 * Signed out → sign-in, back to the page it was pressed on (requireCreator's default). Its refusals in words: a private
 * post, a locked video, a post another creator or the creator's other video verified meanwhile (01 J5.27, A.4), and a
 * posting checked in the last 30 s (`checked_recently`: its last result stands, owner answer Q-84 a). A posting that is
 * gone (a save replaced the rows: their ids change on every save) or isn't the creator's is the generic error; the
 * refresh brings the current rows.
 */
export async function recheckPosting(input: {
  postingId: string;
}): Promise<ActionResult<{ posting: OwnerPostingDTO }>> {
  const ctx = await requireCreator();
  const parsed = recheckInput.safeParse(input);
  if (!parsed.success) return formError("invalid_input");
  let result: ActionResult<{ posting: OwnerPostingDTO }>;
  try {
    const posting = await recheckPostingFor(toActor(ctx), parsed.data);
    result = { ok: true, data: { posting } };
  } catch (error) {
    const refused =
      error instanceof VideoNotFoundError
        ? { code: "not_found", message: GENERIC_ERROR_MESSAGE }
        : postingRefusal(error);
    if (refused === null) throw error;
    result = formError(refused.code, refused.message);
  }
  refresh();
  return result;
}

const publishInput = z.object({ videoId: z.uuid() });

/**
 * **Publish** on Review (02 §6.1; 07 D69, D74): the video live, then refresh(), which renders the success view in place
 * (the page shows a published video's Review as "Your video is live."). Returns the link to share; a video already live
 * is fine again. A blocker that appeared since the page rendered (another tab, a disconnected account) refuses with
 * `publish_blocked`, and the refreshed Review lists it. Not the creator's video → 404. No payouts check (D74).
 */
export async function publishVideo(input: {
  videoId: string;
}): Promise<ActionResult<{ shareUrl: string }>> {
  const parsed = publishInput.safeParse(input);
  if (!parsed.success) notFound();
  const { videoId } = parsed.data;
  const ctx = await requireCreator(videoStepHref(videoId, "review"));
  let result: PublishResult;
  try {
    result = await publish(toActor(ctx), { videoId });
  } catch (error) {
    if (!(error instanceof VideoNotFoundError)) throw error;
    notFound();
  }
  refresh();
  return result.ok
    ? {
        ok: true,
        data: { shareUrl: shareUrl(ctx.creator.handle, result.slug) },
      }
    : formError("publish_blocked", REVIEW_COPY.blockersTitle);
}
