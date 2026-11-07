import type { LicenseSnapshotV1 } from "../../src/lib/licensing/snapshot";

// The license snapshot the record's unit tests share (P20; 05 §4.4, §4.5, §9): @maya's "First snow" licensed to Daily
// Laughs Media LLC for CA$1,732.50, and the postings they combine. No database: a test spreads FIRST_SNOW and states
// only what it changes.

type SnapshotPosting = LicenseSnapshotV1["postings"][number];

export const INSTAGRAM_URL = "https://www.instagram.com/reel/C9xQ2abc/";

/** The ownership's posting. */
export const INSTAGRAM_VERIFIED: SnapshotPosting = {
  platform: "instagram",
  label: "Instagram",
  url: INSTAGRAM_URL,
  verified: true,
  verifiedUsername: "@maya.films",
  linkedAt: "2026-10-12T09:00:00.000Z",
};

export const TIKTOK_VERIFIED: SnapshotPosting = {
  platform: "tiktok",
  label: "TikTok",
  url: "https://www.tiktok.com/@maya.films/video/7312345678901234567",
  verified: true,
  verifiedUsername: "@maya.films",
  linkedAt: "2026-10-01T09:00:00.000Z",
};

export const FACEBOOK_UNVERIFIED: SnapshotPosting = {
  platform: "facebook",
  label: "Facebook",
  url: "https://www.facebook.com/reel/1",
  verified: false,
  verifiedUsername: null,
  linkedAt: null,
};

/** A posting whose link the creator hid. */
export const SNAPCHAT_NO_LINK: SnapshotPosting = {
  platform: "snapchat",
  label: "Snapchat",
  url: null,
  verified: false,
  verifiedUsername: null,
  linkedAt: null,
};

/** Paid social ads · 1 year · Worldwide, non-exclusive, no exclusions, the Instagram posting only. */
export const FIRST_SNOW: LicenseSnapshotV1 = {
  v: 1,
  termsVersion: "v1",
  code: "CL-7K3M-9QXA",
  issuedAt: "2026-10-15T14:32:01.000Z",
  startsAt: "2026-10-15T14:32:00.000Z",
  endsAt: "2027-10-15T14:32:00.000Z",
  licensee: { name: "Daily Laughs Media LLC" },
  creator: { handle: "maya", displayName: "Maya R." },
  ownership: {
    kind: "verified_owner",
    provider: "instagram",
    providerUsername: "@maya.films",
    linkedAt: "2026-10-12T09:00:00.000Z",
    verifiedAt: "2026-10-12T09:05:00.000Z",
    sourcePermalink: INSTAGRAM_URL,
  },
  postings: [INSTAGRAM_VERIFIED],
  video: {
    id: "0b9f3f0e-6a51-4c3e-9d0f-2f4f0d3a7c11",
    title: "First snow",
    durationMs: 14_000,
    width: 1080,
    height: 1920,
  },
  scope: {
    useKey: "paid_social",
    useLabel: "Paid social ads",
    termKey: "y1",
    termLabel: "1 year",
    territoryKey: "worldwide",
    territoryLabel: "Worldwide",
    territoryDetail: null,
  },
  exclusions: { music: false, people: false },
  creditLine: "Video: @maya.films on Instagram",
  amounts: {
    licensePriceCents: 157_500,
    platformFeeCents: 15_750,
    amountTotalCents: 173_250,
    currency: "cad",
  },
  exclusive: false,
  renewalOfCode: null,
};

/** One country — United States. */
export const US_SCOPE: LicenseSnapshotV1["scope"] = {
  ...FIRST_SNOW.scope,
  territoryKey: "country",
  territoryLabel: "One country",
  territoryDetail: "United States",
};

/** A name in each script the license PDF's fonts cover (src/server/pdf/fonts.ts; known risk 20). */
export const SCRIPT_NAMES = [
  "Łukasz Żółć",
  "Řehoř Čapek",
  "Şükrü Öztürk",
  "Nguyễn Văn Đức",
  "Ελένη",
  "Дмитрий",
  "محمد",
  "דוד",
  "राहुल",
  "สมชาย",
  "王小明",
  "さくら",
  "김민준",
] as const;

/** Two emoji in a row: the PDF prints a zero-width space between them (src/server/pdf/printable.ts). */
export const EMOJI_PAIR = "🎬🐶";

/** FIRST_SNOW with SCRIPT_NAMES and EMOJI_PAIR in its licensee, creator name, title and credit line. */
export const MULTI_SCRIPT: LicenseSnapshotV1 = {
  ...FIRST_SNOW,
  licensee: { name: SCRIPT_NAMES.slice(0, 4).join(", ") },
  creator: {
    ...FIRST_SNOW.creator,
    displayName: SCRIPT_NAMES.slice(4, 7).join(" "),
  },
  video: { ...FIRST_SNOW.video, title: SCRIPT_NAMES.slice(7, 10).join(" ") },
  creditLine: `Video: ${SCRIPT_NAMES.slice(10).join(" ")} ${EMOJI_PAIR}`,
};
