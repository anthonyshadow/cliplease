// Handle and slug rules (02 §5.2, 07 D20). Pure and client-safe: the onboarding form, the server and the DB CHECK
// (creator_profile_handle_format) agree on them.
import { APP_NAME } from "../app-name";

/** 3–30 characters, lowercase letters, numbers, dots and underscores; starts and ends with a letter or number; no "..". */
export const HANDLE_RE = /^(?!.*\.\.)[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 60;

const HANDLE_MIN = 3;
const HANDLE_MAX = 30;

/**
 * 01 J1's list word for word plus APP_NAME lowercased (07 D20, D100): one set for onboarding and the server. Entries the
 * length or character rules refuse first ("sign-in", "sign-up", "r", "l", "u") stay so the set matches the spec; the
 * listed "cliplease" is also today's APP_NAME, and stays reserved after a rename.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "dashboard",
  "sign-in",
  "signin",
  "sign-up",
  "login",
  "logout",
  "onboarding",
  "settings",
  "verify",
  "legal",
  "r",
  "l",
  "u",
  "help",
  "support",
  "about",
  "terms",
  "privacy",
  "pricing",
  "cliplease",
  "www",
  "mail",
  "static",
  "assets",
  "demo",
  APP_NAME.toLowerCase(),
]);

/** What the handle field holds as the creator types: no "@", no spaces, lowercase. */
export function normalizeHandleInput(raw: string): string {
  return raw.replace(/[@\s]/g, "").toLowerCase();
}

export type HandleProblem = "length" | "characters" | "reserved";

/** Why `handle` (already normalized) can't be claimed, or null. Reserved is checked last: only valid handles get it. */
export function handleProblem(handle: string): HandleProblem | null {
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) return "length";
  if (!HANDLE_RE.test(handle)) return "characters";
  if (RESERVED_HANDLES.has(handle)) return "reserved";
  return null;
}

export const HANDLE_COPY = {
  length: "Use 3 to 30 characters.",
  characters: "Use lowercase letters, numbers, dots and underscores",
  shape: "Start and end with a letter or number, with no two dots in a row.",
  reserved: "That handle isn't available.",
} as const;

/**
 * The message for a handle that can't be claimed (04 §11.10; the length and shape strings are proposed copy, owner
 * answers Q1 and Q3): allowed characters in the wrong places (a "." or "_" at either end, "..") get the shape message.
 */
export function handleProblemMessage(handle: string): string | null {
  const problem = handleProblem(handle);
  if (problem === null) return null;
  if (problem === "characters" && /^[a-z0-9._]+$/.test(handle)) {
    return HANDLE_COPY.shape;
  }
  return HANDLE_COPY[problem];
}

/** `value` cut to `room` characters, without a trailing "." or "_". */
function cutTo(value: string, room: number): string {
  return value.slice(0, room).replace(/[._]+$/, "");
}

/**
 * Up to seven valid, non-reserved alternatives to `base` (maya → maya2, maya.video, its.maya, …), in the order to offer
 * them; the server keeps the first ones that are free (01 J1.5).
 */
export function suggestHandleCandidates(base: string): string[] {
  const core = normalizeHandleInput(base)
    .replace(/[^a-z0-9._]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._]+|[._]+$/g, "");
  if (core === "") return [];
  const candidates = [
    `${cutTo(core, HANDLE_MAX - 1)}2`,
    `${cutTo(core, HANDLE_MAX - 6)}.video`,
    `its.${cutTo(core, HANDLE_MAX - 4)}`,
    `${cutTo(core, HANDLE_MAX - 1)}3`,
    `${cutTo(core, HANDLE_MAX - 6)}.clips`,
    `the.${cutTo(core, HANDLE_MAX - 4)}`,
    `${cutTo(core, HANDLE_MAX - 2)}hq`,
  ];
  return [...new Set(candidates)].filter(
    (handle) => handleProblem(handle) === null && handle !== core,
  );
}
