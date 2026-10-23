// The "Where was it posted?" picker's state (04 §9.33; 05 §6.5 S17b; 07 D69; owner answers Q-73–Q-79): the link rows the
// creator edits, the cards and chips they make, what Continue checks before it posts, the server's field errors mapped
// back to the rows, and the facts the step reads from the saved postings (the accounts per platform, the same-video
// block, Check again on return from a connect). Pure and client-safe: PostingsForm holds it in state, and PostingsStep
// builds the account facts with it on the server. Nothing here fetches a link (07 D67): links are only parsed.
import {
  couldntReach,
  rateLimitMessage,
  retryMinutes,
} from "@/components/connections/connect-messages";
import type { ToggleChip } from "@/components/library/filter-chips";
import {
  isOneOf,
  POSTING_PLATFORMS,
  type PostingLinkError,
  type PostingPlatform,
  SOCIAL_PROVIDERS,
  type SocialAccountStatus,
  type SocialProviderId,
} from "@/lib/domain/values";
import {
  type PostingResultContext,
  postingChips,
  postingLiveMessage,
  SAME_VIDEO_COPY,
} from "@/lib/postings/copy";
import {
  canonicalPostingUrl,
  isNothingChosen,
  PLATFORMS_FIELD,
  type SavePostingsState,
} from "@/lib/postings/form";
import { POSTINGS_MAX } from "@/lib/postings/limits";
import { parsePostingLink } from "@/lib/postings/parse";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import { durationMismatchMessage } from "@/lib/videos/duration";

type ParseOpts = { allowMock: boolean };

/** One link field the creator edits (a non-source posting, saved or new). */
export type PickerRow = {
  /** React key and focus handle: the saved posting's id, or "new-<n>" for a row added this visit. */
  key: string;
  platform: PostingPlatform;
  /** Other only: "Where? (for example, Vimeo)", as typed (owner answer Q-79 a: one per Other posting). */
  otherLabel: string;
  /** The link as typed. */
  link: string;
  /** "Show buyers this link" as the creator set it this visit; null while untouched (the default shows, 07 D18). */
  switchOn: boolean | null;
  /** The saved posting this row was read from; its result shows while the link still matches it. */
  savedId: string | null;
  /** The link's parse error shows (after a blur, Move or Continue; never while typing, 04 §9.6). */
  linkErrorShown: boolean;
  /** Other's missing name shows (after Continue). */
  nameErrorShown: boolean;
};

export type PickerState = {
  rows: PickerRow[];
  /** "I haven't posted it anywhere yet." (uploads only, 01 J5.29). */
  notPosted: boolean;
  /**
   * The locked Library source row's Switch once the creator turns it (owner answer Q-73 a); null until then, so it shows
   * the stored value of the current postings (a Check again that hides an unlisted source's link moves it too) and posts
   * no `sourceShowLink`. Unused on an upload.
   */
  sourceSwitch: boolean | null;
  /** The next new row's number ("new-<n>"). */
  next: number;
};

/** The source posting (a Library video's locked row, 07 D65), or null on an upload. */
export const sourceOf = (postings: readonly OwnerPostingDTO[]) =>
  postings.find((posting) => posting.isSource) ?? null;

/**
 * The picker as the saved postings read (a reload, or a Continue that stayed: a save gives every row a new id, so the
 * form rebuilds from these). Not-posted is ticked when the draft was saved that way (postings_confirmed_at set and no row).
 */
export function pickerState(
  postings: readonly OwnerPostingDTO[],
  notPostedSaved: boolean,
): PickerState {
  const rows = postings
    .filter((posting) => !posting.isSource)
    .sort((a, b) => a.position - b.position)
    .map(
      (posting): PickerRow => ({
        key: posting.id,
        platform: posting.platform,
        otherLabel: posting.platform === "other" ? posting.label : "",
        link: posting.url ?? "",
        switchOn: null,
        savedId: posting.id,
        linkErrorShown: false,
        nameErrorShown: false,
      }),
    );
  return {
    rows,
    notPosted: notPostedSaved && rows.length === 0,
    sourceSwitch: null,
    next: 0,
  };
}

/**
 * At 12 places (07 §7.2 POSTINGS_MAX counts the source posting too) nothing more can be added: "Add another link", an
 * off chip and a Move that needs a new field.
 */
export const atLimit = (state: PickerState, hasSource: boolean) =>
  state.rows.length + (hasSource ? 1 : 0) >= POSTINGS_MAX;

