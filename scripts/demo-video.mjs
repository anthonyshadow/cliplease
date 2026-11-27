// The demo video's stitch (owner answer Q-215), the second half of `bun run demo:video`: the recording run of
// tests/e2e/demo.spec.ts leaves one .webm per page under .data/demo-video/ and manifest.json (each page's open, first
// navigation and close; each test.step's title and start). This lays them on ONE timeline in one MP4,
// .data/demo-video/cliplease-demo.mp4, and extracts a few frames into frames/ to check it by eye. A local tool: ffmpeg
// and ffprobe from PATH (not a package dependency, never in the test path); the raw .webm files stay beside the MP4.
//
// Layout: the desktop pane on the left (the creator; the admin takes it over from its first page, step 28, once the
// creator has nothing left to do), the buyer's phone on the right scaled to the same height, a label strip above each
// pane, and the current step's title in a caption bar below. A newer page on a pane (the creator's new tab in step 5,
// the buyer's page for steps 28–29) covers the older one while it is open. While a pane shows no page (before its first,
// or while the spec parks its window on about:blank between pages), a neutral card with its label and when it is back. At each step's start the whole frame holds for STEP_HOLD_S, all panes at
// once, so its caption can be read before anything moves. This ffmpeg build has no drawtext (no libfreetype), so the
// labels, cards and captions are drawn as PNGs by Playwright's Chromium (installed for the tests) and concatenated into
// the background stream the videos are laid over.
//
// Alignment: Playwright stamps each frame with its wall-clock time, and a page's video starts at its first painted frame:
// when the page opened if it painted about:blank then, else with its first navigation (which one varies from run to
// run), and ends with its last frame held for a few seconds past the page's close (never before it; cut at the close).
// So a video starts at the page's open only when its first frame is blank and, started there, it still reaches the
// close; otherwise at its first navigation.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const DIR = path.join(".data", "demo-video");
const MANIFEST = path.join(DIR, "manifest.json");
const OUT = path.join(DIR, "cliplease-demo.mp4");
const WORK = path.join(DIR, "stitch");
const FRAMES = path.join(DIR, "frames");
const FPS = 25;
/** How far before its page's close a video may end and still count as reaching it (ms). */
const CLOSE_SLACK_MS = 500;
/** The hold at each step's start (s). */
const STEP_HOLD_S = 2.5;
/** Label strip, gap between the panes, caption bar (px). */
const LABEL_H = 36;
const GAP = 12;
const CAPTION_H = 76;
/** The steps a frame is extracted from for the eye check (any missing one is skipped). */
const FRAME_STEPS = ["04", "10b", "17", "21", "22", "29"];
/** Which pane each window takes, and its label. */
const PANE_OF = { creator: "left", admin: "left", buyer: "right" };
const LABEL_OF = { creator: "Creator", admin: "Admin", buyer: "Buyer (phone)" };

const even = (n) => 2 * Math.round(n / 2);
const seconds = (ms) => ms / 1000;
const fixed = (s) => s.toFixed(3);

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `demo-video: ${command} isn't on PATH (brew install ffmpeg)`,
      );
    }
    throw error;
  }
}

/** A file's duration (s), width and height, by ffprobe. */
function probe(file) {
  const out = run("ffprobe", [
    ...["-v", "error", "-select_streams", "v:0"],
    ...["-show_entries", "stream=width,height:format=duration"],
    ...["-of", "json", file],
  ]);
  const { streams, format } = JSON.parse(out);
  return {
    duration: Number(format.duration),
    width: streams[0].width,
    height: streams[0].height,
  };
}

/** Whether a video's first frame is one flat shade (about:blank, or a navigation's first paint). */
function startsBlank(file) {
  const stats = run("ffmpeg", [
    ...["-hide_banner", "-loglevel", "error", "-i", file, "-frames:v", "1"],
    ...["-vf", "signalstats,metadata=print:file=-", "-f", "null", "-"],
  ]);
  const value = (name) =>
    Number(new RegExp(`signalstats\\.${name}=([0-9.]+)`).exec(stats)?.[1]);
  return value("YMAX") - value("YMIN") <= 2;
}

