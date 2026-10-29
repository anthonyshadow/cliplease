import { describe, expect, it } from "vitest";
import { POSTINGS_MAX } from "@/lib/postings/limits";
import {
  SOURCE_POSTING,
  savedPosting,
} from "../../../tests/helpers/postings-fixtures";
import {
  addRow,
  atLimit,
  clearRowError,
  continueProblems,
  errorsFromResult,
  matchingSaved,
  moveLink,
  moveTarget,
  NO_ERRORS,
  type PickerState,
  pickerCards,
  pickerChips,
  pickerState,
  postedRows,
  postingAccounts,
  recheckOnReturn,
  removeRow,
  resultContext,
  resultsAnnouncement,
  revealErrors,
  sameVideoView,
  setLink,
  setNotPosted,
  setSwitch,
  showLinkError,
  showLinkValue,
  shownSwitch,
  syncFailureLine,
  toggleChip,
} from "./posting-picker-state";

const opts = { allowMock: true };
const REEL = "https://www.instagram.com/reel/C0dEaBcDeF1/";
const REEL_URL = "https://www.instagram.com/reel/C0dEaBcDeF1/";

const empty = (): PickerState => pickerState([], false);

describe("pickerState", () => {
  it("reads the non-source postings in position order, keyed on their ids, Other with its name", () => {
    const state = pickerState(
      [
        savedPosting({
          id: "b",
          platform: "facebook",
          label: "Facebook",
          position: 2,
          url: null,
        }),
        SOURCE_POSTING,
        savedPosting({
          id: "a",
          platform: "other",
          label: "Vimeo",
          position: 1,
          url: "https://vimeo.com/1",
        }),
      ],
      false,
    );
    expect(
      state.rows.map((r) => [r.key, r.platform, r.otherLabel, r.link]),
    ).toEqual([
      ["a", "other", "Vimeo", "https://vimeo.com/1"],
      ["b", "facebook", "", ""],
    ]);
    expect(
      state.rows.every((r) => r.savedId === r.key && r.switchOn === null),
    ).toBe(true);
    expect(state.notPosted).toBe(false);
  });

  it("leaves the source Switch untouched (it shows the stored value), and not-posted ticked only for a confirmed draft with no row", () => {
    expect(
      pickerState([{ ...SOURCE_POSTING, showLink: false }], false).sourceSwitch,
    ).toBeNull();
    expect(pickerState([], true).notPosted).toBe(true);
    expect(pickerState([savedPosting({})], true).notPosted).toBe(false);
  });
});

