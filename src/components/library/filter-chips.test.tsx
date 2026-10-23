// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterChips, type ToggleChip } from "./filter-chips";

afterEach(cleanup);

type Platform = "instagram" | "x" | "mock";

const CHIPS: readonly ToggleChip<Platform>[] = [
  { value: "instagram", label: "Instagram", pressed: true },
  { value: "x", label: "X", pressed: false },
  { value: "mock", label: "Demo", pressed: true, disabled: true },
];

function renderMultiple(
  props: {
    chips?: readonly ToggleChip<Platform>[];
    mirrorName?: string;
    error?: string;
  } = {},
) {
  const onToggle = vi.fn<(value: Platform) => void>();
  render(
    <>
      <h2 id="where">Where was it posted?</h2>
      <FilterChips
        mode="multiple"
        labelledBy="where"
        chips={props.chips ?? CHIPS}
        onToggle={onToggle}
        mirrorName={props.mirrorName}
        error={props.error}
      />
    </>,
  );
  return onToggle;
}

const chip = (name: string) => screen.getByRole("button", { name });
const mirrors = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  );

describe("FilterChips single mode (04 §9.14; P09's Library links)", () => {
  it("stays a scrolling list of links, the current one aria-current", () => {
    render(
      <FilterChips
        chips={[
          { key: "all", label: "All 24", href: "/l", current: true },
          {
            key: "mock",
            label: "Demo 24",
            href: "/l?platform=mock",
            current: false,
          },
        ]}
      />,
    );
    const list = screen.getByRole("list");
    expect(list.className).toContain("overflow-x-auto");
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/l",
      "/l?platform=mock",
    ]);
    expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([
      "page",
      null,
    ]);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("FilterChips multiple mode (04 §9.14; 07 D69, D146)", () => {
  it("is a group named by its legend, one aria-pressed toggle button per chip", () => {
    renderMultiple();
    const group = screen.getByRole("group", { name: "Where was it posted?" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Instagram",
      "X",
      "Demo",
    ]);
    for (const b of buttons) expect(b.getAttribute("type")).toBe("button");
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "true",
    ]);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("wraps at every tier and never scrolls (07 D146, D153)", () => {
    renderMultiple();
    const group = screen.getByRole("group");
    expect(group.className).toContain("flex");
    expect(group.className).toContain("flex-wrap");
    expect(group.className).toContain("gap-2");
    expect(group.className).not.toContain("overflow");
  });

  it("gives every chip a 44 px box: h-11 tall and at least as wide", () => {
    renderMultiple();
    for (const name of ["Instagram", "X", "Demo"]) {
      expect(chip(name).className).toContain("h-11");
      expect(chip(name).className).toContain("min-w-11");
    }
  });

  it("leads an on chip with the 16 px Check, so the state never depends on fill alone", () => {
    renderMultiple();
    const icon = chip("Instagram").querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.getAttribute("width")).toBe("16");
    expect(chip("X").querySelector("svg")).toBeNull();
  });

  it("calls onToggle with the chip's value on a press; the caller owns the state", () => {
    const onToggle = renderMultiple();
    fireEvent.click(chip("X"));
    fireEvent.click(chip("Instagram"));
    expect(onToggle.mock.calls).toEqual([["x"], ["instagram"]]);
    // Controlled: nothing changes until the caller re-renders.
    expect(chip("X").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps an aria-disabled chip focusable but ignores its presses", () => {
    const onToggle = renderMultiple();
    const demo = chip("Demo");
    expect(demo.getAttribute("aria-disabled")).toBe("true");
    expect(demo.hasAttribute("disabled")).toBe(false);
    demo.focus();
    expect(document.activeElement).toBe(demo);
    fireEvent.click(demo);
    expect(onToggle).not.toHaveBeenCalled();
    expect(chip("X").hasAttribute("aria-disabled")).toBe(false);
  });

  it("shows a pressed locked chip on, and an off disabled chip in the disabled tokens", () => {
    renderMultiple({
      chips: [
        { value: "mock", label: "Demo", pressed: true, disabled: true },
        { value: "x", label: "X", pressed: false, disabled: true },
      ],
    });
    expect(chip("Demo").className).toContain("bg-action");
    expect(chip("X").className).toContain("text-ink-3");
    expect(chip("X").className).not.toContain("hover:border-ink");
  });

  it("renders no checkbox mirror unless asked", () => {
    renderMultiple();
    expect(mirrors()).toEqual([]);
  });

  it("mirrors each enabled chip into a hidden checkbox, never a disabled one", () => {
    renderMultiple({ mirrorName: "platform" });
    const inputs = mirrors();
    expect(inputs.map((i) => [i.name, i.value, i.checked, i.hidden])).toEqual([
      ["platform", "instagram", true, true],
      ["platform", "x", false, true],
    ]);
    const form = document.createElement("form");
    for (const i of inputs) form.append(i.cloneNode());
    expect(new FormData(form).getAll("platform")).toEqual(["instagram"]);
  });

  it("renders no 'All' chip and no counts: the chips are the caller's", () => {
    renderMultiple();
    expect(screen.queryByRole("button", { name: /^All/ })).toBeNull();
    expect(
      screen.getAllByRole("button").every((b) => !/\d/.test(b.textContent)),
    ).toBe(true);
  });

  it("shows its error under the row, describes every chip by it and marks the wrapper while there is one", () => {
    renderMultiple({ error: "Say where it was posted" });
    const error = screen.getByText("Say where it was posted").closest("p");
    expect(error?.id).toBeTruthy();
    expect(error?.className).toContain("text-danger-text");
    expect(
      screen
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-describedby")),
    ).toEqual([error?.id, error?.id, error?.id]);
    const group = screen.getByRole("group");
    expect(group.parentElement?.hasAttribute("data-chip-error")).toBe(true);
    expect(group.compareDocumentPosition(error as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    cleanup();
    renderMultiple();
    expect(chip("Instagram").getAttribute("aria-describedby")).toBeNull();
    expect(document.querySelector("[data-chip-error]")).toBeNull();
    expect(document.querySelector("p")).toBeNull();
  });
});