const newRow = (
  state: PickerState,
  platform: PostingPlatform,
  link = "",
): PickerRow => ({
  key: `new-${state.next}`,
  platform,
  otherLabel: "",
  link,
  switchOn: null,
  savedId: null,
  linkErrorShown: link !== "",
  nameErrorShown: false,
});

const withRow = (state: PickerState, row: PickerRow): PickerState => ({
  ...state,
  rows: [...state.rows, row],
  next: state.next + 1,
});

const mapRow = (
  state: PickerState,
  key: string,
  update: (row: PickerRow) => PickerRow,
): PickerState => ({
  ...state,
  rows: state.rows.map((row) => (row.key === key ? update(row) : row)),
});

/** "Add another link" on a card (OQ-15: a second account on one platform; on Other a name + link pair, Q-79 a). */
export function addRow(
  state: PickerState,
  platform: PostingPlatform,
  hasSource: boolean,
): { state: PickerState; key: string | null } {
  if (atLimit(state, hasSource)) return { state, key: null };
  const row = newRow(state, platform);
  return { state: withRow(state, row), key: row.key };
}

/** A chip pressed (04 §9.33): on adds the platform's card with one empty field; off removes it and its typed links. */
export function toggleChip(
  state: PickerState,
  platform: PostingPlatform,
  hasSource: boolean,
): PickerState {
  if (state.rows.some((row) => row.platform === platform)) {
    return {
      ...state,
      rows: state.rows.filter((row) => row.platform !== platform),
    };
  }
  return addRow(state, platform, hasSource).state;
}

/** "Remove" on an added field. */
export const removeRow = (state: PickerState, key: string): PickerState => ({
  ...state,
  rows: state.rows.filter((row) => row.key !== key),
});

/**
 * The link typed: its error hides until the next blur (04 §9.6), and a link that now reads as a different post (or
 * none) starts its Switch from the default again, so a choice made for one post never carries to another (07 D18).
 */
export function setLink(
  state: PickerState,
  key: string,
  link: string,
  opts: ParseOpts,
): PickerState {
  return mapRow(state, key, (row) => {
    const before = canonicalPostingUrl(row.platform, row.link, opts);
    const after = canonicalPostingUrl(row.platform, link, opts);
    return {
      ...row,
      link,
      linkErrorShown: false,
      switchOn: before === after ? row.switchOn : null,
    };
  });
}

/** The link field left (blur): its parse error, if any, shows. */
export const showLinkError = (state: PickerState, key: string) =>
  mapRow(state, key, (row) => ({ ...row, linkErrorShown: true }));

export const setOtherLabel = (
  state: PickerState,
  key: string,
  otherLabel: string,
) => mapRow(state, key, (row) => ({ ...row, otherLabel }));

export const setSwitch = (state: PickerState, key: string, on: boolean) =>
  mapRow(state, key, (row) => ({ ...row, switchOn: on }));

/** Ticked: every chip off and its cards gone (04 §9.33); unticked: the chips come back empty. */
export const setNotPosted = (state: PickerState, on: boolean): PickerState =>
  on ? { ...state, notPosted: true, rows: [] } : { ...state, notPosted: false };

/** Continue pressed: every link's parse error and every missing Other name shows (04 §9.6). */
export const revealErrors = (state: PickerState): PickerState => ({
  ...state,
  rows: state.rows.map((row) => ({
    ...row,
    linkErrorShown: true,
    nameErrorShown: true,
  })),
});

/** A link that doesn't parse: its code (04 §11.10), and for wrong_platform the platform it belongs to. */
export type LinkProblem = {
  error: PostingLinkError;
  detected?: PostingPlatform;
};

/** A link's parse error, or null for no link or one that parses. */
export function linkProblem(
  row: Pick<PickerRow, "platform" | "link">,
  opts: ParseOpts,
): LinkProblem | null {
  if (row.link.trim() === "") return null;
  const parsed = parsePostingLink(row.platform, row.link, opts);
  return parsed.ok ? null : parsed;
}

/** Other's name is required (1–40 characters; "Add the name of the site."). */
export const nameMissing = (row: Pick<PickerRow, "platform" | "otherLabel">) =>
  row.platform === "other" && row.otherLabel.trim() === "";

/**
 * Where a wrong_platform link's **Move** puts it (04 §9.33): the detected platform's first empty field, else a new field
 * on that card (turning its chip on) while below POSTINGS_MAX; null when there is nowhere to put it.
 */
