// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClearedSeal } from "./cleared-seal";

afterEach(cleanup);

describe("ClearedSeal (04 §10.1)", () => {
  it.each([16, 40, 72, 88] as const)(
    "is a decorative %i px seal in the cleared tokens",
    (size) => {
      const { container } = render(<ClearedSeal size={size} />);
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.getAttribute("width")).toBe(String(size));
      expect(svg?.getAttribute("height")).toBe(String(size));
      expect(svg?.querySelector("circle")?.getAttribute("class")).toBe(
        "fill-cleared",
      );
      const check = svg?.querySelector("path");
      expect(check?.getAttribute("class")).toBe("stroke-cleared-ink");
      // 8 % of the 100-unit diameter, drawn whole (static: no animation class).
      expect(check?.getAttribute("stroke-width")).toBe("8");
      expect(check?.getAttribute("stroke-dasharray")).toBe("1");
    },
  );

  it("takes classes, so a caller can size it per tier with CSS", () => {
    const { container } = render(
      <ClearedSeal size={72} className="lg:size-22" />,
    );
    expect(container.querySelector("svg")?.getAttribute("class")).toContain(
      "lg:size-22",
    );
  });
});
