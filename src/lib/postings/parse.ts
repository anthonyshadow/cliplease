// The "Where was it posted?" link parser (07 D67; research/platform-owner-answers.md §1.1). Pure and client-safe: the
// picker runs it as the creator pastes, and the server runs it again before it stores anything. It never fetches, HEADs,
// oEmbeds or redirect-resolves the link (SSRF rule, AGENTS.md §5): the post id comes from the text alone, and the canonical
// url is rebuilt from that id, so the raw paste is never stored or shown.
import {
  POSTING_PLATFORMS,
  type PostingLinkError,
  type PostingPlatform,
} from "../domain/values";
import { MOCK_ACCOUNT_SUFFIX, mockPermalink } from "../social/mock-ids";
import { POSTING_URL_MAX } from "./limits";

/** A pasted link, read (02 §5.12). */
export type ParsedPostingLink = {
  platform: PostingPlatform;
  /**
   * The id the verifier matches social_post.link_key on, always a string (TikTok and X ids pass 2^53): the Instagram
   * shortcode, the TikTok, YouTube, X or Snapchat id, the Facebook video or reel id or "{page}/{postId}" for a Facebook
   * post, the mock post id; null for Other.
   */
  linkKey: string | null;
  /** The canonical https url rebuilt from the id: no fragment, and no query but the id-carrying `v`. Other keeps its own. */
  url: string;
  kind:
    | "reel"
    | "post"
    | "video"
    | "short"
    | "watch"
    | "status"
    | "spotlight"
    | "other";
};

/** The link, or the first rule it breaks; `detected` names the platform a wrong_platform link belongs to. */
export type ParsePostingLinkResult =
  | { ok: true; link: ParsedPostingLink }
  | { ok: false; error: PostingLinkError; detected?: PostingPlatform };

/** The six platforms with hosts of their own: Other has none, and Demo's is example.com with a /mock/ path. */
type ListedPlatform = Exclude<PostingPlatform, "other" | "mock">;
/** The platform a link's host belongs to (step 5). */
type HostPlatform = Exclude<PostingPlatform, "other">;
type LinkKind = ParsedPostingLink["kind"];

/**
 * Research §1.1's "Accepted hosts" and short-link hosts, as exact strings: a host is accepted only when it equals one, so
 * l.instagram.com, l.facebook.com, m.x.com and story.snapchat.com are on no list.
 */
const PLATFORM_HOSTS: Record<
  ListedPlatform,
  { accepted: readonly string[]; short: readonly string[] }
> = {
  instagram: {
    accepted: [
      "instagram.com",
      "www.instagram.com",
      "m.instagram.com",
      "instagr.am",
      "www.instagr.am",
    ],
    short: [],
  },
  tiktok: {
    accepted: ["tiktok.com", "www.tiktok.com", "m.tiktok.com"],
    short: ["vm.tiktok.com", "vt.tiktok.com"],
  },
  youtube: {
    accepted: [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
      "youtube-nocookie.com",
      "www.youtube-nocookie.com",
    ],
    short: [],
  },
  facebook: {
    accepted: [
      "facebook.com",
      "www.facebook.com",
      "m.facebook.com",
      "web.facebook.com",
      "mbasic.facebook.com",
    ],
    short: ["fb.watch"],
  },
  x: {
    accepted: [
      "x.com",
      "www.x.com",
      "mobile.x.com",
      "twitter.com",
      "www.twitter.com",
      "mobile.twitter.com",
    ],
    short: ["t.co"],
  },
  snapchat: {
    accepted: ["snapchat.com", "www.snapchat.com"],
    short: ["t.snapchat.com"],
  },
};

/**
 * Step 5's lookup: every accepted and short host above, to its platform; a host is a platform's only when it is a key.
 * Each platform's domains (instagram.com, instagr.am, youtu.be, fb.watch, t.co …) are keys themselves, so on the Other
 * chip a host equal to or under a key is refused, the ones no list names (l.instagram.com, l.facebook.com, www.fb.watch)
 * included. Suffix matches only ever refuse.
 */
const HOST_PLATFORM = new Map(
  POSTING_PLATFORMS.flatMap((platform) => {
    if (platform === "other" || platform === "mock") return [];
    const { accepted, short } = PLATFORM_HOSTS[platform];
    return [...accepted, ...short].map((host) => [host, platform] as const);
  }),
);
const LISTED_HOSTS = [...HOST_PLATFORM.keys()];
/** Hosts that name no public site; "localhost" itself has no dot. */
const NON_PUBLIC_SUFFIXES = [".localhost", ".local", ".internal"];

