import { describe, expect, it } from "vitest";
import { isPlainClick } from "./plain-click";

const click = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};

describe("isPlainClick", () => {
  it("is a primary click with no modifier that nothing has handled", () => {
    expect(isPlainClick(click)).toBe(true);
  });

  it("leaves a modified click, another button or a handled click to the browser", () => {
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(isPlainClick({ ...click, [key]: true }), key).toBe(false);
    }
    expect(isPlainClick({ ...click, button: 1 })).toBe(false);
    expect(isPlainClick({ ...click, defaultPrevented: true })).toBe(false);
  });
});