describe("chips, cards and the 12-place limit", () => {
  it("a chip on adds its card with one empty field; off removes the card and what was typed in it", () => {
    let state = toggleChip(empty(), "tiktok", false);
    state = setLink(
      state,
      state.rows[0].key,
      "https://vm.tiktok.com/ZMabc123/",
      opts,
    );
    state = addRow(state, "tiktok", false).state;
    expect(state.rows).toHaveLength(2);
    state = toggleChip(state, "tiktok", false);
    expect(state.rows).toEqual([]);
  });

  it("orders the cards in chip order, the source platform's card first, and posts the rows card by card", () => {
    let state = pickerState([SOURCE_POSTING], false);
    state = toggleChip(state, "other", true);
    state = toggleChip(state, "instagram", true);
    state = addRow(state, "mock", true).state;
    const cards = pickerCards(state.rows, "mock");
    expect(cards.map((c) => [c.platform, c.rows.length, c.hasSource])).toEqual([
      ["mock", 1, true],
      ["instagram", 1, false],
      ["other", 1, false],
    ]);
    expect(postedRows(cards).map((r) => r.platform)).toEqual([
      "mock",
      "instagram",
      "other",
    ]);
  });

  it("the source chip is on and aria-disabled; every chip is aria-disabled while not-posted is ticked", () => {
    const library = pickerChips(
      pickerState([SOURCE_POSTING], false),
      "mock",
      true,
    );
    expect(library.find((c) => c.value === "mock")).toMatchObject({
      pressed: true,
      disabled: true,
    });
    expect(library.filter((c) => c.disabled)).toHaveLength(1);
    const ticked = pickerChips(
      setNotPosted(toggleChip(empty(), "x", false), true),
      null,
      true,
    );
    expect(ticked.every((c) => c.disabled && !c.pressed)).toBe(true);
    const unticked = pickerChips(
      setNotPosted(setNotPosted(empty(), true), false),
      null,
      true,
    );
    expect(unticked.every((c) => !c.disabled && !c.pressed)).toBe(true);
  });

  it("lists Demo last, only while mock is enabled", () => {
    expect(pickerChips(empty(), null, true).map((c) => c.label)).toEqual([
      "Instagram",
      "TikTok",
      "YouTube",
      "Facebook",
      "X",
      "Snapchat",
      "Other",
      "Demo",
    ]);
    expect(pickerChips(empty(), null, false).map((c) => c.label)).not.toContain(
      "Demo",
    );
  });

  it("at POSTINGS_MAX (the source counts) adds nothing: Add another link, an off chip, a Move needing a new field", () => {
    let state = pickerState([SOURCE_POSTING], false);
    for (let i = 1; i < POSTINGS_MAX; i += 1)
      state = addRow(state, "facebook", true).state;
    expect(atLimit(state, true)).toBe(true);
    expect(addRow(state, "facebook", true)).toEqual({ state, key: null });
    expect(toggleChip(state, "x", true)).toBe(state);
    const chips = pickerChips(state, "mock", true);
    expect(chips.find((c) => c.value === "x")?.disabled).toBe(true);
    expect(chips.find((c) => c.value === "facebook")).toMatchObject({
      pressed: true,
      disabled: false,
    });
    const key = state.rows[0].key;
    const wrong = setLink(state, key, REEL, opts);
    expect(moveTarget(wrong, key, true, opts)).toBeNull();
    expect(atLimit(removeRow(state, key), true)).toBe(false);
  });
});

