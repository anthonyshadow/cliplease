// "Where was it posted?"'s form (07 D69; 02 §6.1 saveVideoPostings, plus sourceShowLink, owner answer Q-73 a): the names
// its fields post under, how the Server Action reads them back, and the pure rules the one composed Continue decides
// with. Pure and client-safe: the picker names its inputs with it and the action reads the FormData with it. Nothing
// here fetches a link (07 D67): links are only parsed (parsePostingLink).
//
// The FormData contract (one <form> around the picker, the same-video block and Continue):
//   videoId                    the video's id.
//   postings.<i>.platform      one per non-source posting row (the locked Library source row is never one), a
//                              PostingPlatform as a string; <i> is "0"…"11" (below POSTINGS_MAX, no leading zero). Rows
//                              read back in <i> order and compacted: gaps are fine, other indices are ignored.
//   postings.<i>.otherLabel    Other rows only: "Where? (for example, Vimeo)", as typed (the server tidies it).
//   postings.<i>.link          the link as typed; empty (or spaces) is a row with no link.
//   postings.<i>.showLink      "true" | "false" (07 D18, OQ-17): the Switch once the creator toggled it this visit;
//                              else "false" while the link is still the saved one and its saved Switch is off; else
//                              absent, so the server keeps the saved value or applies its default (an unlisted post's
//                              link hidden). A saved true is never posted back: on a row saved unverified it is the
//                              default, not a choice, and posting it would show an unlisted post's link once it
//                              verifies on this save.
//   notPosted                  "on" while "I haven't posted it anywhere yet." is ticked (uploads only).
//   sourceShowLink             "true" | "false": the locked Library source row's Switch (Q-73 a) once the creator
//                              turned it this visit; else absent (always on uploads), so the server keeps the saved value.
//   sameVideo                  "on" while "These posts show this same video" is ticked.
//   verifiedKey                verifiedPostingsKey of the verified postings the same-video block showed.
//   platform                   FilterChips' hidden chip mirror (04 §9.14), the no-JS fallback: read only when no
//                              postings.* field is posted at all, and never posted for the locked source chip
//                              (FilterChips mirrors no disabled chip), which would add a link-less copy of the source.
// Switches post through hidden inputs (switchFieldValue): a Radix Switch posts "on" or nothing, so the Switch itself has
// no name. Field errors use the same names (postingFieldKey), at the row's form index (`indices`).
import {
  isOneOf,
  POSTING_PLATFORMS,
  type PostingUnverifiedReason,
  type VideoStatus,
} from "../domain/values";
import type { ActionResult } from "../result";
import { POSTINGS_MAX } from "./limits";
import { parsePostingLink } from "./parse";
import { type PostingPlanRow, planPostings } from "./plan";
import type { OwnerPostingDTO } from "./types";

/** The form's field names outside the rows. */
export const POSTINGS_FIELD = {
  videoId: "videoId",
  notPosted: "notPosted",
  sourceShowLink: "sourceShowLink",
  sameVideo: "sameVideo",
  verifiedKey: "verifiedKey",
  chipMirror: "platform",
} as const;

/** A posting row's fields. */
export type PostingField = "platform" | "otherLabel" | "link" | "showLink";

/** `postings.<i>.<field>`: a row field's name, and the key of its field error in ActionResult's `fields`. */
export const postingFieldKey = (i: number, f: PostingField) =>
  `postings.${i}.${f}` as const;

/** The field error key of the chips ("Say where it was posted", 05 §6.5 States). */
export const PLATFORMS_FIELD = "platforms";

/** What the save action answers when the step stays (it redirects to ?step=rights when it moves on). */
export type SavePostingsData = {
  /** The tick was required, nothing changed and it wasn't ticked: SAME_VIDEO_COPY.missingTick on the tick. */
  sameVideoMissing: boolean;
};
export type SavePostingsState = ActionResult<SavePostingsData> | null;

/** One posting row as posted; the platform stays a string for the server's Zod (02 §6.1) to check. */
export type PostingFormRow = {
  platform: string;
  otherLabel?: string;
  link?: string;
  showLink?: boolean;
};

/** The form read back: saveVideoPostings' input (02 §6.1, plus sourceShowLink) and the Continue's own fields. */
export type PostingsFormData = {
  videoId: string;
  notPosted: boolean;
  postings: PostingFormRow[];
  /** `indices[k]` is the form index <i> of `postings[k]`: a domain or Zod error on row k is shown at that index. */
  indices: number[];
  sourceShowLink?: boolean;
  sameVideo: boolean;
  verifiedKey: string;
};

