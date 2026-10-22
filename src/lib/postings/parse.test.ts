import { describe, expect, it } from "vitest";
import type { PostingLinkError, PostingPlatform } from "../domain/values";
import { POSTING_URL_MAX } from "./limits";
import {
  detectPostingPlatform,
  type ParsedPostingLink,
  type ParsePostingLinkResult,
  parsePostingLink,
} from "./parse";

const OFF = { allowMock: false };
const ON = { allowMock: true };

function link(
  platform: PostingPlatform,
  linkKey: string | null,
  url: string,
  kind: ParsedPostingLink["kind"],
): ParsePostingLinkResult {
  return { ok: true, link: { platform, linkKey, url, kind } };
}

function refused(error: PostingLinkError): ParsePostingLinkResult {
  return { ok: false, error };
}

function wrong(detected: PostingPlatform): ParsePostingLinkResult {
  return { ok: false, error: "wrong_platform", detected };
}

const IG_CODE = "C9xYz12AbCd";
const IG_REEL = link(
  "instagram",
  IG_CODE,
  `https://www.instagram.com/reel/${IG_CODE}/`,
  "reel",
);
const IG_POST = link(
  "instagram",
  IG_CODE,
  `https://www.instagram.com/p/${IG_CODE}/`,
  "post",
);
const SCOUT = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
const MAYA_TIKTOK_ID = "7106594312292453675";
const MAYA_TIKTOK = link(
  "tiktok",
  MAYA_TIKTOK_ID,
  `https://www.tiktok.com/@maya.films/video/${MAYA_TIKTOK_ID}`,
  "video",
);
const YT_ID = "dQw4w9WgXcQ";
const YT_WATCH = link(
  "youtube",
  YT_ID,
  `https://www.youtube.com/watch?v=${YT_ID}`,
  "watch",
);
const FB_ID = "1234567890123";
const FB_VIDEO = link(
  "facebook",
  FB_ID,
  `https://www.facebook.com/watch/?v=${FB_ID}`,
  "video",
);
const X_ID = "1790000000000000001";
const X_STATUS = link("x", X_ID, `https://x.com/i/status/${X_ID}`, "status");
const SNAP_ID = "W7_EDlXWTBiXAEEniNoMPwAAYYWx";
const SNAP = link(
  "snapchat",
  SNAP_ID,
  `https://www.snapchat.com/spotlight/${SNAP_ID}`,
  "spotlight",
);
const MOCK_LINK = "https://example.com/mock/mock_post_c4180ab2_01";
/** 2,048 chars: the longest link accepted. */
const LONG_OTHER = `https://example.org/${"a".repeat(2028)}`;
/** 2,049 chars. */
const TOO_LONG_REEL = `https://www.instagram.com/reel/${"A".repeat(2018)}`;
/** 2,048 chars pasted, 2,056 once https:// is added. */
const LONG_SCHEMELESS = `example.org/${"a".repeat(2036)}`;
/** 2,048 chars pasted, 2,052 once rebuilt on www.facebook.com. */
const TOO_LONG_PFBID = `https://facebook.com/a/posts/pfbid${"A".repeat(2014)}`;
/** 2,048 chars, already canonical: the longest Facebook post link accepted. */
const LONGEST_PFBID = `https://www.facebook.com/a/posts/pfbid${"A".repeat(2010)}`;
const PLAYLIST = "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG";
const EVIL = "https%3A%2F%2Fevil.com";

type Golden = [
  chip: PostingPlatform,
  input: string,
  opts: { allowMock: boolean },
  expected: ParsePostingLinkResult,
];

/**
 * 07 D73: every row of research §1.1 (each accepted host, path, short link and profile form), the tracking parameters
 * dropped, the SSRF negatives, the Other and mock rules, and the stricter step 3 (any "@" in the authority, any ":" after
 * the host).
 */