describe("links: errors, Move and the Switch", () => {
  it("shows a link's error only after a blur or Continue, and hides it again while typing", () => {
    let state = toggleChip(empty(), "tiktok", false);
    const key = state.rows[0].key;
    state = setLink(state, key, "https://vm.tiktok.com/ZMabc123/", opts);
    expect(state.rows[0].linkErrorShown).toBe(false);
    state = showLinkError(state, key);
    expect(state.rows[0].linkErrorShown).toBe(true);
    state = setLink(state, key, "https://vm.tiktok.com/ZMabc1234/", opts);
    expect(state.rows[0].linkErrorShown).toBe(false);
    expect(revealErrors(state).rows[0]).toMatchObject({
      linkErrorShown: true,
      nameErrorShown: true,
    });
  });

  it("Move puts a wrong-platform link in that platform's empty field, or a new one, and clears where it came from", () => {
    let state = toggleChip(empty(), "tiktok", false);
    const tiktok = state.rows[0].key;
    state = setLink(state, tiktok, REEL, opts);
    const moved = moveLink(state, tiktok, false, opts);
    expect(moved.key).not.toBeNull();
    const rows = moved.state.rows;
    expect(rows.find((r) => r.key === tiktok)).toMatchObject({
      platform: "tiktok",
      link: "",
    });
    expect(rows.find((r) => r.key === moved.key)).toMatchObject({
      platform: "instagram",
      link: REEL,
      linkErrorShown: true,
    });

    let withEmpty = toggleChip(
      toggleChip(empty(), "tiktok", false),
      "instagram",
      false,
    );
    const from = withEmpty.rows[0].key;
    const into = withEmpty.rows[1].key;
    withEmpty = setLink(withEmpty, from, REEL, opts);
    expect(moveTarget(withEmpty, from, false, opts)).toEqual({
      platform: "instagram",
      into,
    });
    const filled = moveLink(withEmpty, from, false, opts);
    expect(filled.key).toBe(into);
    expect(filled.state.rows).toHaveLength(2);
  });

  it("Move has nothing to do for a link that isn't another platform's", () => {
    let state = toggleChip(empty(), "tiktok", false);
    const key = state.rows[0].key;
    state = setLink(state, key, "https://vm.tiktok.com/ZMabc123/", opts);
    expect(moveTarget(state, key, false, opts)).toBeNull();
    expect(moveLink(state, key, false, opts)).toEqual({ state, key: null });
  });

  it("Continue is blocked by a link that doesn't parse, an Other without its name, or an upload with nothing chosen", () => {
    expect(continueProblems(empty(), false, opts)).toEqual({
      fields: false,
      nothingChosen: true,
    });
    expect(continueProblems(empty(), true, opts).nothingChosen).toBe(false);
    expect(
      continueProblems(setNotPosted(empty(), true), false, opts).nothingChosen,
    ).toBe(false);
    const other = toggleChip(empty(), "other", false);
    expect(continueProblems(other, false, opts).fields).toBe(true);
    const short = setLink(
      toggleChip(empty(), "tiktok", false),
      "new-0",
      "https://vm.tiktok.com/ZMabc123/",
      opts,
    );
    expect(continueProblems(short, false, opts).fields).toBe(true);
    const fine = setLink(
      toggleChip(empty(), "facebook", false),
      "new-0",
      "https://www.facebook.com/reel/1234567890123",
      opts,
    );
    expect(continueProblems(fine, false, opts)).toEqual({
      fields: false,
      nothingChosen: false,
    });
  });

  it("keeps a saved result only while the link is the saved one (a tracking-param paste still is)", () => {
    const saved = savedPosting({
      id: "r",
      platform: "instagram",
      label: "Instagram",
      url: REEL_URL,
    });
    let state = pickerState([saved], false);
    expect(matchingSaved(state.rows[0], saved, opts)).toBe(saved);
    state = setLink(state, "r", `${REEL}?igsh=abc123`, opts);
    expect(matchingSaved(state.rows[0], saved, opts)).toBe(saved);
    state = setLink(
      state,
      "r",
      "https://www.instagram.com/reel/ZZZZZZZZZZZ/",
      opts,
    );
    expect(matchingSaved(state.rows[0], saved, opts)).toBeNull();
    const noLink = savedPosting({
      id: "n",
      platform: "facebook",
      label: "Facebook",
      url: null,
    });
    expect(
      matchingSaved(pickerState([noLink], false).rows[0], noLink, opts),
    ).toBe(noLink);
  });

  it("shows the Switch from the creator's choice, else the saved value for the saved link, else on", () => {
    const unlisted = savedPosting({
      id: "u",
      visibility: "unlisted",
      showLink: false,
    });
    const state = pickerState([unlisted], false);
    const row = state.rows[0];
    expect(shownSwitch(row, unlisted)).toBe(false);
    expect(shownSwitch(row, null)).toBe(true);
    expect(shownSwitch(setSwitch(state, "u", true).rows[0], unlisted)).toBe(
      true,
    );
  });

  it("posts showLink only once the creator turns the Switch, never a saved value (07 D18; owner answer Q-86 a)", () => {
    // Saved off or on, the row posts nothing until turned: the server keeps a saved hidden link hidden.
    for (const showLink of [false, true]) {
      const saved = savedPosting({ id: "s", showLink });
      const state = pickerState([saved], false);
      expect(showLinkValue(state.rows[0])).toBeUndefined();
      expect(shownSwitch(state.rows[0], saved)).toBe(showLink);
      expect(showLinkValue(setSwitch(state, "s", !showLink).rows[0])).toBe(
        !showLink,
      );
    }
    let fresh = toggleChip(empty(), "youtube", false);
    fresh = setLink(
      fresh,
      "new-0",
      "https://www.youtube.com/shorts/abcdefghijk",
      opts,
    );
    expect(showLinkValue(fresh.rows[0])).toBeUndefined();
    expect(showLinkValue(setSwitch(fresh, "new-0", false).rows[0])).toBe(false);
    expect(showLinkValue(setSwitch(fresh, "new-0", true).rows[0])).toBe(true);
  });

  it("starts a turned Switch over when the link becomes another post (or none), and keeps it for the same post", () => {
    const off = savedPosting({
      id: "r",
      platform: "instagram",
      label: "Instagram",
      url: REEL_URL,
      showLink: false,
    });
    const turned = setSwitch(pickerState([off], false), "r", true);
    // A tracking-param paste of the same reel is still the same post.
    expect(
      showLinkValue(setLink(turned, "r", `${REEL}?igsh=abc123`, opts).rows[0]),
    ).toBe(true);
    // Another post, an empty field or a link that doesn't parse: nothing posted.
    for (const link of [
      "https://www.instagram.com/reel/ZZZZZZZZZZZ/",
      "",
      "not a link",
    ]) {
      const row = setLink(turned, "r", link, opts).rows[0];
      expect(row.switchOn).toBeNull();
      expect(showLinkValue(row)).toBeUndefined();
    }
  });
});

