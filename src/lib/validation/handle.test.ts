import { describe, expect, it } from "vitest";
import {
  INVALID_HANDLES,
  VALID_HANDLES,
} from "../../../tests/fixtures/handles";
import { APP_NAME } from "../app-name";
import {
  HANDLE_COPY,
  HANDLE_RE,
  handleFromParam,
  handleProblem,
  handleProblemMessage,
  normalizeHandleInput,
  RESERVED_HANDLES,
  SLUG_MAX_LENGTH,
  SLUG_RE,
  suggestHandleCandidates,
} from "./handle";

describe("HANDLE_RE and handleProblem (02 §5.2, 07 D20)", () => {
  it.each(VALID_HANDLES)("accepts %s", (handle) => {
    expect(HANDLE_RE.test(handle)).toBe(true);
    expect(handleProblem(handle)).toBeNull();
  });

  it.each(INVALID_HANDLES)("rejects %s (%s)", (handle, problem) => {
    expect(HANDLE_RE.test(handle)).toBe(false);
    expect(handleProblem(handle)).toBe(problem);
  });

  it("reserves exactly the 01 J1 list plus the product name", () => {
    // 01 J1, written out so a misspelt entry fails here.
    const J1_LIST =
      "admin api app dashboard sign-in signin sign-up login logout onboarding settings verify legal r l u help support about terms privacy pricing cliplease www mail static assets demo".split(
        " ",
      );
    expect([...RESERVED_HANDLES].sort()).toEqual(
      [...new Set([...J1_LIST, APP_NAME.toLowerCase()])].sort(),
    );
    expect(RESERVED_HANDLES.size).toBe(28);
  });

  it("checks the format before the reserved list", () => {
    for (const handle of ["admin", "cliplease", "dashboard", "www", "demo"]) {
      expect(handleProblem(handle)).toBe("reserved");
    }
    expect(handleProblem("sign-in")).toBe("characters");
    expect(handleProblem("r")).toBe("length");
  });
});

describe("handleProblemMessage (04 §11.10)", () => {
  it.each([
    ["ma", HANDLE_COPY.length],
    ["maya-films", HANDLE_COPY.characters],
    ["Maya", HANDLE_COPY.characters],
    [".maya", HANDLE_COPY.shape],
    ["maya_", HANDLE_COPY.shape],
    ["a..b", HANDLE_COPY.shape],
    ["admin", "That handle isn't available."],
    ["maya", null],
  ])("%s → %s", (handle, message) => {
    expect(handleProblemMessage(handle)).toBe(message);
  });

  it("keeps the 04 §11.10 strings", () => {
    expect(HANDLE_COPY.characters).toBe(
      "Use lowercase letters, numbers, dots and underscores",
    );
    expect(HANDLE_COPY.reserved).toBe("That handle isn't available.");
  });
});

describe("normalizeHandleInput", () => {
  it.each([
    ["@Maya.Films", "maya.films"],
    ["  maya films ", "mayafilms"],
    ["@@MAYA", "maya"],
    ["", ""],
  ])("%j → %j", (raw, handle) => {
    expect(normalizeHandleInput(raw)).toBe(handle);
  });
});

describe("suggestHandleCandidates (01 J1.5)", () => {
  it("offers maya2, maya.video and its.maya first", () => {
    expect(suggestHandleCandidates("maya").slice(0, 3)).toEqual([
      "maya2",
      "maya.video",
      "its.maya",
    ]);
  });

  it.each([
    "maya",
    "a",
    "ab",
    "maya.films",
    "a".repeat(30),
    `${"a".repeat(23)}.b_cdef`,
    "maya.",
    "_maya_",
    "@Ma ya",
    "x..y",
    "admin",
  ])(
    "every suggestion for %j is valid, not reserved and not the base",
    (base) => {
      const suggestions = suggestHandleCandidates(base);
      expect(suggestions.length).toBeGreaterThan(0);
      for (const handle of suggestions) {
        expect(HANDLE_RE.test(handle)).toBe(true);
        expect(RESERVED_HANDLES.has(handle)).toBe(false);
        expect(handle).not.toBe(normalizeHandleInput(base));
      }
    },
  );

  it("offers nothing for a base with no usable characters", () => {
    expect(suggestHandleCandidates("@!$")).toEqual([]);
  });
});

describe("SLUG_RE", () => {
  it.each(["first-snow", "a", "v2-take-3"])("accepts %s", (slug) => {
    expect(SLUG_RE.test(slug)).toBe(true);
  });
  it.each(["First-snow", "-snow", "snow-", "a--b", "snow.day", ""])(
    "rejects %j",
    (slug) => {
      expect(SLUG_RE.test(slug)).toBe(false);
    },
  );
  it("caps slugs at 60 characters", () => {
    expect(SLUG_MAX_LENGTH).toBe(60);
  });
});

describe("handleFromParam (02 §4.3)", () => {
  it("decodes and lowercases, flagging mixed case for the 308", () => {
    expect(handleFromParam("maya")).toEqual({
      handle: "maya",
      mixedCase: false,
    });
    expect(handleFromParam("Maya.R")).toEqual({
      handle: "maya.r",
      mixedCase: true,
    });
    expect(handleFromParam("maya%5Fr")).toEqual({
      handle: "maya_r",
      mixedCase: false,
    });
  });
  it.each(["ma", "maya..r", "%E0%A4%A", "-maya", "maya/x"])(
    "is null for %j, which can't be a handle",
    (param) => {
      expect(handleFromParam(param)).toBeNull();
    },
  );
});
