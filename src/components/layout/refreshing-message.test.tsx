// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REFRESH_EVERY_MS,
  REFRESH_TIMES,
  useCheckingRefresh,
} from "./refreshing-message";

// Next's router is one object for the page's life.
const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } };
});
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  useRouter: () => mocks.router,
}));

function Probe({ active }: { active: boolean }) {
  return <p>{useCheckingRefresh(active) ? "done" : "checking"}</p>;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCheckingRefresh (02 §8.3, 05 §4.3)", () => {
  it("refreshes every 3 s for 30 s, then reports it is done", () => {
    expect(REFRESH_EVERY_MS * REFRESH_TIMES).toBe(30_000);
    render(<Probe active />);
    expect(screen.getByText("checking")).toBeTruthy();

    act(() => vi.advanceTimersByTime(REFRESH_EVERY_MS - 1));
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(30_000 - REFRESH_EVERY_MS - 1));
    expect(mocks.refresh).toHaveBeenCalledTimes(REFRESH_TIMES - 1);
    expect(screen.getByText("checking")).toBeTruthy();

    // The tenth refresh, at 30 s, is the last.
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(REFRESH_TIMES);
    expect(screen.getByText("done")).toBeTruthy();

    act(() => vi.advanceTimersByTime(60_000));
    expect(mocks.refresh).toHaveBeenCalledTimes(REFRESH_TIMES);
  });

  it("never refreshes while inactive", () => {
    render(<Probe active={false} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops when the page moves on: inactive, or unmounted", () => {
    const { rerender, unmount } = render(<Probe active />);
    act(() => vi.advanceTimersByTime(2 * REFRESH_EVERY_MS));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    rerender(<Probe active={false} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    rerender(<Probe active />);
    unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(vi.getTimerCount()).toBe(0);
  });
});
