import { randomInt } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TestInfo } from "@playwright/test";

// This run's identity (P22; 07 D54, D154). The setup project (auth.setup.ts) writes run.txt once, before any other
// project starts, and saves each role's signed-in storageState beside it in the git-ignored tests/e2e/.auth/; it also
// creates the creators the specs share, whose Library tiles are split between them here.

const AUTH_DIR = path.join("tests", "e2e", ".auth");
const RUN_FILE = path.join(AUTH_DIR, "run.txt");

/** The setup admin's session (the first ADMIN_EMAILS address): load it with browser.newContext({ storageState }). */
export const ADMIN_STATE = path.join(AUTH_DIR, "admin.json");
/** The setup creator's session: Demo connected (24 posts in the Library), payouts on. */
export const CREATOR_STATE = path.join(AUTH_DIR, "creator.json");
/** 07 D20's dotted handle: the setup project creates the creator, the demo opens /@maya.films. */
export const MAYA_FILMS = "maya.films";

/**
 * The setup creator's Library tile (0-based, newest first) each spec publishes on each project: a post holds one video,
 * so no two tests may share one. The demo signs up a creator of its own.
 */
const SETUP_CREATOR_TILES = {
  decline: { "chromium-desktop": 1, "webkit-iphone": 2 },
  expiry: { "chromium-desktop": 3, "webkit-iphone": 4 },
} as const;

/** `use`'s tile on this test's project (SETUP_CREATOR_TILES); throws for a project it doesn't run on. */
export function setupCreatorTile(
  testInfo: TestInfo,
  use: keyof typeof SETUP_CREATOR_TILES,
): number {
  const tiles: Readonly<Partial<Record<string, number>>> =
    SETUP_CREATOR_TILES[use];
  const tile = tiles[testInfo.project.name];
  if (tile === undefined) {
    throw new Error(`no ${use} tile for ${testInfo.project.name}`);
  }
  return tile;
}

// One letter per Playwright project (07 D154): c chromium-desktop, w webkit-iphone, i webkit-ipad, x chromium-xl,
// s setup.
const PROJECT_LETTER: Readonly<Partial<Record<string, string>>> = {
  "chromium-desktop": "c",
  "webkit-iphone": "w",
  "webkit-ipad": "i",
  "chromium-xl": "x",
  setup: "s",
};

const RUN_ID_RE = /^[0-9a-z]{3,12}$/;
const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

let cached: string | null = null;

/**
 * Writes a new run id to run.txt (the setup project, once per run): the time in base 36 and two random base-36
 * characters (10 characters until 2059).
 */
export function writeRunId(): void {
  const random = Array.from({ length: 2 }, () => BASE36[randomInt(36)]);
  const id = `${Date.now().toString(36)}${random.join("")}`;
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(RUN_FILE, `${id}\n`);
  cached = id;
}

/** This run's id, from run.txt (read once per worker). */
export function runId(): string {
  if (cached !== null) return cached;
  let id: string;
  try {
    id = readFileSync(RUN_FILE, "utf8").trim();
  } catch {
    throw new Error(
      `${RUN_FILE} is missing or unreadable: the setup project writes it, so run the e2e projects with their dependencies (no --no-deps).`,
    );
  }
  if (!RUN_ID_RE.test(id)) throw new Error(`${RUN_FILE} holds no run id`);
  cached = id;
  return id;
}

/** The project's run-id letter (07 D154); throws for a project that has none. */
export function projectLetter(testInfo: TestInfo): string {
  const letter = PROJECT_LETTER[testInfo.project.name];
  if (letter === undefined) {
    throw new Error(`no run-id letter for project ${testInfo.project.name}`);
  }
  return letter;
}