/** The manifest, checked for what this script reads. */
function readManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  if (
    !Array.isArray(manifest.videos) ||
    manifest.videos.length === 0 ||
    !Array.isArray(manifest.steps) ||
    manifest.steps.length === 0
  ) {
    throw new Error(`${MANIFEST}: no videos or steps`);
  }
  for (const video of manifest.videos) {
    if (
      !(video.role in PANE_OF) ||
      typeof video.file !== "string" ||
      typeof video.startedAt !== "number" ||
      !Array.isArray(video.shown)
    ) {
      throw new Error(
        `${MANIFEST}: a video without its role, file, start or shown times`,
      );
    }
  }
  return manifest;
}

const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One background frame: the label strips, a card in each pane with nothing to show, and the caption bar. */
function chromeHtml(layout, state) {
  const pane = (box, label, card) => `
    <div class="label" style="left:${box.x}px;width:${box.w}px">${escapeHtml(label)}</div>
    <div class="pane" style="left:${box.x}px;width:${box.w}px">${
      card
        ? `<div class="card"><b>${escapeHtml(card.title)}</b><span>${escapeHtml(card.note)}</span></div>`
        : ""
    }</div>`;
  return `<!doctype html><html><head><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: ${layout.width}px; height: ${layout.height}px; background: #0e1014; position: relative;
      overflow: hidden; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #e6e8eb; }
    .label { position: absolute; top: 0; height: ${LABEL_H}px; padding: 0 14px; display: flex; align-items: center;
      font-size: 17px; font-weight: 600; letter-spacing: 0.02em; color: #c9ced6; white-space: nowrap; overflow: hidden; }
    .pane { position: absolute; top: ${LABEL_H}px; height: ${layout.paneH}px; background: #1a1e25; display: flex;
      align-items: center; justify-content: center; }
    .card { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 16px; }
    .card b { font-size: 26px; color: #f2f4f7; }
    .card span { font-size: 17px; color: #9aa3af; }
    .caption { position: absolute; left: 0; top: ${LABEL_H + layout.paneH}px; width: ${layout.width}px;
      height: ${CAPTION_H}px; padding: 0 22px; display: flex; align-items: center; background: #000;
      font-size: 23px; line-height: 30px; color: #fff; }
  </style></head><body>
    ${pane(layout.left, state.leftLabel, state.leftCard)}
    ${pane(layout.right, state.rightLabel, state.rightCard)}
    <div class="caption">${escapeHtml(state.caption)}</div>
  </body></html>`;
}

/** A step's number as its title starts it ("16", "10b", "07 D20", "S5"). */
const stepNumber = (title) => title.split(" · ")[0];

// The videos on the timeline, in seconds from the first one's start; each shown while its page showed the app.
const manifest = readManifest();
const placed = manifest.videos.map((video) => {
  const file = path.join(DIR, video.file);
  const { duration, width, height } = probe(file);
  const firstShown = video.shown[0]?.from;
  const reachesClose =
    video.closedAt === null ||
    video.startedAt + duration * 1000 >= video.closedAt - CLOSE_SLACK_MS;
  const startsAt =
    firstShown !== undefined && !(reachesClose && startsBlank(file))
      ? firstShown
      : video.startedAt;
  return { ...video, path: file, duration, width, height, startsAt };
});
const t0 = Math.min(...placed.map((video) => video.startsAt));
const videos = placed.map((video) => {
  const offset = seconds(video.startsAt - t0);
  const end = offset + video.duration;
  const intervals = video.shown
    .map(({ from, to }) => ({
      from: seconds(from - t0),
      to: Math.min(end, seconds((to ?? video.closedAt ?? Infinity) - t0)),
    }))
    .filter(({ from, to }) => to > from);
  return {
    ...video,
    offset,
    intervals,
    /** Its first showing: a later one covers an earlier one on the same pane. */
    from: intervals[0]?.from ?? null,
    pane: PANE_OF[video.role],
    label: `${LABEL_OF[video.role]}${video.page > 1 ? " · new tab" : ""}`,
  };
});
for (const video of videos) {
  const start =
    video.startsAt === video.startedAt ? "page open" : "first navigation";
  const shows = video.intervals.map((i) => `${fixed(i.from)}–${fixed(i.to)}`);
  console.log(
    `demo-video: ${video.file}: ${fixed(video.duration)} s from ${fixed(video.offset)} s (its ${start}), shown ${shows.join(", ") || "never"}`,
  );
}
const steps = manifest.steps
  .map((step) => ({ ...step, at: seconds(step.startedAt - t0) }))
  .sort((a, b) => a.at - b.at);