const GOLDENS: Golden[] = [
  // Steps 1–3, on the Instagram chip.
  ["instagram", "   ", OFF, refused("empty")],
  ["instagram", "", OFF, refused("empty")],
  ["instagram", TOO_LONG_REEL, OFF, refused("too_long")],
  ["instagram", "javascript:alert(1)", OFF, refused("not_a_url")],
  ["instagram", "ftp://instagram.com/reel/ABCDE/", OFF, refused("not_a_url")],
  ["instagram", "mailto:maya@instagram.com", OFF, refused("not_a_url")],
  ["instagram", "data:text/html,<b>x</b>", OFF, refused("not_a_url")],
  ["instagram", "just some words", OFF, refused("not_a_url")],
  ["instagram", "https://", OFF, refused("not_a_url")],
  ["instagram", "https://instagram.com@evil.com/", OFF, refused("bad_host")],
  ["instagram", "https://@instagram.com/reel/ABCDE/", OFF, refused("bad_host")],
  [
    "instagram",
    "https://maya:pw@www.instagram.com/reel/ABCDE/",
    OFF,
    refused("bad_host"),
  ],
  [
    "instagram",
    "https://instagram.com:444/reel/ABCDE/",
    OFF,
    refused("bad_host"),
  ],
  [
    "instagram",
    "https://instagram.com:443/reel/ABCDE/",
    OFF,
    refused("bad_host"),
  ],
  ["instagram", "https://instagram.com:/reel/ABCDE/", OFF, refused("bad_host")],
  ["instagram", "instagram.com:443/reel/ABCDE/", OFF, refused("bad_host")],
  // Step 5: exact hosts only.
  ["instagram", `https://l.instagram.com/?u=${EVIL}`, OFF, refused("bad_host")],
  ["instagram", "http://192.168.0.1/", OFF, refused("bad_host")],
  ["instagram", "https://\u0456nstagram.com/reel/x", OFF, refused("bad_host")],
  ["instagram", "https://evil.com/reel/ABCDE/", OFF, refused("bad_host")],
  [
    "instagram",
    "https://www.instagram.com../reel/ABCDE/",
    OFF,
    refused("bad_host"),
  ],
  [
    "instagram",
    "https://instagram.com.evil.com/reel/ABCDE/",
    OFF,
    refused("bad_host"),
  ],

  // Instagram: the shortcode kept, the username and every parameter dropped.
  [
    "instagram",
    `https://www.instagram.com/reel/${IG_CODE}/?igsh=MWZ4dGx0`,
    OFF,
    IG_REEL,
  ],
  ["instagram", `instagram.com/p/${IG_CODE}`, OFF, IG_POST],
  [
    "instagram",
    `https://m.instagram.com/reels/${IG_CODE}/?utm_source=ig_web_copy_link`,
    OFF,
    IG_REEL,
  ],
  ["instagram", `https://instagr.am/tv/${IG_CODE}/`, OFF, IG_POST],
  [
    "instagram",
    `https://www.instagr.am/p/${IG_CODE}/?igshid=MzRlODBiNWFlZA==`,
    OFF,
    IG_POST,
  ],
  [
    "instagram",
    `https://www.instagram.com/maya.films/reel/${IG_CODE}/`,
    OFF,
    IG_REEL,
  ],
  [
    "instagram",
    `https://www.instagram.com/maya.films/p/${IG_CODE}/?img_index=1`,
    OFF,
    IG_POST,
  ],
  [
    "instagram",
    "https://instagram.com./reel/ABCDE/",
    OFF,
    link("instagram", "ABCDE", "https://www.instagram.com/reel/ABCDE/", "reel"),
  ],
  [
    "instagram",
    `HTTPS://WWW.INSTAGRAM.COM/reel/${IG_CODE}/#comments`,
    OFF,
    IG_REEL,
  ],
  [
    "instagram",
    "https://www.instagram.com/share/reel/BAabc123/",
    OFF,
    refused("short_link"),
  ],
  [
    "instagram",
    "https://www.instagram.com/maya.films/",
    OFF,
    refused("profile_link"),
  ],
  [
    "instagram",
    "https://www.instagram.com/reel/AB/",
    OFF,
    refused("unrecognized"),
  ],
  [
    "instagram",
    "https://www.instagram.com/reel/",
    OFF,
    refused("unrecognized"),
  ],
  [
    "instagram",
    `https://www.instagram.com/reel/${IG_CODE}/embed/`,
    OFF,
    refused("unrecognized"),
  ],
  ["instagram", "https://www.instagram.com/", OFF, refused("unrecognized")],
  ["instagram", SCOUT, OFF, wrong("tiktok")],
  ["instagram", MOCK_LINK, ON, wrong("mock")],
  ["instagram", MOCK_LINK, OFF, refused("bad_host")],

  // TikTok: the id kept as the exact string, rebuilt on www.
  ["tiktok", SCOUT, OFF, link("tiktok", "6718335390845095173", SCOUT, "video")],
  [
    "tiktok",
    `https://www.tiktok.com/@maya.films/video/${MAYA_TIKTOK_ID}?is_from_webapp=1&sender_device=pc`,
    OFF,
    MAYA_TIKTOK,
  ],
  [
    "tiktok",
    `Check out maya's video! #tiktok https://m.tiktok.com/@maya.films/video/${MAYA_TIKTOK_ID}?_r=1`,
    OFF,
    MAYA_TIKTOK,
  ],
  [
    "tiktok",
    `tiktok.com/@maya.films/video/${MAYA_TIKTOK_ID}`,
    OFF,
    MAYA_TIKTOK,
  ],
  ["tiktok", "https://vm.tiktok.com/ZMabc123/", OFF, refused("short_link")],
  ["tiktok", "https://vt.tiktok.com/ZSabc123/", OFF, refused("short_link")],
  ["tiktok", "https://www.tiktok.com/t/ZTabc123/", OFF, refused("short_link")],
  [
    "tiktok",
    `https://m.tiktok.com/v/${MAYA_TIKTOK_ID}.html`,
    OFF,
    refused("short_link"),
  ],
  [
    "tiktok",
    "https://www.tiktok.com/@maya.films",
    OFF,
    refused("profile_link"),
  ],
  [
    "tiktok",
    `https://www.tiktok.com/@maya.films/photo/${MAYA_TIKTOK_ID}`,
    OFF,
    refused("not_a_video"),
  ],
  [
    "tiktok",
    `https://www.tiktok.com/@maya-films/video/${MAYA_TIKTOK_ID}`,
    OFF,
    refused("unrecognized"),
  ],
  [
    "tiktok",
    "https://www.tiktok.com/@maya.films/video/12345",
    OFF,
    refused("unrecognized"),
  ],
  // A leading zero would be a second link key for the same post.
  [
    "tiktok",
    "https://www.tiktok.com/@scout2015/video/06718335390845095173",
    OFF,
    refused("unrecognized"),
  ],
  ["tiktok", "https://www.instagram.com/reel/ABCDE/", OFF, wrong("instagram")],

  // YouTube: /shorts/ stays a short, every other form becomes /watch?v=; t, si, feature and utm_* dropped.
  [
    "youtube",
    `https://www.youtube.com/watch?v=${YT_ID}&t=42s&feature=share`,
    OFF,
    YT_WATCH,
  ],
  ["youtube", `https://youtu.be/${YT_ID}?si=Ab12`, OFF, YT_WATCH],
  [
    "youtube",
    `https://youtube.com/shorts/${YT_ID}?feature=share`,
    OFF,
    link("youtube", YT_ID, `https://www.youtube.com/shorts/${YT_ID}`, "short"),
  ],
  ["youtube", `https://www.youtube.com/live/${YT_ID}?si=x`, OFF, YT_WATCH],
  ["youtube", `https://www.youtube-nocookie.com/embed/${YT_ID}`, OFF, YT_WATCH],
  [
    "youtube",
    `https://youtube-nocookie.com/embed/${YT_ID}?rel=0`,
    OFF,
    YT_WATCH,
  ],
  [
    "youtube",
    `https://music.youtube.com/watch?v=${YT_ID}&utm_source=x`,
    OFF,
    YT_WATCH,
  ],
  [
    "youtube",
    `https://m.youtube.com/watch?feature=share&v=${YT_ID}`,
    OFF,
    YT_WATCH,
  ],
  ["youtube", `https://www.youtube.com/embed/${YT_ID}`, OFF, YT_WATCH],
  ["youtube", `https://www.youtube.com/v/${YT_ID}`, OFF, YT_WATCH],
  [
    "youtube",
    "https://www.youtube.com/@mayafilms",
    OFF,
    refused("profile_link"),
  ],
  [
    "youtube",
    "https://www.youtube.com/channel/UC1234567890abcdefghij",
    OFF,
    refused("profile_link"),
  ],
  [
    "youtube",
    "https://www.youtube.com/c/MayaFilms",
    OFF,
    refused("profile_link"),
  ],
  [
    "youtube",
    "https://www.youtube.com/user/mayafilms",
    OFF,
    refused("profile_link"),
  ],
  [
    "youtube",
    `https://www.youtube.com/redirect?q=${EVIL}`,
    OFF,
    refused("unrecognized"),
  ],
  [
    "youtube",
    "https://www.youtube.com/watch?v=short",
    OFF,
    refused("unrecognized"),
  ],
  // A playlist embed and a channel's live embed: 11-character words, not video ids. A video embedded with a list is one.
  [
    "youtube",
    `https://www.youtube.com/embed/videoseries?list=${PLAYLIST}`,
    OFF,
    refused("unrecognized"),
  ],
  [
    "youtube",
    `https://www.youtube-nocookie.com/embed/videoseries?list=${PLAYLIST}`,
    OFF,
    refused("unrecognized"),
  ],
  [
    "youtube",
    "https://www.youtube.com/embed/live_stream?channel=UC1234567890abcdefghij",
    OFF,
    refused("unrecognized"),
  ],
  [
    "youtube",
    `https://www.youtube.com/embed/${YT_ID}?list=${PLAYLIST}`,
    OFF,
    YT_WATCH,
  ],
  [
    "youtube",
    `https://studio.youtube.com/video/${YT_ID}/edit`,
    OFF,
    refused("bad_host"),
  ],

  // Facebook: videos become /watch/?v=, reels /reel/, posts /{page}/posts/ keyed "{page}/{postId}" with the case kept.
  ["facebook", `https://www.facebook.com/video.php?v=${FB_ID}`, OFF, FB_VIDEO],
  ["facebook", `https://www.facebook.com/watch?v=${FB_ID}`, OFF, FB_VIDEO],
  [
    "facebook",
    `https://www.facebook.com/watch/?v=${FB_ID}&ref=sharing`,
    OFF,
    FB_VIDEO,
  ],
  [
    "facebook",
    `https://m.facebook.com/mayafilms/videos/snow-day/${FB_ID}/`,
    OFF,
    FB_VIDEO,
  ],
  [
    "facebook",
    `https://web.facebook.com/mayafilms/videos/${FB_ID}/`,
    OFF,
    FB_VIDEO,
  ],
  [
    "facebook",
    `https://www.facebook.com/reel/${FB_ID}?mibextid=abc`,
    OFF,
    link("facebook", FB_ID, `https://www.facebook.com/reel/${FB_ID}`, "reel"),
  ],
  [
    "facebook",
    `facebook.com/reel/${FB_ID}`,
    OFF,
    link("facebook", FB_ID, `https://www.facebook.com/reel/${FB_ID}`, "reel"),
  ],
  [
    "facebook",
    "https://www.facebook.com/mayafilms/posts/pfbid02AbCdEfGh12345",
    OFF,
    link(
      "facebook",
      "mayafilms/pfbid02AbCdEfGh12345",
      "https://www.facebook.com/mayafilms/posts/pfbid02AbCdEfGh12345",
      "post",
    ),
  ],
  [
    "facebook",
    "https://mbasic.facebook.com/Maya.Films/posts/1234567890",
    OFF,
    link(
      "facebook",
      "Maya.Films/1234567890",
      "https://www.facebook.com/Maya.Films/posts/1234567890",
      "post",
    ),
  ],
  ["facebook", "https://fb.watch/abc123/", OFF, refused("short_link")],
  [
    "facebook",
    "https://www.facebook.com/share/v/abc123/",
    OFF,
    refused("short_link"),
  ],
  [
    "facebook",
    "https://www.facebook.com/share/r/abc123/",
    OFF,
    refused("short_link"),
  ],
  [
    "facebook",
    "https://www.facebook.com/share/p/abc123/",
    OFF,
    refused("short_link"),
  ],
  [
    "facebook",
    `https://l.facebook.com/l.php?u=${EVIL}`,
    OFF,
    refused("bad_host"),
  ],
  [
    "facebook",
    "https://www.facebook.com/mayafilms",
    OFF,
    refused("profile_link"),
  ],
  [
    "facebook",
    `https://www.facebook.com/Maya-Films/videos/${FB_ID}/`,
    OFF,
    refused("unrecognized"),
  ],
  [
    "facebook",
    "https://www.facebook.com/watch/?v=abc",
    OFF,
    refused("unrecognized"),
  ],
  [
    "facebook",
    "https://www.facebook.com/permalink.php?story_fbid=12345&id=67890",
    OFF,
    refused("unrecognized"),
  ],
  // No leading zero in a numeric video, reel or post id.
  [
    "facebook",
    `https://www.facebook.com/watch/?v=0${FB_ID}`,
    OFF,
    refused("unrecognized"),
  ],
  [
    "facebook",
    `https://www.facebook.com/mayafilms/videos/0${FB_ID}/`,
    OFF,
    refused("unrecognized"),
  ],
  [
    "facebook",
    `https://www.facebook.com/reel/0${FB_ID}`,
    OFF,
    refused("unrecognized"),
  ],
  [
    "facebook",
    "https://www.facebook.com/Maya.Films/posts/01234567890",
    OFF,
    refused("unrecognized"),
  ],
  // The rebuilt url is capped too: www. can push a pasted 2,048 over.
  ["facebook", TOO_LONG_PFBID, OFF, refused("too_long")],
  [
    "facebook",
    LONGEST_PFBID,
    OFF,
    link("facebook", `a/pfbid${"A".repeat(2010)}`, LONGEST_PFBID, "post"),
  ],

  // X: every form becomes /i/status/{id}, the username dropped.
  ["x", `https://twitter.com/mayafilms/status/${X_ID}/video/1`, OFF, X_STATUS],
  ["x", `https://x.com/i/web/status/${X_ID}?s=20`, OFF, X_STATUS],
  ["x", `https://x.com/i/status/${X_ID}`, OFF, X_STATUS],
  ["x", `https://www.x.com/mayafilms/status/${X_ID}/photo/1`, OFF, X_STATUS],
  ["x", `https://mobile.x.com/mayafilms/status/${X_ID}?t=abc`, OFF, X_STATUS],
  ["x", `https://www.twitter.com/mayafilms/status/${X_ID}`, OFF, X_STATUS],
  ["x", `https://mobile.twitter.com/mayafilms/status/${X_ID}`, OFF, X_STATUS],
  ["x", "https://t.co/x", OFF, refused("short_link")],
  ["x", "https://x.com/mayafilms", OFF, refused("profile_link")],
  ["x", `https://m.x.com/mayafilms/status/${X_ID}`, OFF, refused("bad_host")],
  [
    "x",
    `https://x.com/mayafilms/status/${X_ID}/analytics`,
    OFF,
    refused("unrecognized"),
  ],
  ["x", `https://x.com/i/status/0${X_ID}`, OFF, refused("unrecognized")],
  [
    "x",
    `https://twitter.com/mayafilms/status/0${X_ID}`,
    OFF,
    refused("unrecognized"),
  ],

  // Snapchat: every spotlight form becomes /spotlight/{id}.
  [
    "snapchat",
    `https://www.snapchat.com/@maya.films/spotlight/${SNAP_ID}`,
    OFF,
    SNAP,
  ],
  [
    "snapchat",
    `https://snapchat.com/spotlight/${SNAP_ID}?share_id=abc`,
    OFF,
    SNAP,
  ],
  [
    "snapchat",
    `https://www.snapchat.com/add/maya.films/spotlight/${SNAP_ID}`,
    OFF,
    SNAP,
  ],
  ["snapchat", "https://t.snapchat.com/abc123", OFF, refused("short_link")],
  ["snapchat", "https://www.snapchat.com/t/abc123", OFF, refused("short_link")],
  [
    "snapchat",
    "https://www.snapchat.com/@maya.films",
    OFF,
    refused("profile_link"),
  ],
  [
    "snapchat",
    "https://www.snapchat.com/add/maya.films",
    OFF,
    refused("profile_link"),
  ],
  [
    "snapchat",
    "https://story.snapchat.com/s/maya.films",
    OFF,
    refused("bad_host"),
  ],
  [
    "snapchat",
    "https://www.snapchat.com/spotlight/short",
    OFF,
    refused("unrecognized"),
  ],

  // Other: any public host but a platform's, https, the fragment dropped and the query kept.
  [
    "other",
    "https://vimeo.com/123456789#t=10s",
    OFF,
    link("other", null, "https://vimeo.com/123456789", "other"),
  ],
  [
    "other",
    "http://www.example.org/watch?id=5",
    OFF,
    link("other", null, "https://www.example.org/watch?id=5", "other"),
  ],
  ["other", LONG_OTHER, OFF, link("other", null, LONG_OTHER, "other")],
  ["other", LONG_SCHEMELESS, OFF, refused("too_long")],
  [
    "other",
    "vimeo.com./123456789",
    OFF,
    link("other", null, "https://vimeo.com/123456789", "other"),
  ],
  [
    "other",
    "https://fb.me/abc123",
    OFF,
    link("other", null, "https://fb.me/abc123", "other"),
  ],
  ["other", MOCK_LINK, OFF, link("other", null, MOCK_LINK, "other")],
  ["other", MOCK_LINK, ON, wrong("mock")],
  ["other", "https://www.instagram.com/reel/ABCDE/", OFF, wrong("instagram")],
  ["other", SCOUT, OFF, wrong("tiktok")],
  ["other", "https://t.co/x", OFF, wrong("x")],
  ["other", "https://fb.watch/abc123/", OFF, wrong("facebook")],
  ["other", "https://www.fb.watch/abc123/", OFF, refused("bad_host")],
  ["other", "https://m.t.co/x", OFF, refused("bad_host")],
  ["other", `https://l.instagram.com/?u=${EVIL}`, OFF, refused("bad_host")],
  ["other", `https://l.facebook.com/l.php?u=${EVIL}`, OFF, refused("bad_host")],
  ["other", "http://192.168.0.1/", OFF, refused("bad_host")],
  ["other", "http://3232235521/", OFF, refused("bad_host")],
  ["other", "http://[::1]/", OFF, refused("bad_host")],
  ["other", "http://localhost/", OFF, refused("bad_host")],
  ["other", "https://app.localhost/", OFF, refused("bad_host")],
  ["other", "https://printer.local/", OFF, refused("bad_host")],
  ["other", "https://db.internal/", OFF, refused("bad_host")],
  ["other", "https://intranet/", OFF, refused("bad_host")],
  ["other", "https://vimeo.com@evil.com/", OFF, refused("bad_host")],
  ["other", "https://vimeo.com:8443/1", OFF, refused("bad_host")],
  // One trailing dot is removed; an empty label left over is refused, so a second dot can't dodge the checks above.
  [
    "other",
    "https://www.instagram.com../reel/ABCDE/",
    OFF,
    refused("bad_host"),
  ],
  ["other", "https://127.0.0.1../", OFF, refused("bad_host")],
  ["other", "https://127.0.0.1./", OFF, refused("bad_host")],
  [
    "other",
    "https://169.254.169.254../latest/meta-data/",
    OFF,
    refused("bad_host"),
  ],
  ["other", "https://localhost../", OFF, refused("bad_host")],
  ["other", "https://printer.local../", OFF, refused("bad_host")],
  ["other", "https://.vimeo.com/", OFF, refused("bad_host")],
  ["other", "https://a..b/", OFF, refused("bad_host")],
  ["other", "https://./", OFF, refused("bad_host")],

  // Demo (mock): only with allowMock, only P06's post ids.
  [
    "mock",
    MOCK_LINK,
    ON,
    link("mock", "mock_post_c4180ab2_01", MOCK_LINK, "video"),
  ],
  [
    "mock",
    "https://example.com/mock/mock_post_shared_07",
    ON,
    link(
      "mock",
      "mock_post_shared_07",
      "https://example.com/mock/mock_post_shared_07",
      "video",
    ),
  ],
  [
    "mock",
    "https://example.com/mock/mock_post_c4180ab2_2_03/?x=1",
    ON,
    link(
      "mock",
      "mock_post_c4180ab2_2_03",
      "https://example.com/mock/mock_post_c4180ab2_2_03",
      "video",
    ),
  ],
  ["mock", MOCK_LINK, OFF, refused("bad_host")],
  [
    "mock",
    "https://example.com/mock/mock_post_C4180AB2_01",
    ON,
    refused("unrecognized"),
  ],
  ["mock", "https://www.instagram.com/reel/ABCDE/", ON, wrong("instagram")],
  [
    "mock",
    "https://evil.com/mock/mock_post_c4180ab2_01",
    ON,
    refused("unrecognized"),
  ],
];

