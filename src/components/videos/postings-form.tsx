"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { syncAccount } from "@/app/(dashboard)/dashboard/_actions/social";
import {
  recheckPosting,
  saveVideoPostings,
} from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { runAction } from "@/components/ui/run-action";
import { FieldMessages } from "@/components/ui/text-field";
import { useFormAction } from "@/components/ui/use-form-action";
import { APP_NAME } from "@/lib/app-name";
import type { PostingPlatform, SocialProviderId } from "@/lib/domain/values";
import {
  POSTINGS_COPY,
  postingLiveMessage,
  postingResultCopy,
} from "@/lib/postings/copy";
import { POSTINGS_FIELD, verifiedPostingsKey } from "@/lib/postings/form";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import { PostingAction } from "./posting-action";
import { type PickerHandlers, PostingPicker } from "./posting-picker";
import {
  accountsOn,
  addRow,
  clearRowError,
  continueProblems,
  errorsFromResult,
  moveLink,
  NO_ERRORS,
  type PickerErrors,
  type PickerState,
  type PostingAccounts,
  pickerCards,
  pickerState,
  postedRows,
  recheckOnReturn,
  removeRow,
  resultContext,
  resultsAnnouncement,
  revealErrors,
  sameVideoView,
  setLink,
  setNotPosted,
  setOtherLabel,
  setSwitch,
  showLinkError,
  sourceOf,
  syncFailureLine,
  toggleChip,
} from "./posting-picker-state";
import { CheckingLine, PostingResult } from "./posting-result";
import { type FocusTarget, focusTarget } from "./postings-focus";
import { SameVideoBlock } from "./same-video-block";

/** What the step reads of the video (CreatorVideoDTO's, minus everything it doesn't). */
export type PostingsFormVideo = {
  id: string;
  /** The stored file length (D39's > 1 s check per verified post). */
  durationMs: number | null;
  posterSrc: string | null;
  width: number | null;
  height: number | null;
  sameVideoConfirmed: boolean;
};

/** A row's line after Sync and check again or Check again (FieldMessages): a sync that couldn't run, or a refusal. */
type RowNote = { helper: string } | { error: string };

const without = <T,>(set: ReadonlySet<T>, value: T) => {
  const next = new Set(set);
  next.delete(value);
  return next;
};

/**
 * The "Where was it posted?" form (04 §9.33; 05 §6.5 S17b; 07 D65–D70; owner answers Q-73–Q-81): one <form> posting
 * to saveVideoPostings (useFormAction keeps what was typed after a refusal), holding the PostingPicker (chips, the
 * not-posted tick on uploads, the posting cards with the locked Library source row first), the same-video block, the
 * upload-only note and Continue. It owns the picker's state and answers its handlers.
 *
 * Continue first checks what it can without the network (a link that doesn't parse, Other without its name, an upload
 * with nothing chosen): the errors show and focus goes to the first, nothing is posted. Otherwise it posts; while the
 * server verifies, each link reads "Checking the link…" and the fields are read-only. It either moves on to Rights (a
 * redirect) or stays: the page refreshes with the saved postings (every save gives them new ids, so the rows are read
 * again from them), each link shows its result in place, a polite live region says "{Platform} link verified / not
 * verified" once per result, and focus goes to the first thing that needs the creator (postings-focus). A refusal keeps
 * every typed value and puts each error under its field, mapped from the form index posted back to the row.
 *
 * Row actions run outside the form post (runAction): Check again (recheckPosting), Sync and check again (syncAccount on
 * each connected account of the platform in turn, then recheckPosting), Link / Reconnect {Platform} (a Connect link).
 * Back from a connect with ?connected=<provider> (owner answer Q-74 a), each no_account or check_failed link on that
 * platform is checked again once, after StripConnectParams has dropped the parameter (a URL change during a Server Action
 * can cancel it). Nothing here fetches, previews or renders a pasted link (07 D67).
 */