/** Step 2: the first http(s) link in the paste (TikTok's "Copy link" pastes "Check out …'s video! #tiktok https://…"). */
const LINK_TOKEN = /https?:\/\/[^\s<>"']+/i;
/** A scheme, as in "javascript:", "mailto:" or "ftp://"; the ":443" of "instagram.com:443/…" is a port, not one. */
const SCHEME = /^([a-z][a-z0-9+.-]*):(?!\d)/i;
/** The only schemes SCHEME may find: any other ("javascript", "ftp", "mailto") is not_a_url. */
const HTTP_SCHEME = /^https?$/i;
/** The authority as written: new URL drops a default port (":443") and an empty userinfo ("@host"), so step 3 reads it. */
const AUTHORITY = /^https?:[/\\]*([^/\\?#]*)/i;
/** A bracketed IPv6 literal opening the authority: its colons are not a port's. */
const IPV6_LITERAL = /^\[[^\]]*\]/;
/** An IPv4 literal, also the form new URL gives numeric hosts ("3232235521" → 192.168.0.1). */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** P06's mock post ids, the `_2` second account's and the `shared_account` scenario's included. */
const MOCK_PATH = new RegExp(
  `^/mock/(mock_post_${MOCK_ACCOUNT_SUFFIX}_\\d{2})/?$`,
);
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,64}$/;
/**
 * Instagram's post keywords and the kind each gives; a reel's canonical path is /reel/{code}/, a post's /p/{code}/. A
 * Map, so a pasted path word like "constructor" is no keyword.
 */
const INSTAGRAM_KEYWORDS = new Map<string, Extract<LinkKind, "reel" | "post">>([
  ["reel", "reel"],
  ["reels", "reel"],
  ["p", "post"],
  ["tv", "post"],
]);
const TIKTOK_USER = /^@([A-Za-z0-9._]{1,24})$/;
/**
 * Numeric ids (TikTok, Facebook, X) take no leading zero: "0671…" would be a second link key for the post "671…", one
 * the cross-creator check (exact platform and link_key) would miss. They stay strings: TikTok and X ids pass 2^53.
 */
const TIKTOK_ID = /^[1-9]\d{14,19}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** 11-character path words that match YOUTUBE_ID but name a playlist or a channel's live embed, not a video. */
const YOUTUBE_NOT_IDS = ["videoseries", "live_stream"];
/** /live/{id}, /embed/{id} and /v/{id}: paths whose second segment is a video id, read as a watch link. */
const YOUTUBE_WATCH_PATHS = ["live", "embed", "v"];
/** /channel/…, /c/… and /user/…: paths naming a channel when a segment follows. */
const YOUTUBE_CHANNEL_PATHS = ["channel", "c", "user"];
const FACEBOOK_ID = /^[1-9]\d{4,19}$/;
const FACEBOOK_PAGE = /^[A-Za-z0-9.]{1,100}$/;
const FACEBOOK_POST_ID = /^(?:pfbid[A-Za-z0-9]+|[1-9]\d{4,19})$/;
/** permalink.php, story.php, profile.php: a Facebook script, not a page name. */
const FACEBOOK_SCRIPT = /\.php$/;
const X_ID = /^[1-9]\d{0,19}$/;
const X_MEDIA_INDEX = /^\d{1,2}$/;
const SNAPCHAT_ID = /^[A-Za-z0-9_-]{10,200}$/;
/** A YouTube or Snapchat "@handle" path segment. */
const HANDLE = /^@./;

/**
 * Reads a link pasted on a platform's chip (07 D67). Steps, the first failure winning: the paste's first http(s) link
 * (`empty`, `too_long`, `not_a_url`); no userinfo, port or empty host label (`bad_host`); the host on an exact list,
 * a Demo link counting as on none without `allowMock`; then the chip's rules: Other takes any public host but a
 * platform's, Demo only example.com/mock/{post id} with `allowMock`, and the six platforms their research §1.1 paths,
 * each giving the id and a canonical url rebuilt from it (`too_long` when that outgrows the paste).
 */
export function parsePostingLink(
  platform: PostingPlatform,
  input: string,
  opts: { allowMock: boolean },
): ParsePostingLinkResult {
  const read = readLink(input);
  if (!read.ok) return refused(read.error);
  const { url, host } = read;
  const detected = hostPlatformOf(host, url.pathname);
  const hostPlatform = detected === "mock" && !opts.allowMock ? null : detected;
  if (platform === "other") return otherLink(url, host, hostPlatform);
  if (platform === "mock") return mockLink(url, hostPlatform, opts.allowMock);
  if (hostPlatform === null) return refused("bad_host");
  if (hostPlatform !== platform) return wrongPlatform(hostPlatform);
  if (PLATFORM_HOSTS[platform].short.includes(host)) {
    return refused("short_link");
  }
  const segments = pathSegments(url.pathname);
  if (segments === null || segments.length === 0) {
    return refused("unrecognized");
  }
  return PATH_RULES[platform](segments, url, host);
}

/**
 * The platform a pasted link's host belongs to (steps 1–5, no error codes): the picker's "This is an Instagram link. Move
 * it there?" hint. A /mock/ link on example.com gives mock; a paste that doesn't read, or a host on no list, gives null.
 */
export function detectPostingPlatform(input: string): PostingPlatform | null {
  const read = readLink(input);
  return read.ok ? hostPlatformOf(read.host, read.url.pathname) : null;
}

type ReadLink =
  | { ok: true; url: URL; host: string }
  | { ok: false; error: PostingLinkError };

/** Steps 1–4: the paste's first http(s) link, parsed, on a host written with no userinfo, no port and no empty label. */
function readLink(input: string): ReadLink {
  const text = input.trim();
  if (text === "") return { ok: false, error: "empty" };
  if (text.length > POSTING_URL_MAX) return { ok: false, error: "too_long" };
  const candidate =
    LINK_TOKEN.exec(text)?.[0] ?? (/\s/.test(text) ? null : text);
  if (candidate === null) return { ok: false, error: "not_a_url" };
  const scheme = SCHEME.exec(candidate)?.[1];
  if (scheme !== undefined && !HTTP_SCHEME.test(scheme)) {
    return { ok: false, error: "not_a_url" };
  }
  const href = scheme === undefined ? `https://${candidate}` : candidate;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { ok: false, error: "not_a_url" };
  }
  // Any "@" in the authority (userinfo, even empty) and any ":" after the host (a port, even ":443" or an empty one).
  const authority = AUTHORITY.exec(href)?.[1] ?? "";
  const withoutIpv6 = authority.replace(IPV6_LITERAL, "");
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    authority.includes("@") ||
    withoutIpv6.includes(":")
  ) {
    return { ok: false, error: "bad_host" };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // One trailing dot is removed; an empty label left over ("instagram.com.", "127.0.0.1.", ".vimeo.com", "a..b") would
  // dodge every exact-host, IP-literal and suffix check below, and browsers still resolve it.
  if (host.split(".").includes("")) return { ok: false, error: "bad_host" };
  return { ok: true, url, host };
}

