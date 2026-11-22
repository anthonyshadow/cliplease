// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl, type SegmentLink } from "./segmented-control";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TABS = ["Creators", "Accounts", "Videos", "Requests", "Licenses"];

const items = (current: string): SegmentLink[] =>
  TABS.map((label) => ({
    href: `/admin?tab=${label.toLowerCase()}`,
    label,
    current: label === current,
  }));

/** jsdom lays nothing out: each element's box as the browser would place it, and the nav's scrollLeft recorded. */
function layOut(nav: HTMLElement, current: HTMLElement) {
  vi.spyOn(nav, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 16, y: 0, width: 300, height: 44 }),
  );
  vi.spyOn(current, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 400, y: 4, width: 90, height: 36 }),
  );
  let scrollLeft = 0;
  Object.defineProperty(nav, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });
  return () => scrollLeft;
}

describe("SegmentedControl (04 §9.8)", () => {
  it("links each segment, the current one aria-current, in a nav named by its label", () => {
    render(<SegmentedControl label="Admin tables" items={items("Videos")} />);
    const nav = screen.getByRole("navigation", { name: "Admin tables" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(TABS);
    expect(links.map((a) => a.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "page",
      null,
      null,
    ]);
    expect(links[2].getAttribute("href")).toBe("/admin?tab=videos");
    expect(links[2].className).toContain("bg-action");
  });

  it("keeps equal segments and no scroll box without `scroll`", () => {
    render(<SegmentedControl label="Requests" items={items("Videos")} />);
    const nav = screen.getByRole("navigation", { name: "Requests" });
    expect(nav.className).not.toContain("overflow-x-auto");
    const list = within(nav).getByRole("list");
    expect(list.className).toContain("grid");
    expect(list.className).toContain("auto-cols-fr");
    expect(list.className).not.toContain("w-max");
  });

  it("with `scroll`, scrolls the segments inside a padded box below md and makes them equal segments from md (07 D146)", () => {
    render(
      <SegmentedControl
        label="Admin tables"
        scroll
        className="md:max-w-reading"
        items={items("Videos")}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Admin tables" });
    for (const name of [
      "overflow-x-auto",
      "p-1",
      "-m-1",
      "md:overflow-visible",
      "md:p-0",
      "md:m-0",
      "md:max-w-reading",
    ]) {
      expect(nav.className.split(" ")).toContain(name);
    }
    const list = within(nav).getByRole("list").className.split(" ");
    expect(list).toContain("flex");
    expect(list).not.toContain("grid");
    expect(list).toContain("w-max");
    expect(list).toContain("md:grid");
    expect(list).toContain("md:w-full");
    expect(list).toContain("auto-cols-fr");
    // The 44 px targets stay: the touch height and the hit area around each segment.
    expect(list).toContain("pointer-coarse:h-11");
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.className).toContain("hit-44");
    }
  });

  it("scrolls the current segment into view as it first renders", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return this.tagName === "NAV"
          ? DOMRect.fromRect({ x: 16, width: 300, height: 44 })
          : DOMRect.fromRect({ x: 400, width: 90, height: 36 });
      },
    );
    const scrollTo = vi.spyOn(Element.prototype, "scrollLeft", "set");
    render(
      <SegmentedControl
        label="Admin tables"
        scroll
        items={items("Licenses")}
      />,
    );
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(279);
  });

  it("scrolls the current segment to the middle of its box, and again when another becomes current", () => {
    const { rerender } = render(
      <SegmentedControl
        label="Admin tables"
        scroll
        items={items("Creators")}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Admin tables" });
    const scrolled = layOut(
      nav,
      within(nav).getByRole("link", { name: "Licenses" }),
    );
    rerender(
      <SegmentedControl
        label="Admin tables"
        scroll
        items={items("Licenses")}
      />,
    );
    // Licenses' middle (445) to the box's middle (166).
    expect(scrolled()).toBe(279);
  });

  it("leaves the box alone when no segment is current", () => {
    const { rerender } = render(
      <SegmentedControl label="Admin tables" scroll items={items("Videos")} />,
    );
    const nav = screen.getByRole("navigation", { name: "Admin tables" });
    const scrolled = layOut(
      nav,
      within(nav).getByRole("link", { name: "Videos" }),
    );
    rerender(
      <SegmentedControl label="Admin tables" scroll items={items("None")} />,
    );
    expect(scrolled()).toBe(0);
  });
});
