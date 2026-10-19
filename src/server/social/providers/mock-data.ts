import "server-only";

// The Demo provider's fixed data (research/social.md §8; 07 D36, D53). Deterministic: fixed dates, the newest at
// MOCK_ANCHOR, never relative to now. No env and no database, so the P09 seed can load it.

export const MOCK_ANCHOR = "2026-10-01T15:00:00Z";

/** 04 §2.5: six neutral tile tones, the number color chosen for ≥ 4.5:1. */
export const MOCK_THUMB_TONES = [
  { bg: "#EBEBEB", fg: "#111111" }, // design-ok: mock thumbnail tones (15.84:1)
  { bg: "#D4D4D4", fg: "#111111" }, // design-ok: mock thumbnail tones (12.74:1)
  { bg: "#B8B8B8", fg: "#111111" }, // design-ok: mock thumbnail tones (9.52:1)
  { bg: "#8C8C8C", fg: "#111111" }, // design-ok: mock thumbnail tones (5.62:1)
  { bg: "#616161", fg: "#FFFFFF" }, // design-ok: mock thumbnail tones (6.19:1)
  { bg: "#333333", fg: "#FFFFFF" }, // design-ok: mock thumbnail tones (12.63:1)
] as const;

/** Post `n`'s tile: one solid tone with its two-digit number centered. No gradient, image, style or script. */
export function mockThumbnailSvg(
  n: number,
  width: number,
  height: number,
): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    throw new RangeError("mock thumbnail number must be 1 to 99");
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new RangeError("mock thumbnail size must be positive integers");
  }
  const tone = MOCK_THUMB_TONES[(n - 1) % MOCK_THUMB_TONES.length];
  const fontSize = Math.round(Math.min(width, height) * 0.4);
  const label = String(n).padStart(2, "0");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${tone?.bg}"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" ` +
    `font-weight="600" font-size="${fontSize}" fill="${tone?.fg}">${label}</text></svg>`
  );
}

export type MockPostRow = {
  n: number;
  caption: string;
  publishedAt: string;
  durationSec: number;
  width: number;
  height: number;
  views: number;
  likes: number;
  comments: number;
};

/** The 24 posts, newest first (research/social.md §8). Post 01 is 14 s at 720 × 1280 (07 D53). */
export const MOCK_POSTS: readonly MockPostRow[] = [
  {
    n: 1,
    caption: "He saw snow for the first time and lost it #dogs #firstsnow",
    publishedAt: "2026-10-01T15:00:00Z",
    durationSec: 14,
    width: 720,
    height: 1280,
    views: 14800000,
    likes: 888000,
    comments: 44400,
  },
  {
    n: 2,
    caption: "Caught a wave at sunrise. Worth the 4:30 alarm #surf",
    publishedAt: "2026-09-24T11:00:00Z",
    durationSec: 38,
    width: 1080,
    height: 1920,
    views: 2310000,
    likes: 161700,
    comments: 18480,
  },
  {
    n: 3,
    caption: "Grandma's 60-second dumpling fold, finally on camera #cooking",
    publishedAt: "2026-09-17T07:00:00Z",
    durationSec: 61,
    width: 1080,
    height: 1920,
    views: 987000,
    likes: 78960,
    comments: 5922,
  },
  {
    n: 4,
    caption: "The bus driver who sings every stop name #commute",
    publishedAt: "2026-09-10T14:00:00Z",
    durationSec: 22,
    width: 1080,
    height: 1920,
    views: 3420000,
    likes: 307800,
    comments: 13680,
  },
  {
    n: 5,
    caption:
      "Pulled this kitten out of a storm drain. Update in comments #rescue",
    publishedAt: "2026-09-03T10:00:00Z",
    durationSec: 47,
    width: 1080,
    height: 1920,
    views: 6120000,
    likes: 612000,
    comments: 55080,
  },
  {
    n: 6,
    caption: "Lightning hit the lake 200 m from our dock #storm",
    publishedAt: "2026-08-27T06:00:00Z",
    durationSec: 9,
    width: 1080,
    height: 1920,
    views: 1250000,
    likes: 137500,
    comments: 8750,
  },
  {
    n: 7,
    caption: "My toddler's honest review of lemons #toddler",
    publishedAt: "2026-08-20T13:00:00Z",
    durationSec: 12,
    width: 1080,
    height: 1920,
    views: 8740000,
    likes: 524400,
    comments: 43700,
  },
  {
    n: 8,
    caption: "Street dancer stops traffic in the rain #dance",
    publishedAt: "2026-08-13T09:00:00Z",
    durationSec: 29,
    width: 1080,
    height: 1920,
    views: 512000,
    likes: 35840,
    comments: 1536,
  },
  {
    n: 9,
    caption: "14 hours of fog rolling over the bridge #timelapse",
    publishedAt: "2026-08-06T05:00:00Z",
    durationSec: 58,
    width: 1920,
    height: 1080,
    views: 233000,
    likes: 18640,
    comments: 1864,
  },
  {
    n: 10,
    caption: "The parrot learned the microwave beep. Send help #parrot",
    publishedAt: "2026-07-30T12:00:00Z",
    durationSec: 17,
    width: 1080,
    height: 1920,
    views: 4410000,
    likes: 396900,
    comments: 26460,
  },
  {
    n: 11,
    caption: "Northern lights from our backyard, no filter #aurora",
    publishedAt: "2026-07-23T08:00:00Z",
    durationSec: 44,
    width: 1080,
    height: 1920,
    views: 1930000,
    likes: 193000,
    comments: 7720,
  },
  {
    n: 12,
    caption: "Fixing a 1972 typewriter, start to finish #restoration",
    publishedAt: "2026-07-16T15:00:00Z",
    durationSec: 176,
    width: 1080,
    height: 1920,
    views: 388000,
    likes: 42680,
    comments: 3492,
  },
  {
    n: 13,
    caption: "The wedding cake almost fell. Almost. #wedding",
    publishedAt: "2026-07-09T11:00:00Z",
    durationSec: 11,
    width: 1080,
    height: 1920,
    views: 2760000,
    likes: 165600,
    comments: 19320,
  },
  {
    n: 14,
    caption: "A seal stole my paddleboard spot #wildlife",
    publishedAt: "2026-07-02T07:00:00Z",
    durationSec: 26,
    width: 1080,
    height: 1920,
    views: 1640000,
    likes: 114800,
    comments: 8200,
  },
  {
    n: 15,
    caption: "One take down the parking garage ramp #skate",
    publishedAt: "2026-06-25T14:00:00Z",
    durationSec: 33,
    width: 1080,
    height: 1920,
    views: 743000,
    likes: 59440,
    comments: 2229,
  },
  {
    n: 16,
    caption: "Baby goats discover the trampoline #farmlife",
    publishedAt: "2026-06-18T10:00:00Z",
    durationSec: 19,
    width: 1080,
    height: 1920,
    views: 5280000,
    likes: 475200,
    comments: 42240,
  },
  {
    n: 17,
    caption: "Hail the size of golf balls on our street #weather",
    publishedAt: "2026-06-11T06:00:00Z",
    durationSec: 15,
    width: 1080,
    height: 1920,
    views: 961000,
    likes: 96100,
    comments: 5766,
  },
  {
    n: 18,
    caption: "Bread in a cabin with no power #baking",
    publishedAt: "2026-06-04T13:00:00Z",
    durationSec: 92,
    width: 1080,
    height: 1920,
    views: 147000,
    likes: 16170,
    comments: 588,
  },
  {
    n: 19,
    caption: "This fox visits the porch every night at 9 #fox",
    publishedAt: "2026-05-28T09:00:00Z",
    durationSec: 21,
    width: 1080,
    height: 1920,
    views: 2090000,
    likes: 125400,
    comments: 18810,
  },
  {
    n: 20,
    caption: "First home run. The whole team loses it #baseball",
    publishedAt: "2026-05-21T05:00:00Z",
    durationSec: 24,
    width: 1080,
    height: 1920,
    views: 3350000,
    likes: 234500,
    comments: 23450,
  },
  {
    n: 21,
    caption: "Lavender fields at golden hour from the drone #drone",
    publishedAt: "2026-05-14T12:00:00Z",
    durationSec: 52,
    width: 1920,
    height: 1080,
    views: 412000,
    likes: 32960,
    comments: 2060,
  },
  {
    n: 22,
    caption: "Our cat meets the robot vacuum #cats",
    publishedAt: "2026-05-07T08:00:00Z",
    durationSec: 18,
    width: 1080,
    height: 1920,
    views: 7020000,
    likes: 631800,
    comments: 21060,
  },
  {
    n: 23,
    caption: "The sound of ice cracking on a frozen lake #asmr",
    publishedAt: "2026-04-30T15:00:00Z",
    durationSec: 31,
    width: 1080,
    height: 1920,
    views: 281000,
    likes: 28100,
    comments: 2248,
  },
  {
    n: 24,
    caption: "Double rainbow over the city after the storm #rainbow",
    publishedAt: "2026-04-23T11:00:00Z",
    durationSec: 13,
    width: 1080,
    height: 1920,
    views: 1080000,
    likes: 118800,
    comments: 6480,
  },
];