describe("errorsFromResult", () => {
  const submitted = ["k0", "k1", "k2"];

  it("maps each field error to the row posted at that index, the chips and the tick", () => {
    const errors = errorsFromResult(
      {
        ok: false,
        error: {
          code: "invalid_link",
          message: "first",
          fields: {
            "postings.2.link": ["That's a short link."],
            "postings.0.otherLabel": ["Add the name of the site."],
            platforms: ["Say where it was posted"],
          },
        },
      },
      submitted,
    );
    expect(errors).toEqual({
      rows: {
        k2: { link: "That's a short link." },
        k0: { otherLabel: "Add the name of the site." },
      },
      platforms: "Say where it was posted",
      form: null,
      sameVideo: false,
    });
    expect(clearRowError(errors, "k2", "link").rows.k2).toEqual({});
    expect(clearRowError(errors, "k1", "link")).toBe(errors);
  });

  it("puts a refusal without fields, or with none the form has, above the cards", () => {
    const banner = {
      ok: false as const,
      error: { code: "too_many", message: "You can add up to 12 places." },
    };
    expect(errorsFromResult(banner, submitted).form).toBe(
      "You can add up to 12 places.",
    );
    const stray = {
      ok: false as const,
      error: {
        code: "x",
        message: "lost",
        fields: { "postings.9.link": ["lost"] },
      },
    };
    expect(errorsFromResult(stray, submitted).form).toBe("lost");
  });

  it("reads a staying Continue's missing tick, and nothing before a first answer", () => {
    expect(
      errorsFromResult({ ok: true, data: { sameVideoMissing: true } }, []),
    ).toEqual({
      ...NO_ERRORS,
      sameVideo: true,
    });
    expect(errorsFromResult(null, [])).toBe(NO_ERRORS);
  });
});

describe("accounts and results", () => {
  const accounts = postingAccounts(
    ["mock"],
    [
      { id: "a1", platform: "mock", status: "connected" },
      { id: "a2", platform: "mock", status: "needs_reconnect" },
      { id: "t1", platform: "tiktok", status: "needs_reconnect" },
    ],
  );

  it("keeps per provider only whether it is enabled, its connected ids and whether all need a reconnect", () => {
    expect(accounts.mock).toEqual({
      providerEnabled: true,
      connectedIds: ["a1"],
      onlyNeedsReconnect: false,
    });
    expect(accounts.tiktok).toEqual({
      providerEnabled: false,
      connectedIds: [],
      onlyNeedsReconnect: true,
    });
    expect(accounts.instagram).toEqual({
      providerEnabled: false,
      connectedIds: [],
      onlyNeedsReconnect: false,
    });
    expect(resultContext(accounts, "facebook", "ClipLease")).toEqual({
      appName: "ClipLease",
      providerEnabled: false,
      hasConnectedAccount: false,
      onlyNeedsReconnect: false,
    });
    expect(
      resultContext(accounts, "mock", "ClipLease").hasConnectedAccount,
    ).toBe(true);
  });

  it("words a sync that couldn't run in 04 §11.8's lines, and says nothing for the rest", () => {
    expect(
      syncFailureLine({ reason: "rate_limited", retryAfterSec: 840 }, "Demo"),
    ).toBe("Demo asked us to slow down. Try again in 14 min.");
    expect(syncFailureLine({ reason: "upstream_error" }, "Demo")).toBe(
      "Couldn't reach Demo. Your saved posts are still here.",
    );
    expect(syncFailureLine({ reason: "already_syncing" }, "Demo")).toBeNull();
    expect(syncFailureLine({ reason: "needs_reconnect" }, "Demo")).toBeNull();
  });

  it("announces each saved link's result once, the source left out", () => {
    expect(
      resultsAnnouncement([
        SOURCE_POSTING,
        savedPosting({ id: "v" }),
        savedPosting({
          id: "i",
          platform: "instagram",
          label: "Instagram",
          verification: "unverified",
          unverifiedReason: "no_account",
        }),
        savedPosting({
          id: "f",
          platform: "facebook",
          label: "Facebook",
          url: null,
          verification: "unverified",
          unverifiedReason: "no_link",
        }),
      ]),
    ).toBe("Demo link verified. Instagram link not verified");
  });

  it("checks again on return only that platform's no_account and check_failed links (Q-74 a)", () => {
    const noAccount = savedPosting({
      id: "1",
      verification: "unverified",
      unverifiedReason: "no_account",
    });
    const failed = savedPosting({
      id: "2",
      verification: "unverified",
      unverifiedReason: "check_failed",
    });
    const notFound = savedPosting({
      id: "3",
      verification: "unverified",
      unverifiedReason: "not_found",
    });
    const other = savedPosting({
      id: "4",
      platform: "tiktok",
      label: "TikTok",
      verification: "unverified",
      unverifiedReason: "no_account",
    });
    const all = [SOURCE_POSTING, noAccount, failed, notFound, other];
    expect(recheckOnReturn(all, "mock").map((p) => p.id)).toEqual(["1", "2"]);
    expect(recheckOnReturn(all, null)).toEqual([]);
  });
});