const total = Math.max(
  ...videos.flatMap((video) => video.intervals.map(({ to }) => to)),
);

// The panes: the left at the creator's size, the right at the buyer's aspect and the left's height.
const creator = videos.find((v) => v.role === "creator" && v.page === 1);
const buyer = videos.find((v) => v.role === "buyer" && v.page === 1);
if (!creator || !buyer) {
  throw new Error(
    `${MANIFEST}: needs the creator's and the buyer's first pages`,
  );
}
const paneH = even(creator.height);
const left = { x: 0, w: even(creator.width) };
const right = {
  x: left.w + GAP,
  w: even((buyer.width * paneH) / buyer.height),
};
const layout = {
  left,
  right,
  paneH,
  width: right.x + right.w,
  height: LABEL_H + paneH + CAPTION_H,
};
const boxOf = { left, right };

/** The step running at `t` (undefined before the first). */
const stepAt = (t) => steps.filter((s) => s.at <= t).at(-1);

/** The page a pane shows at `t`: of those showing the app then, the one first shown last. */
const shownOn = (pane, t) =>
  videos
    .filter(
      (v) =>
        v.pane === pane && v.intervals.some((i) => i.from <= t && t < i.to),
    )
    .sort((a, b) => a.from - b.from)
    .at(-1);

/** A pane's card while it shows no page: the next page's label and when it (re)appears. */
function cardFor(pane, t) {
  const onPane = videos.filter((v) => v.pane === pane);
  const next = onPane
    .flatMap((v) => v.intervals.map((i) => ({ at: i.from, label: v.label })))
    .filter(({ at }) => at > t)
    .sort((a, b) => a.at - b.at)[0];
  if (!next) {
    return {
      title: LABEL_OF[pane === "right" ? "buyer" : "creator"],
      note: "Closed",
    };
  }
  const seen = onPane.some((v) => v.intervals.some((i) => i.from <= t));
  const step = stepAt(next.at);
  const note = !step
    ? "Joins shortly"
    : seen && step === stepAt(t)
      ? "Back in a moment"
      : `${seen ? "Back" : "Joins"} in step ${stepNumber(step.title)}`;
  return { title: next.label, note };
}

function stateAt(t) {
  const step = stepAt(t);
  const leftShown = shownOn("left", t);
  const rightShown = shownOn("right", t);
  const leftCard = leftShown ? null : cardFor("left", t);
  const rightCard = rightShown ? null : cardFor("right", t);
  return {
    caption: step ? step.title : "",
    leftLabel: leftShown?.label ?? leftCard.title,
    rightLabel: rightShown?.label ?? rightCard.title,
    leftCard,
    rightCard,
  };
}

// The background: one PNG per distinct state between consecutive events, concatenated with their durations.
const events = [
  0,
  total,
  ...steps.map((s) => s.at),
  ...videos.flatMap((v) => v.intervals.flatMap(({ from, to }) => [from, to])),
]
  .filter((t) => t >= 0 && t <= total)
  .sort((a, b) => a - b)
  .filter((t, i, all) => i === 0 || t - all[i - 1] > 0.001);
const segments = [];
for (let i = 0; i + 1 < events.length; i += 1) {
  const state = stateAt(events[i]);
  const key = JSON.stringify(state);
  const last = segments.at(-1);
  if (last && last.key === key) last.to = events[i + 1];
  else segments.push({ key, state, from: events[i], to: events[i + 1] });
}

