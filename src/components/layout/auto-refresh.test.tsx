// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_REFRESH_EVERY_MS,
  AutoRefresh,
  useAutoRefresh,
} from "./auto-refresh";
import { REFRESH_EVERY_MS, REFRESH_TIMES } from "./refreshing-message";

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } };
});
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  useRouter: () => mocks.router,
}));

let restart: () => void = () => {};
function Probe({
  onRefresh,
  burst,
}: {
  onRefresh?: () => void;
  burst?: boolean;
}) {
  restart = useAutoRefresh({ onRefresh, burst }).restart;
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

describe("AutoRefresh's burst (05 §4.3 callouts 8–9: /r while auto-approve runs)", () => {
  it("refreshes every 3 s 10 times, then every 30 s", () => {
    render(<AutoRefresh burst />);
    for (let n = 1; n <= REFRESH_TIMES; n += 1) {
      act(() => vi.advanceTimersByTime(REFRESH_EVERY_MS - 1));
      expect(mocks.refresh).toHaveBeenCalledTimes(n - 1);
      act(() => vi.advanceTimersByTime(1));
      expect(mocks.refresh).toHaveBeenCalledTimes(n);
    }
    act(() => vi.advanceTimersByTime(AUTO_REFRESH_EVERY_MS - 1));
    expect(mocks.refresh).toHaveBeenCalledTimes(REFRESH_TIMES);
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(REFRESH_TIMES + 1);
    act(() => vi.advanceTimersByTime(2 * AUTO_REFRESH_EVERY_MS));
    expect(mocks.refresh).toHaveBeenCalledTimes(REFRESH_TIMES + 3);
  });

  it("refreshes when the viewer comes back to the tab during the burst too", () => {
    render(<AutoRefresh burst />);
    act(() => vi.advanceTimersByTime(REFRESH_EVERY_MS + 1_500));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    comeBack();
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("ends the burst on restart: the next refresh comes 30 s later", () => {
    render(<Probe burst />);
    act(() => vi.advanceTimersByTime(REFRESH_EVERY_MS));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    act(() => restart());
    act(() => vi.advanceTimersByTime(AUTO_REFRESH_EVERY_MS - 1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "during the burst", after: REFRESH_EVERY_MS },
    { name: "after it", after: REFRESH_EVERY_MS * REFRESH_TIMES },
  ])("stops on unmount $name", ({ after }) => {
    const { unmount } = render(<AutoRefresh burst />);
    act(() => vi.advanceTimersByTime(after));
    const before = mocks.refresh.mock.calls.length;
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5 * AUTO_REFRESH_EVERY_MS));
    comeBack();
    expect(mocks.refresh).toHaveBeenCalledTimes(before);
  });
});