describe("parsePostingLink goldens (07 D67, D73)", () => {
  it("has a row for every case 07 D73 asks for", () => {
    expect(GOLDENS.length).toBeGreaterThanOrEqual(40);
  });

  it.each(GOLDENS)("%s chip · %s · %j", (chip, input, opts, expected) => {
    expect(parsePostingLink(chip, input, opts)).toStrictEqual(expected);
  });
});

describe("every accepted link", () => {
  const accepted = GOLDENS.flatMap(([chip, input, opts]) => {
    const result = parsePostingLink(chip, input, opts);
    return result.ok ? [[chip, input, opts, result.link] as const] : [];
  });

  it.each(accepted)(
    "%s chip · %s: a canonical https url",
    (chip, _input, opts, parsed) => {
      expect(
        typeof parsed.linkKey === "string" || parsed.linkKey === null,
      ).toBe(true);
      expect(parsed.url.startsWith("https://")).toBe(true);
      expect(parsed.url.length).toBeLessThanOrEqual(POSTING_URL_MAX);
      expect(parsed.url).not.toContain("#");
      if (chip !== "other") {
        const params = [...new URL(parsed.url).searchParams.keys()];
        expect(params.filter((name) => name !== "v")).toEqual([]);
      }
      // The canonical url reads back as the same link: the id round-trips unchanged.
      expect(parsePostingLink(chip, parsed.url, opts)).toStrictEqual({
        ok: true,
        link: parsed,
      });
    },
  );

  it("keeps TikTok ids as exact strings, which a Number would round", () => {
    for (const id of ["6718335390845095173", MAYA_TIKTOK_ID]) {
      const result = parsePostingLink(
        "tiktok",
        `https://www.tiktok.com/@maya.films/video/${id}`,
        OFF,
      );
      expect(result.ok && result.link.linkKey).toBe(id);
      expect(String(Number(id))).not.toBe(id);
    }
    expect(String(Number(MAYA_TIKTOK_ID))).toBe("7106594312292453000");
  });
});

