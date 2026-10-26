// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAfterPress } from "./use-after-press";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useAfterPress", () => {
  it("runs at once when no press is in progress (a key moved the focus)", () => {
    const { result } = renderHook(() => useAfterPress());
    const update = vi.fn();
    fireEvent.keyDown(window, { key: "Tab" });
    result.current(update);
    expect(update).toHaveBeenCalledOnce();
  });

  it("waits for the press's click, then runs after its handlers", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAfterPress());
    const update = vi.fn();
    fireEvent.pointerDown(window);
    fireEvent.mouseDown(window);
    result.current(update);
    fireEvent.mouseUp(window);
    vi.advanceTimersByTime(500);
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(window);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(update).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2000);
    expect(update).toHaveBeenCalledOnce();
  });

  it("gives up waiting after a second, for a press released off the page", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAfterPress());
    const update = vi.fn();
    fireEvent.pointerDown(window);
    result.current(update);
    vi.advanceTimersByTime(999);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.runOnlyPendingTimers();
    expect(update).toHaveBeenCalledOnce();
  });
});