/** Step 5: the platform whose exact host list names the host, or mock for example.com's /mock/ links. */
function hostPlatformOf(host: string, pathname: string): HostPlatform | null {
  const demo = host === "example.com" && pathname.startsWith("/mock/");
  return HOST_PLATFORM.get(host) ?? (demo ? "mock" : null);
}

/** Step 6, the Other chip: any public host that isn't a platform's, kept with its path and query, without the fragment. */
function otherLink(
  url: URL,
  host: string,
  hostPlatform: HostPlatform | null,
): ParsePostingLinkResult {
  if (hostPlatform !== null) return wrongPlatform(hostPlatform);
  const platformHost = LISTED_HOSTS.some(
    (listed) => host === listed || host.endsWith(`.${listed}`),
  );
  if (platformHost || !isPublicHost(host)) return refused("bad_host");
  return accepted(
    "other",
    null,
    `https://${host}${url.pathname}${url.search}`,
    "other",
  );
}

/** Has a dot, and isn't an IP literal, *.localhost, *.local or *.internal. */
function isPublicHost(host: string): boolean {
  if (!host.includes(".") || host.startsWith("[") || IPV4.test(host)) {
    return false;
  }
  return !NON_PUBLIC_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** Step 7, the Demo chip (dev and test only): https://example.com/mock/{post id}. */
function mockLink(
  url: URL,
  hostPlatform: HostPlatform | null,
  allowMock: boolean,
): ParsePostingLinkResult {
  if (!allowMock) return refused("bad_host");
  const id =
    hostPlatform === "mock" ? MOCK_PATH.exec(url.pathname)?.[1] : undefined;
  if (id !== undefined) {
    return accepted("mock", id, mockPermalink(id), "video");
  }
  return hostPlatform === null || hostPlatform === "mock"
    ? refused("unrecognized")
    : wrongPlatform(hostPlatform);
}

/** The path's segments, one trailing slash allowed; null when one is empty ("//"). */
function pathSegments(pathname: string): string[] | null {
  const path = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === "") return [];
  const segments = path.slice(1).split("/");
  return segments.includes("") ? null : segments;
}