rmSync(WORK, { recursive: true, force: true });
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(FRAMES, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: layout.width, height: layout.height },
});
const images = new Map();
for (const segment of segments) {
  if (images.has(segment.key)) continue;
  const name = `chrome-${String(images.size).padStart(3, "0")}.png`;
  await page.setContent(chromeHtml(layout, segment.state));
  await page.screenshot({ path: path.join(WORK, name) });
  images.set(segment.key, name);
}
await browser.close();
const list = ["ffconcat version 1.0"];
for (const segment of segments) {
  list.push(
    `file '${images.get(segment.key)}'`,
    `duration ${fixed(segment.to - segment.from)}`,
  );
}
list.push(`file '${images.get(segments.at(-1).key)}'`);
const concatList = path.join(WORK, "chrome.ffconcat");
writeFileSync(concatList, `${list.join("\n")}\n`);

// The graph: the background at FPS; each video shifted to its start, scaled to its pane and shown while its page shows
// the app; then the holds, from the last step back (each one leaves the earlier frames' numbers as they were).
const shown = videos
  .filter((v) => v.from !== null)
  .sort((a, b) => a.from - b.from);
const filters = [`[0:v]fps=${FPS},format=yuv420p,setpts=PTS-STARTPTS[b0]`];
shown.forEach((video, i) => {
  const box = boxOf[video.pane];
  filters.push(
    `[${i + 1}:v]setpts=PTS-STARTPTS+${fixed(video.offset)}/TB,scale=${box.w}:${paneH}:flags=lanczos,format=yuv420p[v${i + 1}]`,
    `[b${i}][v${i + 1}]overlay=x=${box.x}:y=${LABEL_H}:eof_action=pass:enable='${video.intervals.map((w) => `between(t,${fixed(w.from)},${fixed(w.to)})`).join("+")}'[b${i + 1}]`,
  );
});
const holdFrames = Math.round(STEP_HOLD_S * FPS);
const holdAt = [...new Set(steps.map((s) => Math.ceil(s.at * FPS)))]
  .filter((frame) => frame < total * FPS)
  .sort((a, b) => b - a);
filters.push(
  `[b${shown.length}]${holdAt.map((frame) => `loop=loop=${holdFrames}:size=1:start=${frame}`).join(",")},setpts=N/(${FPS}*TB)[out]`,
);
/** A time on the recorded timeline, on the video's (after the holds before it). */
const outputTime = (t) =>
  t + STEP_HOLD_S * holdAt.filter((frame) => frame / FPS <= t).length;
const length = outputTime(total);
console.log(
  `demo-video: ${fixed(total)} s recorded, ${fixed(length)} s with the holds; ${layout.width} × ${layout.height}; ${segments.length} background segments; ${shown.length} videos`,
);
run("ffmpeg", [
  ...["-y", "-hide_banner", "-loglevel", "error", "-stats"],
  ...["-f", "concat", "-safe", "0", "-i", concatList],
  ...shown.flatMap((video) => ["-i", video.path]),
  ...["-filter_complex", filters.join(";"), "-map", "[out]"],
  ...["-t", fixed(length), "-r", String(FPS)],
  ...["-c:v", "libx264", "-preset", "medium", "-crf", "22"],
  ...["-maxrate", "6M", "-bufsize", "12M", "-pix_fmt", "yuv420p"],
  ...["-movflags", "+faststart", OUT],
]);

rmSync(WORK, { recursive: true, force: true });

// A frame a third into each of FRAME_STEPS, to look at.
const frames = [];
for (const number of FRAME_STEPS) {
  const step = steps.find((s) => stepNumber(s.title) === number);
  if (!step) continue;
  const at = outputTime(step.at + seconds(step.durationMs) * 0.35);
  const file = path.join(FRAMES, `step-${number}.png`);
  run("ffmpeg", [
    ...["-y", "-hide_banner", "-loglevel", "error", "-ss", fixed(at)],
    ...["-i", OUT, "-frames:v", "1", file],
  ]);
  frames.push(`${file} (${fixed(at)} s)`);
}
const out = probe(OUT);
console.log(
  `demo-video: ${OUT}: ${fixed(out.duration)} s, ${out.width} × ${out.height}, ${(statSync(OUT).size / 1e6).toFixed(1)} MB`,
);
console.log(`demo-video: frames\n  ${frames.join("\n  ")}`);