export function moveTarget(
  state: PickerState,
  key: string,
  hasSource: boolean,
  opts: ParseOpts,
): { platform: PostingPlatform; into: string | null } | null {
  const row = state.rows.find((r) => r.key === key);
  const detected = row ? linkProblem(row, opts)?.detected : undefined;
  if (!row || detected === undefined) return null;
  const empty = state.rows.find(
    (r) => r.platform === detected && r.key !== key && r.link.trim() === "",
  );
  if (empty) return { platform: detected, into: empty.key };
  return atLimit(state, hasSource) ? null : { platform: detected, into: null };
}

/**
 * **Move**: the link goes to the detected platform's card (an empty field there, or a new one), and the field it came
 * from is cleared, its chip left on (it saves as "posted there, no link" unless the creator turns it off).
 */
export function moveLink(
  state: PickerState,
  key: string,
  hasSource: boolean,
  opts: ParseOpts,
): { state: PickerState; key: string | null } {
  const target = moveTarget(state, key, hasSource, opts);
  const row = state.rows.find((r) => r.key === key);
  if (!target || !row) return { state, key: null };
  const cleared = mapRow(state, key, (r) => ({
    ...r,
    link: "",
    switchOn: null,
    linkErrorShown: false,
  }));
  if (target.into !== null) {
    return {
      state: mapRow(cleared, target.into, (r) => ({
        ...r,
        link: row.link,
        switchOn: null,
        linkErrorShown: true,
      })),
      key: target.into,
    };
  }
  const moved = newRow(cleared, target.platform, row.link);
  return { state: withRow(cleared, moved), key: moved.key };
}

/**
 * What blocks Continue before anything is posted (04 §9.33, 05 §6.5 States): a link that doesn't parse, an Other row
 * without its name, or an upload with nothing chosen ("Say where it was posted"). The server checks all of it again.
 */
export function continueProblems(
  state: PickerState,
  hasSource: boolean,
  opts: ParseOpts,
): { fields: boolean; nothingChosen: boolean } {
  return {
    fields: state.rows.some(
      (row) => linkProblem(row, opts) !== null || nameMissing(row),
    ),
    nothingChosen: isNothingChosen({
      hasSource,
      rowCount: state.rows.length,
      notPosted: state.notPosted,
    }),
  };
}

/** One posting card (04 §9.33): the platform's rows; the source platform's card holds the locked source row first. */
export type PickerCard = {
  platform: PostingPlatform;
  rows: PickerRow[];
  hasSource: boolean;
};

/** The cards in order: the source platform's first (05 §6.5 frame), then the others in chip order. */
export function pickerCards(
  rows: readonly PickerRow[],
  sourcePlatform: PostingPlatform | null,
): PickerCard[] {
  const others = POSTING_PLATFORMS.filter(
    (p) => p !== sourcePlatform && rows.some((row) => row.platform === p),
  );
  const order = sourcePlatform === null ? others : [sourcePlatform, ...others];
  return order.map((platform) => ({
    platform,
    rows: rows.filter((row) => row.platform === platform),
    hasSource: platform === sourcePlatform,
  }));
}

/** The rows in the order they post: card by card. Each row's form index (postings.<i>.*) is its place here. */
export const postedRows = (cards: readonly PickerCard[]) =>
  cards.flatMap((card) => card.rows);

/**
 * The chips (FilterChips multiple mode, 04 §9.14): on while the platform has a card. The source chip is on and
 * aria-disabled (its posting can't be removed); every chip is aria-disabled while "I haven't posted it anywhere yet." is
 * ticked; an off chip is aria-disabled at the 12-place limit.
 */
export function pickerChips(
  state: PickerState,
  sourcePlatform: PostingPlatform | null,
  allowMock: boolean,
): ToggleChip<PostingPlatform>[] {
  const full = atLimit(state, sourcePlatform !== null);
  return postingChips(allowMock).map(({ platform, label }) => {
    const source = platform === sourcePlatform;
    const pressed =
      source || state.rows.some((row) => row.platform === platform);
    return {
      value: platform,
      label,
      pressed,
      disabled: source || state.notPosted || (full && !pressed),
    };
  });
}

/** The saved posting whose result a row still shows: the row's link (or no link) is still the saved one. */
export function matchingSaved(
  row: PickerRow,
  saved: OwnerPostingDTO | undefined,
  opts: ParseOpts,
): OwnerPostingDTO | null {
  if (!saved || saved.platform !== row.platform) return null;
  if (saved.url === null) return row.link.trim() === "" ? saved : null;
  return canonicalPostingUrl(row.platform, row.link, opts) === saved.url
    ? saved
    : null;
}