type PathRule = (
  segments: readonly string[],
  url: URL,
  host: string,
) => ParsePostingLinkResult;

/** Step 8: each platform's research §1.1 paths, given a non-empty path on one of its accepted hosts. */
const PATH_RULES: Record<ListedPlatform, PathRule> = {
  instagram: instagramLink,
  tiktok: tiktokLink,
  youtube: youtubeLink,
  facebook: facebookLink,
  x: xLink,
  snapchat: snapchatLink,
};

/**
 * /reel/{code}/ and /reels/{code}/ → a reel (/reel/{code}/), /p/{code}/ and /tv/{code}/ → a post (/p/{code}/), also as
 * the observed /{username}/reel|p/{code}/ (the username dropped); /share/… is a short link and /{username}/ a profile.
 */
function instagramLink(segments: readonly string[]): ParsePostingLinkResult {
  const [first] = segments;
  if (first === "share") return refused("short_link");
  if (segments.length === 1) {
    return refused(
      INSTAGRAM_KEYWORDS.has(first) ? "unrecognized" : "profile_link",
    );
  }
  const withUsername =
    segments.length === 3 && (segments[1] === "reel" || segments[1] === "p");
  const post = withUsername ? segments.slice(1) : segments;
  const [keyword, code] = post;
  const kind = INSTAGRAM_KEYWORDS.get(keyword);
  if (post.length !== 2 || kind === undefined || !INSTAGRAM_CODE.test(code)) {
    return refused("unrecognized");
  }
  const path = kind === "reel" ? "reel" : "p";
  return accepted(
    "instagram",
    code,
    `https://www.instagram.com/${path}/${code}/`,
    kind,
  );
}

/**
 * /@{user}/video/{id} → a video; /@{user}/photo/{id} isn't one; /@{user} is a profile; /t/… and /v/{id}.html carry no
 * user and need a redirect.
 */
function tiktokLink(segments: readonly string[]): ParsePostingLinkResult {
  const [first, type, id] = segments;
  if (first === "t" || first === "v") return refused("short_link");
  const user = TIKTOK_USER.exec(first)?.[1];
  if (user === undefined) return refused("unrecognized");
  if (segments.length === 1) return refused("profile_link");
  if (segments.length !== 3 || !TIKTOK_ID.test(id)) {
    return refused("unrecognized");
  }
  if (type === "photo") return refused("not_a_video");
  if (type !== "video") return refused("unrecognized");
  return accepted(
    "tiktok",
    id,
    `https://www.tiktok.com/@${user}/video/${id}`,
    "video",
  );
}

/**
 * /shorts/{id} → a short; /watch?v={id}, youtu.be/{id}, /live/{id}, /embed/{id} and /v/{id} → a watch link (/watch?v=);
 * /@{handle}, /channel/…, /c/… and /user/… are channels; /embed/videoseries?list=… (a playlist) and
 * /embed/live_stream are no video.
 */
function youtubeLink(
  segments: readonly string[],
  url: URL,
  host: string,
): ParsePostingLinkResult {
  const [first, second] = segments;
  if (host === "youtu.be") {
    return segments.length === 1
      ? youtubeVideo(first, "watch")
      : refused("unrecognized");
  }
  if (segments.length === 1 && first === "watch") {
    return youtubeVideo(url.searchParams.get("v"), "watch");
  }
  if (segments.length === 2 && first === "shorts") {
    return youtubeVideo(second, "short");
  }
  if (segments.length === 2 && YOUTUBE_WATCH_PATHS.includes(first)) {
    return youtubeVideo(second, "watch");
  }
  const channel =
    HANDLE.test(first) ||
    (segments.length > 1 && YOUTUBE_CHANNEL_PATHS.includes(first));
  return refused(channel ? "profile_link" : "unrecognized");
}

function youtubeVideo(
  id: string | null,
  kind: Extract<LinkKind, "short" | "watch">,
): ParsePostingLinkResult {
  if (id === null || !YOUTUBE_ID.test(id) || YOUTUBE_NOT_IDS.includes(id)) {
    return refused("unrecognized");
  }
  const url =
    kind === "short"
      ? `https://www.youtube.com/shorts/${id}`
      : `https://www.youtube.com/watch?v=${id}`;
  return accepted("youtube", id, url, kind);
}

/**
 * /video.php?v={id}, /watch?v={id} (or /watch/?v=) and /{page}/videos/[{slug}/]{id} → a video (/watch/?v={id});
 * /reel/{id} → a reel; /{page}/posts/{postId} → a post keyed "{page}/{postId}", the page name keeping its case;
 * /share/… is a short link and /{page} a profile.
 */
