// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { LicenseAvailabilityState } from "@/lib/domain/values";
import { AvailabilityLine } from "./availability-line";

afterEach(cleanup);

const UNTIL = "2027-11-20T15:00:00.000Z";
const NAME = "Daily Laughs Media LLC";

function line(
  state: LicenseAvailabilityState,
  props: Partial<ComponentProps<typeof AvailabilityLine>> = {},
) {
  const until =
    state === "exclusive_active" || state === "renewal_reserved" ? UNTIL : null;
  const { container } = render(
    <AvailabilityLine
      audience="creator"
      availability={{ state, until }}
      {...props}
    />,
  );
  return container;
}

describe("AvailabilityLine (07 D110; 04 §9.39)", () => {
  it.each([
    ["reserved", "Exclusive request waiting"],
    ["exclusive_active", `Licensed exclusively to ${NAME} until 20 Nov 2027`],
    ["renewal_reserved", `Reserved for ${NAME} until 20 Nov 2027`],
    ["non_exclusive_only", ""],
    ["open", ""],
  ] as const)("the creator's %s reads '%s'", (state, text) => {
    expect(line(state, { licenseeName: NAME }).textContent).toBe(text);
  });

  it.each([
    ["reserved", "Reserved"],
    ["exclusive_active", "Licensed exclusively until 20 Nov 2027"],
    ["renewal_reserved", "Reserved"],
    ["non_exclusive_only", ""],
    ["open", ""],
  ] as const)("the public's %s reads '%s'", (state, text) => {
    expect(line(state, { audience: "public" }).textContent).toBe(text);
  });

  it.each([
    ["exclusive_active", "Licensed exclusively until 20 Nov 2027"],
    ["renewal_reserved", "Reserved"],
  ] as const)(
    "with no name, the creator's %s reads the public words, never 'null'",
    (state, text) => {
      for (const licenseeName of [null, undefined]) {
        expect(line(state, { licenseeName }).textContent).toBe(text);
        cleanup();
      }
    },
  );

  it.each(["reserved", "exclusive_active", "renewal_reserved"] as const)(
    "the public %s never names anyone, even when given a name",
    (state) => {
      const text = line(state, {
        audience: "public",
        licenseeName: NAME,
      }).textContent;
      expect(text).not.toContain(NAME);
      expect(text).not.toBe("");
    },
  );

  it("says a perpetual license blocks exclusive only with its prop, for the creator, and only while non_exclusive_only", () => {
    const PERPETUAL =
      "A perpetual license of this video is running, so it can't be licensed exclusively.";
    expect(
      line("non_exclusive_only", { perpetualBlocksExclusive: true })
        .textContent,
    ).toBe(PERPETUAL);
    cleanup();
    expect(line("non_exclusive_only").textContent).toBe("");
    cleanup();
    expect(
      line("non_exclusive_only", {
        audience: "public",
        perpetualBlocksExclusive: true,
      }).textContent,
    ).toBe("");
    cleanup();
    expect(line("open", { perpetualBlocksExclusive: true }).textContent).toBe(
      "",
    );
    cleanup();
    expect(
      line("reserved", { perpetualBlocksExclusive: true }).textContent,
    ).toBe("Exclusive request waiting");
  });

  it("is one plain paragraph with one class set at every state, which wraps inside its card", () => {
    const states = [
      ["reserved", {}],
      ["exclusive_active", { licenseeName: NAME }],
      ["renewal_reserved", { licenseeName: NAME }],
      ["non_exclusive_only", { perpetualBlocksExclusive: true }],
      ["reserved", { audience: "public" }],
      ["exclusive_active", { audience: "public" }],
    ] as const;
    for (const [state, props] of states) {
      const container = line(state, props);
      const p = container.firstElementChild;
      expect(container.childElementCount).toBe(1);
      expect(p?.tagName).toBe("P");
      expect(p?.className).toBe(
        "text-footnote text-ink-2 tabular-nums wrap-anywhere",
      );
      expect(p?.hasAttribute("role")).toBe(false);
      cleanup();
    }
  });
});