describe("sameVideoView", () => {
  it("is null while nothing is verified", () => {
    expect(
      sameVideoView(
        [
          savedPosting({
            verification: "unverified",
            unverifiedReason: "not_found",
          }),
        ],
        14_000,
      ),
    ).toBeNull();
  });

  it("lists the verified posts in position order and warns per post more than 1 s off; one post is “the post”", () => {
    const one = sameVideoView([savedPosting({ id: "v2" })], 14_000);
    expect(one?.several).toBe(false);
    expect(one?.warnings).toEqual([
      {
        id: "v2",
        text: "This file is 0:14 but the post is 0:38. Make sure it's the same video.",
      },
    ]);
    const two = sameVideoView(
      [savedPosting({ id: "v2" }), SOURCE_POSTING],
      14_000,
    );
    expect(two?.several).toBe(true);
    expect(two?.verified.map((p) => p.id)).toEqual([SOURCE_POSTING.id, "v2"]);
    expect(sameVideoView([savedPosting({})], null)?.warnings).toEqual([]);
  });

  it("names the platform when several are on different platforms (Q-76 a)", () => {
    const tiktok = savedPosting({
      id: "t",
      platform: "tiktok",
      label: "TikTok",
      verifiedUsername: "@maya.films",
    });
    const view = sameVideoView([SOURCE_POSTING, tiktok], 14_000);
    expect(view?.warnings).toEqual([
      {
        id: "t",
        text: "This file is 0:14 but the TikTok post is 0:38. Make sure it's the same video.",
      },
    ]);
  });

  it("names the account when another verified post shares the platform (Q-85 a); the platform alone without a name", () => {
    const tiktok = (id: string, verifiedUsername: string | null) =>
      savedPosting({
        id,
        platform: "tiktok",
        label: "TikTok",
        verifiedUsername,
        position: id === "t1" ? 1 : 2,
      });
    const youtube = savedPosting({
      id: "y",
      platform: "youtube",
      label: "YouTube",
      verifiedUsername: "Maya Films",
      position: 3,
    });
    const view = sameVideoView(
      [tiktok("t1", "@maya.films"), tiktok("t2", null), youtube],
      14_000,
    );
    expect(view?.warnings.map((w) => [w.id, w.text])).toEqual([
      [
        "t1",
        "This file is 0:14 but the TikTok post on @maya.films is 0:38. Make sure it's the same video.",
      ],
      [
        "t2",
        "This file is 0:14 but the TikTok post is 0:38. Make sure it's the same video.",
      ],
      [
        "y",
        "This file is 0:14 but the YouTube post is 0:38. Make sure it's the same video.",
      ],
    ]);
  });
});