function facebookLink(
  segments: readonly string[],
  url: URL,
): ParsePostingLinkResult {
  const [first, second, third] = segments;
  if (first === "share") return refused("short_link");
  if (segments.length === 1 && (first === "video.php" || first === "watch")) {
    return facebookVideo(url.searchParams.get("v"));
  }
  if (first === "reel") {
    return segments.length === 2 && FACEBOOK_ID.test(second)
      ? accepted(
          "facebook",
          second,
          `https://www.facebook.com/reel/${second}`,
          "reel",
        )
      : refused("unrecognized");
  }
  if (!FACEBOOK_PAGE.test(first)) return refused("unrecognized");
  if (segments.length === 1) {
    return refused(
      FACEBOOK_SCRIPT.test(first) ? "unrecognized" : "profile_link",
    );
  }
  if (second === "videos" && (segments.length === 3 || segments.length === 4)) {
    return facebookVideo(segments[segments.length - 1]);
  }
  if (second === "posts" && segments.length === 3) {
    return FACEBOOK_POST_ID.test(third)
      ? accepted(
          "facebook",
          `${first}/${third}`,
          `https://www.facebook.com/${first}/posts/${third}`,
          "post",
        )
      : refused("unrecognized");
  }
  return refused("unrecognized");
}

function facebookVideo(id: string | null): ParsePostingLinkResult {
  if (id === null || !FACEBOOK_ID.test(id)) return refused("unrecognized");
  return accepted(
    "facebook",
    id,
    `https://www.facebook.com/watch/?v=${id}`,
    "video",
  );
}

/**
 * /{user}/status/{id} (optionally /video/{n} or /photo/{n}), /i/status/{id} and /i/web/status/{id} → /i/status/{id}: X
 * resolves any username in the path, so it proves nothing and is dropped. /{user} is a profile.
 */
function xLink(segments: readonly string[]): ParsePostingLinkResult {
  if (segments.length === 1 && segments[0] !== "i") {
    return refused("profile_link");
  }
  const id = xStatusId(segments);
  if (id === null || !X_ID.test(id)) return refused("unrecognized");
  return accepted("x", id, `https://x.com/i/status/${id}`, "status");
}

function xStatusId(segments: readonly string[]): string | null {
  const [first, second, third, fourth, fifth] = segments;
  if (first === "i") {
    if (segments.length === 3 && second === "status") return third;
    const web = segments.length === 4 && second === "web" && third === "status";
    return web ? fourth : null;
  }
  if (second !== "status") return null;
  if (segments.length === 3) return third;
  const media =
    segments.length === 5 &&
    (fourth === "video" || fourth === "photo") &&
    X_MEDIA_INDEX.test(fifth);
  return media ? third : null;
}

/**
 * /spotlight/{id}, /@{user}/spotlight/{id} and /add/{user}/spotlight/{id} → /spotlight/{id}; /@{user} and /add/{user}
 * are profiles; /t/… is a short link.
 */
function snapchatLink(segments: readonly string[]): ParsePostingLinkResult {
  if (segments[0] === "t") return refused("short_link");
  const profile = snapchatProfileLength(segments);
  const [section, id] = segments.slice(profile);
  if (profile > 0 && profile === segments.length) {
    return refused("profile_link");
  }
  if (
    segments.length !== profile + 2 ||
    section !== "spotlight" ||
    !SNAPCHAT_ID.test(id)
  ) {
    return refused("unrecognized");
  }
  return accepted(
    "snapchat",
    id,
    `https://www.snapchat.com/spotlight/${id}`,
    "spotlight",
  );
}

/** How many leading segments name a profile: /@{user} (1) or /add/{user} (2), else 0. */
function snapchatProfileLength(segments: readonly string[]): number {
  if (HANDLE.test(segments[0])) return 1;
  return segments[0] === "add" && segments.length > 1 ? 2 : 0;
}

/** A rebuilt url can outgrow the paste ("https://" or "www." added): one cap, every chip (CHECK video_posting_url_shape). */
function accepted(
  platform: PostingPlatform,
  linkKey: string | null,
  url: string,
  kind: LinkKind,
): ParsePostingLinkResult {
  if (url.length > POSTING_URL_MAX) return refused("too_long");
  return { ok: true, link: { platform, linkKey, url, kind } };
}

function refused(error: PostingLinkError): ParsePostingLinkResult {
  return { ok: false, error };
}

function wrongPlatform(detected: PostingPlatform): ParsePostingLinkResult {
  return { ok: false, error: "wrong_platform", detected };
}
