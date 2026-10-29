// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_REFRESH_EVERY_MS,
  AutoRefresh,
  useAutoRefresh,
} from "./auto-refresh";

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } };
});
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  useRouter: () => mocks.router,
}));

let restart: () => void = () => {};
function Probe({ onRefresh }: { onRefresh?: () => void }) {
  restart = useAutoRefresh({ onRefresh }).restart;
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const comeBack = () => act(() => void window.dispatchEvent(new Event("focus")));

describe("AutoRefresh (01 J7.17; 05 §4.3, §6.3)", () => {
  it("refreshes every 30 s", () => {
    render(<AutoRefresh />);
    act(() => vi.advanceTimersByTime(AUTO_REFRESH_EVERY_MS - 1));
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2 * AUTO_REFRESH_EVERY_MS));
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
  });

  it("refreshes when the viewer comes back to the tab, once per return", () => {
    render(<AutoRefresh />);
    comeBack();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    // The same return seen twice (focus, then visibilitychange) counts once.
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5_000));
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("skips its ticks while the tab is hidden, then refreshes once when it is shown again", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    render(<AutoRefresh />);
    act(() => vi.advanceTimersByTime(10 * AUTO_REFRESH_EVERY_MS));
    expect(mocks.refresh).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(AUTO_REFRESH_EVERY_MS));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it("calls onRefresh just before each refresh", () => {
    const order: string[] = [];
    mocks.refresh.mockImplementation(() => order.push("refresh"));
    render(<Probe onRefresh={() => order.push("onRefresh")} />);
    comeBack();
    act(() => vi.advanceTimersByTime(AUTO_REFRESH_EVERY_MS));
    expect(order).toEqual(["onRefresh", "refresh", "onRefresh", "refresh"]);
    mocks.refresh.mockReset();
  });

  it("starts the 30 s over on restart", () => {
    render(<Probe />);
    act(() => vi.advanceTimersByTime(20_000));
    act(() => restart());
    act(() => vi.advanceTimersByTime(AUTO_REFRESH_EVERY_MS - 1));
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("stops on unmount", () => {
    const { unmount } = render(<AutoRefresh />);
    unmount();
    act(() => vi.advanceTimersByTime(5 * AUTO_REFRESH_EVERY_MS));
    comeBack();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
