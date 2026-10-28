// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REFRESH_EVERY_MS,
  REFRESH_TIMES,
  RefreshingMessage,
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

const TITLE = "Finishing checkout…";
const BODY = "Nothing has been charged.";

const spinner = (container: HTMLElement) =>
  container.querySelector("h1 svg.animate-spin");

beforeEach(() => {
  vi.useFakeTimers();
  mocks.refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RefreshingMessage (02 §8.3, 05 §4.3)", () => {
  it("refreshes every 3 s for 30 s, then shows the body in the spinner's place", () => {
    expect(REFRESH_EVERY_MS * REFRESH_TIMES).toBe(30_000);
    const { container } = render(
      <RefreshingMessage title={TITLE} body={BODY} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: TITLE })).toBeTruthy();
    expect(spinner(container)).not.toBeNull();
    expect(screen.queryByText(BODY)).toBeNull();

    act(() => vi.advanceTimersByTime(REFRESH_EVERY_MS - 1));
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(30_000 - REFRESH_EVERY_MS - 1));
    expect(mocks.refresh).toHaveBeenCalledTimes(REFRESH_TIMES - 1);
    expect(screen.queryByText(BODY)).toBeNull();

    // The tenth refresh, at 30 s, is the last.
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(REFRESH_TIMES);
    expect(screen.getByText(BODY)).toBeTruthy();
    expect(spinner(container)).toBeNull();

    act(() => vi.advanceTimersByTime(60_000));
    expect(mocks.refresh).toHaveBeenCalledTimes(REFRESH_TIMES);
  });

  it("stops refreshing once it unmounts (the page moved on)", () => {
    const { unmount } = render(<RefreshingMessage title={TITLE} body={BODY} />);
    act(() => vi.advanceTimersByTime(2 * REFRESH_EVERY_MS));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the heading's name the title: the spinner is hidden", () => {
    const { container } = render(
      <RefreshingMessage title={TITLE} body={BODY} />,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe(TITLE);
    expect(
      spinner(container)?.closest("[aria-hidden]")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});