describe("detectPostingPlatform", () => {
  it.each<[string, PostingPlatform | null]>([
    [`https://www.instagram.com/reel/${IG_CODE}/`, "instagram"],
    ["instagram.com./reel/ABCDE/", "instagram"],
    [SCOUT, "tiktok"],
    [
      `Check out maya's video! #tiktok https://m.tiktok.com/@maya.films/video/${MAYA_TIKTOK_ID}`,
      "tiktok",
    ],
    ["https://vm.tiktok.com/ZMabc123/", "tiktok"],
    [`https://youtu.be/${YT_ID}`, "youtube"],
    [`https://www.facebook.com/reel/${FB_ID}`, "facebook"],
    ["https://fb.watch/abc123/", "facebook"],
    [`https://twitter.com/mayafilms/status/${X_ID}`, "x"],
    ["https://t.co/x", "x"],
    [`https://www.snapchat.com/spotlight/${SNAP_ID}`, "snapchat"],
    ["https://t.snapchat.com/abc123", "snapchat"],
    [MOCK_LINK, "mock"],
    ["https://example.com/about", null],
    [`https://l.instagram.com/?u=${EVIL}`, null],
    ["https://evil.com/", null],
    ["https://vimeo.com/123456789", null],
    ["https://instagram.com@evil.com/", null],
    ["https://instagram.com:443/reel/ABCDE/", null],
    ["https://www.instagram.com../reel/ABCDE/", null],
    ["https://\u0456nstagram.com/reel/x", null],
    ["javascript:alert(1)", null],
    ["   ", null],
  ])("%s → %s", (input, expected) => {
    expect(detectPostingPlatform(input)).toBe(expected);
  });
});