export function PostingsForm({
  video,
  postings,
  notPostedSaved,
  allowMock,
  accounts,
  connected,
}: {
  video: PostingsFormVideo;
  /** listVideoPostings: the saved postings in position order, the source first. */
  postings: OwnerPostingDTO[];
  /** The draft was saved as "I haven't posted it anywhere yet." (confirmed with no posting). */
  notPostedSaved: boolean;
  allowMock: boolean;
  accounts: PostingAccounts;
  /** The page's ?connected=<provider>, read on the server (Q-74 a). */
  connected: SocialProviderId | null;
}) {
  const opts = { allowMock };
  const source = sourceOf(postings);
  const hasSource = source !== null;
  const savedById: ReadonlyMap<string, OwnerPostingDTO> = new Map(
    postings.map((posting) => [posting.id, posting]),
  );
  const savedKey = postings.map((posting) => posting.id).join(" ");

  const [picker, setPicker] = useState<PickerState>(() =>
    pickerState(postings, notPostedSaved),
  );
  const [errors, setErrors] = useState<PickerErrors>(NO_ERRORS);
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState<Readonly<Record<string, RowNote>>>({});
  const [announce, setAnnounce] = useState({ n: 0, text: "" });
  const [focus, setFocus] = useState<(FocusTarget & { n: number }) | null>(
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  const {
    state: result,
    pending,
    resultKey,
    formProps,
  } = useFormAction(saveVideoPostings, null);

  const say = (text: string) => setAnnounce((a) => ({ n: a.n + 1, text }));
  const focusNext = (target: FocusTarget) =>
    setFocus((f) => ({ ...target, n: (f?.n ?? 0) + 1 }));

  // A save that stayed: the saved rows (new ids) replace the picker's, and their results are announced. Focus goes to
  // the first problem again here too, in case the refreshed rows paint after the Continue's answer.
  const [seenSaved, setSeenSaved] = useState(savedKey);
  if (seenSaved !== savedKey) {
    setSeenSaved(savedKey);
    setPicker(pickerState(postings, notPostedSaved));
    setNotes({});
    const text = resultsAnnouncement(postings);
    if (text) say(text);
    if (pending || resultKey > 0) focusNext({ kind: "problem" });
  }

  // Each Continue answer: its errors by row and the focus, which reads them (a field error through its field's
  // aria-describedby, a refusal without a field from its focused Banner): nothing is spoken twice.
  const [seenResult, setSeenResult] = useState(resultKey);
  if (seenResult !== resultKey) {
    setSeenResult(resultKey);
    setErrors(errorsFromResult(result, submitted));
    focusNext({ kind: "problem" });
  }

  useEffect(() => {
    if (focus === null) return;
    const frame = requestAnimationFrame(() => {
      const form = formRef.current;
      if (form) focusTarget(form, focus)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focus]);

  /** Check again (or Sync and check again) on a saved posting; `own` when the creator pressed it (focus follows). */
  async function check(posting: OwnerPostingDTO, sync: boolean, own: boolean) {
    setChecking((ids) => new Set(ids).add(posting.id));
    setNotes(({ [posting.id]: _gone, ...rest }) => rest);
    if (own) focusNext({ kind: "row", key: posting.id });
    const lines: string[] = [];
    if (sync) {
      for (const socialAccountId of accountsOn(accounts, posting.platform)
        .connectedIds) {
        const synced = await runAction(() =>
          syncAccount({ socialAccountId, mode: "recent" }),
        );
        // Signed out meanwhile: the router is already on its way to sign-in.
        if (synced === null) {
          setChecking((ids) => without(ids, posting.id));
          return;
        }
        const line =
          synced?.ok && !synced.data.ok
            ? syncFailureLine(synced.data, posting.label)
            : null;
        if (line) lines.push(line);
      }
    }
    const checked = await runAction(() =>
      recheckPosting({ postingId: posting.id }),
    );
    setChecking((ids) => without(ids, posting.id));
    if (checked === null) return;
    if (checked.ok) {
      say(
        postingLiveMessage(
          posting.label,
          checked.data.posting.verification === "verified",
        ),
      );
      if (lines.length > 0) {
        setNotes((n) => ({ ...n, [posting.id]: { helper: lines.join(" ") } }));
      }
    } else {
      setNotes((n) => ({
        ...n,
        [posting.id]: { error: checked.error.message },
      }));
    }
    if (own) focusNext({ kind: "row", key: posting.id });
  }

  // Back from Link / Reconnect {Platform} (Q-74 a): once, after StripConnectParams' own timeout (scheduled first, as the
  // page renders it before this form) has dropped ?connected= from the address.
  const returned = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on the postings the page came back with.
  useEffect(() => {
    if (returned.current) return;
    const targets = recheckOnReturn(postings, connected);
    if (targets.length === 0) return;
    const timer = setTimeout(() => {
      returned.current = true;
      setChecking((ids) => new Set([...ids, ...targets.map((p) => p.id)]));
      void (async () => {
        for (const posting of targets) await check(posting, false, false);
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const sameVideo = picker.notPosted
    ? null
    : sameVideoView(postings, video.durationMs);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const problems = continueProblems(picker, hasSource, opts);
    if (problems.fields || problems.nothingChosen) {
      event.preventDefault();
      setPicker(revealErrors);
      if (problems.nothingChosen) {
        setErrors((e) => ({ ...e, platforms: POSTINGS_COPY.nothingChosen }));
      }
      focusNext({ kind: "problem" });
      return;
    }
    const rows = postedRows(pickerCards(picker.rows, source?.platform ?? null));
    setSubmitted(rows.map((row) => row.key));
    formProps.onSubmit(event);
  }

  const on: PickerHandlers = {
    toggleChip: (platform) => {
      setPicker((state) => toggleChip(state, platform, hasSource));
      setErrors((e) => ({ ...e, platforms: null }));
    },
    notPosted: (value) => {
      setPicker((state) => setNotPosted(state, value));
      setErrors((e) => ({ ...e, platforms: null }));
    },
    add: (platform: PostingPlatform) => {
      const added = addRow(picker, platform, hasSource);
      if (added.key === null) return;
      setPicker(added.state);
      focusNext({ kind: "link", key: added.key });
    },
    // Focus to the field above, or to the card's Add another link when none is left above it.
    remove: (key, platform, before) => {
      setPicker((state) => removeRow(state, key));
      focusNext(
        before === undefined
          ? { kind: "add", key: platform }
          : { kind: "link", key: before },
      );
    },
    move: (key) => {
      const moved = moveLink(picker, key, hasSource, opts);
      if (moved.key === null) return;
      setPicker(moved.state);
      setErrors((e) => clearRowError(e, key, "link"));
      focusNext({ kind: "link", key: moved.key });
    },
    link: (key, value) => {
      setPicker((state) => setLink(state, key, value, opts));
      setErrors((e) => clearRowError(e, key, "link"));
    },
    linkBlur: (key) => setPicker((state) => showLinkError(state, key)),
    otherLabel: (key, value) => {
      setPicker((state) => setOtherLabel(state, key, value));
      setErrors((e) => clearRowError(e, key, "otherLabel"));
    },
    showLink: (key, value) =>
      setPicker((state) => setSwitch(state, key, value)),
    sourceShowLink: (value) =>
      setPicker((state) => ({ ...state, sourceSwitch: value })),
  };

  /** A saved posting's result in place, with its one action; "Checking the link…" while it is checked. */
  function resultOf(posting: OwnerPostingDTO, checkingNow: boolean) {
    if (checkingNow) return <CheckingLine />;
    const copy = postingResultCopy(
      posting,
      resultContext(accounts, posting.platform, APP_NAME),
    );
    const note = notes[posting.id];
    return (
      <>
        <PostingResult
          copy={copy}
          focusable
          action={
            copy.action === null ? null : (
              <PostingAction
                action={copy.action}
                posting={posting}
                videoId={video.id}
                onCheck={(sync) => void check(posting, sync, true)}
              />
            )
          }
        />
        {note ? (
          <FieldMessages id={`posting-note-${posting.id}`} {...note} />
        ) : null}
      </>
    );
  }

  return (
    <form
      ref={formRef}
      {...formProps}
      onSubmit={onSubmit}
      className="flex min-w-0 flex-col gap-6"
    >
      <input type="hidden" name={POSTINGS_FIELD.videoId} value={video.id} />
      <PostingPicker
        picker={picker}
        source={source}
        saved={savedById}
        allowMock={allowMock}
        errors={errors}
        pending={pending}
        checking={checking}
        resultOf={resultOf}
        on={on}
      />
      {sameVideo ? (
        <SameVideoBlock
          key={`${verifiedPostingsKey(sameVideo.verified)}|${video.sameVideoConfirmed}`}
          view={sameVideo}
          confirmed={video.sameVideoConfirmed}
          missing={errors.sameVideo}
          onTick={() => setErrors((e) => ({ ...e, sameVideo: false }))}
          cover={{
            src: video.posterSrc,
            width: video.width,
            height: video.height,
          }}
        />
      ) : null}
      {hasSource ? null : <UploadNote />}
      <Button
        type="submit"
        loading={pending}
        loadingLabel="Continuing…"
        className={PRIMARY_WIDTH}
      >
        Continue
      </Button>
      <p aria-live="polite" className="sr-only">
        <span key={announce.n}>{announce.text}</span>
      </p>
    </form>
  );
}

/** Uploads only (01 J5.6, moved from the File step by 07 D69; 05 callout 31): after the not-posted row, before Continue. */
function UploadNote() {
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-callout text-ink-2">{POSTINGS_COPY.uploadNote}</p>
      <Button asChild variant="link">
        <Link href="/dashboard/connections">
          {POSTINGS_COPY.connectAccount}
        </Link>
      </Button>
    </div>
  );
}