/**
 * The Switch as shown (04 §9.33): the creator's choice this visit, else the saved value while the link is the saved one
 * (`saved` is matchingSaved's match; a link-less match shows no Switch), else on.
 */
export const shownSwitch = (row: PickerRow, saved: OwnerPostingDTO | null) =>
  row.switchOn ?? saved?.showLink ?? true;

/**
 * The row's `postings.<i>.showLink` (07 D18, D68; OQ-17; owner answer Q-86 a): the creator's choice this visit, else
 * undefined to post none, and the server's save decides: a post it already holds keeps its saved value (a hidden link
 * stays hidden), a new one gets the default (an unlisted post's link hidden). setLink resets the choice when the link
 * stops being the same post.
 */
export const showLinkValue = (row: Pick<PickerRow, "switchOn">) =>
  row.switchOn ?? undefined;

/** The errors a Continue's answer left, by row key (the form index at submit time mapped back), until edited. */
export type PickerErrors = {
  rows: Readonly<Record<string, { link?: string; otherLabel?: string }>>;
  /** "Say where it was posted" under the chips. */
  platforms: string | null;
  /** A refusal with no field: the error Banner above the cards. */
  form: string | null;
  /** "Confirm these posts show this same video" on the tick (owner answer Q-75 a). */
  sameVideo: boolean;
};

export const NO_ERRORS: PickerErrors = {
  rows: {},
  platforms: null,
  form: null,
  sameVideo: false,
};

const ROW_ERROR = /^postings\.(\d{1,2})\.(link|otherLabel)$/;

/**
 * A Continue's answer as errors: a refusal's field keys (postings.<i>.link|otherLabel at `submitted[i]`, the chips), or
 * a staying save's missing tick (`sameVideoMissing`).
 */
export function errorsFromResult(
  result: SavePostingsState,
  submitted: readonly string[],
): PickerErrors {
  if (result === null) return NO_ERRORS;
  if (result.ok) {
    return { ...NO_ERRORS, sameVideo: result.data.sameVideoMissing };
  }
  const { message, fields } = result.error;
  if (!fields) return { ...NO_ERRORS, form: message };
  const rows: Record<string, { link?: string; otherLabel?: string }> = {};
  let platforms: string | null = null;
  let placed = false;
  for (const [name, messages] of Object.entries(fields)) {
    const text = messages[0] ?? message;
    const match = ROW_ERROR.exec(name);
    const key = match ? submitted[Number.parseInt(match[1], 10)] : undefined;
    if (match && key !== undefined) {
      const field = match[2] === "link" ? "link" : "otherLabel";
      rows[key] = { ...rows[key], [field]: text };
      placed = true;
    } else if (name === PLATFORMS_FIELD) {
      platforms = text;
      placed = true;
    }
  }
  // A field the form no longer has keeps its words above the cards rather than being lost.
  return { rows, platforms, sameVideo: false, form: placed ? null : message };
}

/** A row's field edited: its answer from the server goes. */
export function clearRowError(
  errors: PickerErrors,
  key: string,
  field: "link" | "otherLabel",
): PickerErrors {
  const row = errors.rows[key];
  if (!row?.[field]) return errors;
  const { [field]: _gone, ...rest } = row;
  return { ...errors, rows: { ...errors.rows, [key]: rest } };
}

/** What the step knows of the creator's accounts on one provider (listPostingAccountStates: never names, avatars or tokens). */
export type PostingAccountState = {
  /** ENABLED_SOCIAL_PROVIDERS lists it (enabledPlatforms). */
  providerEnabled: boolean;
  /** The `connected` accounts, synced in turn by "Sync and check again". */
  connectedIds: string[];
  /** Every account on it (at least one) is `needs_reconnect`: check_failed offers "Reconnect {Platform}". */
  onlyNeedsReconnect: boolean;
};

export type PostingAccounts = Record<SocialProviderId, PostingAccountState>;

/** The account facts per provider, from the enabled providers and the creator's linked (not disconnected) accounts. */
export function postingAccounts(
  enabled: readonly SocialProviderId[],
  accounts: readonly {
    id: string;
    platform: SocialProviderId;
    status: SocialAccountStatus;
  }[],
): PostingAccounts {
  const entries = SOCIAL_PROVIDERS.map((platform) => {
    const linked = accounts.filter((a) => a.platform === platform);
    return [
      platform,
      {
        providerEnabled: enabled.includes(platform),
        connectedIds: linked
          .filter((a) => a.status === "connected")
          .map((a) => a.id),
        onlyNeedsReconnect:
          linked.length > 0 &&
          linked.every((a) => a.status === "needs_reconnect"),
      },
    ] as const;
  });
  return Object.fromEntries(entries) as PostingAccounts;
}