/** A Switch's hidden input value. */
export const switchFieldValue = (on: boolean) => (on ? "true" : "false");

/** "0" … "11": the only row indices read, each the index's one spelling ("01" is not 1). */
const ROW_INDICES = Array.from({ length: POSTINGS_MAX }, (_, i) => `${i}`);
const ROW_FIELD = /^postings\.([^.]*)\.(?:platform|otherLabel|link|showLink)$/;

const textOf = (fd: FormData, name: string) => {
  const value = fd.get(name);
  return typeof value === "string" ? value : undefined;
};

/** "true" → true, "false" → false, anything else (or nothing) → undefined: never a guess at the creator's choice. */
function booleanOf(fd: FormData, name: string): boolean | undefined {
  const value = textOf(fd, name);
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function rowAt(fd: FormData, i: number): PostingFormRow {
  const link = textOf(fd, postingFieldKey(i, "link"));
  const otherLabel = textOf(fd, postingFieldKey(i, "otherLabel"));
  const showLink = booleanOf(fd, postingFieldKey(i, "showLink"));
  return {
    platform: textOf(fd, postingFieldKey(i, "platform")) ?? "",
    ...(otherLabel === undefined ? {} : { otherLabel }),
    ...(link === undefined || link.trim() === "" ? {} : { link }),
    ...(showLink === undefined ? {} : { showLink }),
  };
}

/**
 * The posted form, read (see the contract above). Row indices outside "0"…"11" are ignored, so a crafted
 * `postings.999999999.platform` never builds a sparse array before the server's Zod caps the rows at POSTINGS_MAX. With
 * no postings.* field at all, the chips' `platform` mirror (no JS) gives link-less rows, each platform once.
 */
export function postingsFromFormData(fd: FormData): PostingsFormData {
  const found = new Set<number>();
  let rowFieldPosted = false;
  for (const name of fd.keys()) {
    if (!name.startsWith("postings.")) continue;
    rowFieldPosted = true;
    const index = ROW_INDICES.indexOf(ROW_FIELD.exec(name)?.[1] ?? "");
    if (index >= 0) found.add(index);
  }
  let indices = [...found].sort((a, b) => a - b);
  let postings = indices.map((i) => rowAt(fd, i));
  if (!rowFieldPosted) {
    const mirrored = fd
      .getAll(POSTINGS_FIELD.chipMirror)
      .filter((value): value is string => typeof value === "string");
    postings = [...new Set(mirrored)].map((platform) => ({ platform }));
    indices = postings.map((_, k) => k);
  }
  const sourceShowLink = booleanOf(fd, POSTINGS_FIELD.sourceShowLink);
  return {
    videoId: textOf(fd, POSTINGS_FIELD.videoId) ?? "",
    notPosted: textOf(fd, POSTINGS_FIELD.notPosted) === "on",
    postings,
    indices,
    ...(sourceShowLink === undefined ? {} : { sourceShowLink }),
    sameVideo: textOf(fd, POSTINGS_FIELD.sameVideo) === "on",
    verifiedKey: textOf(fd, POSTINGS_FIELD.verifiedKey) ?? "",
  };
}

/** A link's canonical url as the server would store it (parsePostingLink), or null: no link, or one that doesn't parse. */
export function canonicalPostingUrl(
  platform: string,
  link: string | undefined,
  opts: { allowMock: boolean },
): string | null {
  const text = link?.trim() ?? "";
  if (text === "" || !isOneOf(POSTING_PLATFORMS, platform)) return null;
  const parsed = parsePostingLink(platform, text, opts);
  return parsed.ok ? parsed.link.url : null;
}

type SavedPosting = Pick<
  OwnerPostingDTO,
  "platform" | "label" | "url" | "isSource" | "showLink" | "position"
>;

/** The saved source posting's link key, read again from its stored url (the DTO carries no link key). */
function sourceLinkKey(
  source: SavedPosting,
  opts: { allowMock: boolean },
): string | null {
  if (source.url === null) return null;
  const parsed = parsePostingLink(source.platform, source.url, opts);
  return parsed.ok ? parsed.link.linkKey : null;
}

/**
 * Whether a save would change the postings (04 §9.33: "A second Continue with nothing changed moves on"): the rows
 * planPostings would write (the save's own rule), compared in order with the saved non-source rows by platform, Other's
 * name, the canonical url (so a pasted link with tracking params equal to the stored one is unchanged) and showLink when
 * posted; plus the source row's Switch when posted. Rows the save would drop (a second copy of a post, a copy of the
 * source) don't count; a row that would fail does. `input` is 02 §6.1's Zod output (Other's name tidied).
 */
export function postingsInputChanged(
  before: readonly SavedPosting[],
  input: { postings: readonly PostingPlanRow[]; sourceShowLink?: boolean },
  opts: { allowMock: boolean },
): boolean {
  const source = before.find((posting) => posting.isSource) ?? null;
  if (
    source !== null &&
    input.sourceShowLink !== undefined &&
    input.sourceShowLink !== source.showLink
  ) {
    return true;
  }
  const saved = before
    .filter((posting) => !posting.isSource)
    .sort((a, b) => a.position - b.position);
  const plan = planPostings(input.postings, {
    allowMock: opts.allowMock,
    source:
      source === null
        ? null
        : { platform: source.platform, linkKey: sourceLinkKey(source, opts) },
  });
  if (!plan.ok || plan.rows.length !== saved.length) return true;
  return plan.rows.some((row, k) => {
    const was = saved[k];
    return (
      row.platform !== was.platform ||
      row.otherLabel !== (was.platform === "other" ? was.label : null) ||
      row.url !== was.url ||
      (row.showLink !== undefined && row.showLink !== was.showLink)
    );
  });
}

/**
 * 05 §6.5 States "Nothing chosen": an upload (no source row) with no posting row and "I haven't posted it anywhere yet."
 * unticked. The step's Continue blocks on it and the action refuses it with "Say where it was posted" under the chips,
 * saving nothing.
 */
export const isNothingChosen = (facts: {
  hasSource: boolean;
  rowCount: number;
  notPosted: boolean;
}): boolean => !facts.hasSource && facts.rowCount === 0 && !facts.notPosted;

/**
 * The verified postings a same-video tick confirms (07 D69): their sorted "platform url" pairs, joined by spaces (a
 * canonical url has none, and a hidden input keeps spaces where form encoding rewrites line breaks). It depends on the
 * posts only, so it is stable when a save replaces the rows; "" when nothing is verified.
 */
export function verifiedPostingsKey(
  postings: readonly Pick<
    OwnerPostingDTO,
    "platform" | "url" | "verification"
  >[],
): string {
  return postings
    .filter((posting) => posting.verification === "verified" && posting.url)
    .map((posting) => `${posting.platform} ${posting.url}`)
    .sort()
    .join(" ");
}

const ATTENTION_REASONS: readonly PostingUnverifiedReason[] = [
  "not_found",
  "no_account",
  "check_failed",
];

/** A saved link that came back not_found, no_account or check_failed: the step stays on it (04 §9.33 Footer). */
export const needsAttention = (
  posting: Pick<OwnerPostingDTO, "url" | "verification" | "unverifiedReason">,
) =>
  posting.url !== null &&
  posting.verification === "unverified" &&
  posting.unverifiedReason !== null &&
  ATTENTION_REASONS.includes(posting.unverifiedReason);

export type PostingsStepOutcome = "next" | "stay";

/**
 * After Continue's save (04 §9.33 Footer): stay while the step isn't complete, or when this Continue changed something
 * and a row needs attention; otherwise go on to Rights, so a second Continue with nothing changed moves on.
 */
export function postingsStepOutcome(facts: {
  complete: boolean;
  changed: boolean;
  needsAttention: boolean;
}): PostingsStepOutcome {
  if (!facts.complete) return "stay";
  return facts.changed && facts.needsAttention ? "stay" : "next";
}

export type PostingsStepMode = "edit" | "read_only";

/** The statuses whose postings can change (07 D69): the video is off. The save and Check again refuse the rest. */
export const POSTINGS_EDITABLE: readonly VideoStatus[] = [
  "draft",
  "unpublished",
];

/**
 * Editable while POSTINGS_EDITABLE (07 D69); a published video shows its postings read-only under "Turn off to edit
 * where it was posted." (05 frame 35). A disabled video's page shows no step (P10b's placeholder).
 */
export const postingsStepMode = (status: VideoStatus): PostingsStepMode =>
  POSTINGS_EDITABLE.includes(status) ? "edit" : "read_only";
