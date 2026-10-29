// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS } from "@/lib/time";
import { CountdownChip } from "./countdown-chip";

const NOW = new Date("2026-10-28T12:00:00Z");
const inHours = (h: number) =>
  new Date(NOW.getTime() + h * HOUR_MS).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const chip = (container: HTMLElement) => container.firstElementChild;

describe("CountdownChip's tone (04 §9.10; 01 J8.1)", () => {
  it("turns amber at 6 h or less for the creator", () => {
    const { container } = render(<CountdownChip expiresAt={inHours(5)} />);
    act(() => vi.advanceTimersByTime(0));
    expect(chip(container)?.className).toContain("bg-awaiting-tint");
    expect(container.textContent).toBe("Expires in 5 h 0 min");
  });

  it("stays neutral for the buyer below 6 h (tone neutral)", () => {
    const { container } = render(
      <CountdownChip expiresAt={inHours(5)} tone="neutral" />,
    );
    act(() => vi.advanceTimersByTime(0));
    expect(chip(container)?.className).toContain("bg-fill");
    expect(chip(container)?.className).not.toContain("awaiting");
    expect(container.textContent).toBe("Expires in 5 h 0 min");
  });

  it("is neutral above 6 h", () => {
    const { container } = render(<CountdownChip expiresAt={inHours(7)} />);
    act(() => vi.advanceTimersByTime(0));
    expect(chip(container)?.className).toContain("bg-fill");
  });
});