const NO_ACCOUNT: PostingAccountState = {
  providerEnabled: false,
  connectedIds: [],
  onlyNeedsReconnect: false,
};

/** One platform's account facts; Facebook, X, Snapchat and Other have no provider. */
export const accountsOn = (
  accounts: PostingAccounts,
  platform: PostingPlatform,
): PostingAccountState =>
  isOneOf(SOCIAL_PROVIDERS, platform) ? accounts[platform] : NO_ACCOUNT;

/** postingResultCopy's context for a platform. */
export function resultContext(
  accounts: PostingAccounts,
  platform: PostingPlatform,
  appName: string,
): PostingResultContext {
  const state = accountsOn(accounts, platform);
  return {
    appName,
    providerEnabled: state.providerEnabled,
    hasConnectedAccount: state.connectedIds.length > 0,
    onlyNeedsReconnect: state.onlyNeedsReconnect,
  };
}

/**
 * A sync that "Sync and check again" couldn't finish, in 04 §11.8's words: rate limited ("{Platform} asked us to slow
 * down. Try again in 15 min.") or the platform unreachable. Already syncing counts as done; a sign-out shows as the
 * recheck's own Reconnect; anything else says nothing (the recheck answers).
 */
export function syncFailureLine(
  result: { reason: string; retryAfterSec?: number },
  label: string,
): string | null {
  if (result.reason === "rate_limited") {
    return rateLimitMessage(label, retryMinutes(result.retryAfterSec));
  }
  if (result.reason === "upstream_error") return couldntReach(label);
  return null;
}

/** The polite live region after a save (04 §9.33): "Demo link verified. Instagram link not verified", once per result. */
export const resultsAnnouncement = (postings: readonly OwnerPostingDTO[]) =>
  postings
    .filter((posting) => !posting.isSource && posting.url !== null)
    .map((posting) =>
      postingLiveMessage(posting.label, posting.verification === "verified"),
    )
    .join(". ");

/**
 * Back from Link / Reconnect {Platform} with ?connected=<provider> (owner answer Q-74 a): the postings on that platform
 * whose link came back no_account or check_failed, checked again once each.
 */
export const recheckOnReturn = (
  postings: readonly OwnerPostingDTO[],
  connected: SocialProviderId | null,
) =>
  connected === null
    ? []
    : postings.filter(
        (posting) =>
          posting.platform === connected &&
          posting.url !== null &&
          posting.verification === "unverified" &&
          (posting.unverifiedReason === "no_account" ||
            posting.unverifiedReason === "check_failed"),
      );

/**
 * The post a duration warning names (SAME_VIDEO_COPY.warningPost): undefined for the one verified post (04's "the
 * post"); with several, its platform, and its account too when another verified post shares the platform (owner
 * answers Q-76, Q-85 a), or the platform alone for a row stored without a name.
 */
function warningPostName(
  posting: OwnerPostingDTO,
  verified: readonly OwnerPostingDTO[],
): string | undefined {
  if (verified.length === 1) return undefined;
  const shared = verified.some(
    (other) => other.id !== posting.id && other.platform === posting.platform,
  );
  return SAME_VIDEO_COPY.warningPost(
    posting.label,
    shared ? posting.verifiedUsername : null,
  );
}

/**
 * The same-video block (07 D69, moved from the File step; owner answers Q-75, Q-76, Q-85 a): the verified posts in
 * position order (the source first), whether there are several (the captions then name the platform), and one duration
 * warning per post whose length differs from the file's by more than 1 s, naming the post (warningPostName). Null when
 * nothing is verified.
 */
export function sameVideoView(
  postings: readonly OwnerPostingDTO[],
  fileDurationMs: number | null,
): {
  verified: OwnerPostingDTO[];
  several: boolean;
  warnings: { id: string; text: string }[];
} | null {
  const verified = postings
    .filter((posting) => posting.verification === "verified")
    .sort((a, b) => a.position - b.position);
  if (verified.length === 0) return null;
  const warnings = verified.flatMap((posting) => {
    const text = durationMismatchMessage(
      fileDurationMs,
      posting.durationSec,
      warningPostName(posting, verified),
    );
    return text === null ? [] : [{ id: posting.id, text }];
  });
  return { verified, several: verified.length > 1, warnings };
}
