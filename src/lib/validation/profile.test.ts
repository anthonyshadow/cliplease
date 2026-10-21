import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_COPY, displayNameMessage } from "./display-name";
import { HANDLE_COPY } from "./handle";
import {
  AGE_ERROR,
  displayNameSchema,
  profileStepFieldErrors,
  profileStepSchema,
} from "./profile";

const valid = {
  displayName: "Maya R.",
  handle: "maya.films",
  ageConfirmed: true,
  timeZone: "America/Toronto",
};

/** The field errors for `input`, through the schema as the action runs it. */
function fieldErrors(input: Record<string, unknown>) {
  const merged = { ...valid, ...input };
  const parsed = profileStepSchema.safeParse(merged);
  if (parsed.success) return {};
  return profileStepFieldErrors(parsed.error, {
    displayName: String(merged.displayName),
    handle: String(merged.handle),
  });
}

describe("profileStepSchema (02 §6.1)", () => {
  it("accepts a ticked, named, valid handle", () => {
    expect(profileStepSchema.safeParse(valid).success).toBe(true);
    expect(fieldErrors({})).toEqual({});
  });

  it("keeps the 18+ message with the product name (07 D93)", () => {
    expect(AGE_ERROR).toBe("You must be 18 or older to sell on ClipLease.");
  });
});

describe("profileStepFieldErrors: the docs' words, never Zod's", () => {
  it.each([
    [{ displayName: "   " }, { displayName: [DISPLAY_NAME_COPY.empty] }],
    [
      { displayName: "a".repeat(61) },
      { displayName: [DISPLAY_NAME_COPY.long] },
    ],
    [{ handle: "ma" }, { handle: [HANDLE_COPY.length] }],
    [{ handle: "maya-films" }, { handle: [HANDLE_COPY.characters] }],
    [{ handle: "maya_" }, { handle: [HANDLE_COPY.shape] }],
    [{ ageConfirmed: false }, { ageConfirmed: [AGE_ERROR] }],
    [{ ageConfirmed: undefined }, { ageConfirmed: [AGE_ERROR] }],
  ])("%j → %j", (input, errors) => {
    expect(fieldErrors(input)).toEqual(errors);
  });

  it("reports every field once, in field order (the action announces the first)", () => {
    const errors = fieldErrors({
      displayName: "",
      handle: "ma",
      ageConfirmed: false,
    });
    expect(errors).toEqual({
      displayName: [DISPLAY_NAME_COPY.empty],
      handle: [HANDLE_COPY.length],
      ageConfirmed: [AGE_ERROR],
    });
    expect(Object.keys(errors)).toEqual([
      "displayName",
      "handle",
      "ageConfirmed",
    ]);
  });
});

describe("displayNameMessage and displayNameSchema (Settings → Save)", () => {
  it("names an empty or a too-long name", () => {
    expect(DISPLAY_NAME_COPY).toEqual({
      empty: "Enter your name.",
      long: "Use 60 characters or fewer.",
    });
    expect(displayNameMessage("  ")).toBe(DISPLAY_NAME_COPY.empty);
    expect(displayNameMessage("a".repeat(61))).toBe(DISPLAY_NAME_COPY.long);
  });

  it("trims, then allows 1 to 60 characters", () => {
    expect(displayNameSchema.parse({ displayName: "  Maya  " })).toEqual({
      displayName: "Maya",
    });
    expect(
      displayNameSchema.safeParse({ displayName: `${"a".repeat(60)}  ` })
        .success,
    ).toBe(true);
    expect(
      displayNameSchema.safeParse({ displayName: "a".repeat(61) }).success,
    ).toBe(false);
  });

  it.each([
    ["Maya\u0000", "Maya"],
    ["\u202eMaya", "Maya"],
    ["Maya\nR.", "Maya R."],
    ["Maya\u200b R.\u2066", "Maya R."],
  ])(
    "tidies a name like a title (owner answer Q-43 a): %j → %j",
    (raw, tidy) => {
      expect(displayNameSchema.parse({ displayName: raw })).toEqual({
        displayName: tidy,
      });
      expect(
        profileStepSchema.parse({ ...valid, displayName: raw }).displayName,
      ).toBe(tidy);
    },
  );

  it("refuses a name with nothing visible as empty, and counts only what is left", () => {
    for (const raw of ["\u200b", "\u202e \u2066", "\u3164"]) {
      expect(displayNameSchema.safeParse({ displayName: raw }).success).toBe(
        false,
      );
      expect(displayNameMessage(raw)).toBe(DISPLAY_NAME_COPY.empty);
      expect(fieldErrors({ displayName: raw })).toEqual({
        displayName: [DISPLAY_NAME_COPY.empty],
      });
    }
    expect(
      displayNameSchema.parse({ displayName: `${"a".repeat(60)}\u200b\u202e` }),
    ).toEqual({ displayName: "a".repeat(60) });
  });
});
