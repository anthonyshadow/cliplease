// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REFRESH_EVERY_MS,
  REFRESH_TIMES,
} from "@/components/layout/refreshing-message";
import { formatDeadline } from "@/lib/format";
import { REQUEST_STATUS_COPY as COPY } from "@/lib/licensing/request-status";
import { RequestStatusView } from "./request-status-view";

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } };
});
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  useRouter: () => mocks.router,
}));

const EXPIRES_AT = "2026-10-30T19:10:00.000Z";
const props = { handle: "maya", total: "CA$1,732.50", expiresAt: EXPIRES_AT };
const viewerDeadline = () =>
  formatDeadline(
    new Date(EXPIRES_AT),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
const heading = () => screen.getByRole("heading", { level: 1 });

beforeEach(() => mocks.refresh.mockClear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RequestStatusView (05 §4.3, 01 §4.8)", () => {
  it("leaves the deadline out of the server's HTML, and names it in the viewer's zone once mounted", () => {
    const server = document.createElement("div");
    server.innerHTML = renderToString(
      <RequestStatusView view="waiting" {...props} />,
    );
    expect(server.querySelector("p")?.textContent).toBe(
      COPY.waitingBody("maya", "CA$1,732.50", null),
    );
    render(<RequestStatusView view="waiting" {...props} />);
    expect(screen.getByText(/^Your card has a hold/).textContent).toBe(
      COPY.waitingBody("maya", "CA$1,732.50", viewerDeadline()),
    );
  });

  it("names the expired deadline the same way", () => {
    render(<RequestStatusView view="expired" {...props} />);
    expect(heading().textContent).toBe("No answer in time");
    expect(screen.getByText(/didn't answer by/).textContent).toBe(
      COPY.expiredBody("maya", viewerDeadline()),
    );
  });

  it("puts the title in the h1, its children after the body", () => {
    render(
      <RequestStatusView view="approved" {...props}>
        <p>card</p>
      </RequestStatusView>,
    );
    expect(heading().textContent).toBe("Approved");
    expect(heading().getAttribute("tabindex")).toBe("-1");
    const body = screen.getByText(/^@maya approved/);
    expect(
      body.compareDocumentPosition(screen.getByText("card")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("takes no focus, doesn't scroll and doesn't fade on the first view", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<RequestStatusView view="waiting" {...props} />);
    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(heading());
    expect(heading().parentElement?.className).not.toContain(
      "animate-cross-fade",
    );
  });

  it("cross-fades a new status in, back at the top with the focus on its title", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { rerender } = render(
      <RequestStatusView view="waiting" {...props} />,
    );
    rerender(<RequestStatusView view="approved" {...props} />);
    expect(heading().textContent).toBe("Approved");
    expect(scroll).toHaveBeenCalledWith({ top: 0 });
    expect(document.activeElement).toBe(heading());
    expect(heading().parentElement?.className).toContain("animate-cross-fade");
  });

  it("keeps the focus where it is when only the countdown swaps for Processing… (same title)", () => {
    const { rerender } = render(
      <RequestStatusView view="waiting" {...props}>
        <span>Expires in 2 d 23 h</span>
      </RequestStatusView>,
    );
    rerender(
      <RequestStatusView view="waiting" {...props}>
        <span>{COPY.processing}</span>
      </RequestStatusView>,
    );
    expect(document.activeElement).not.toBe(heading());
    expect(screen.getByText(COPY.processing)).toBeTruthy();
  });

  it("checks for 30 s behind a spinner on the success URL, then says what to do", () => {
    vi.useFakeTimers();
    render(<RequestStatusView view="returning" {...props} />);
    expect(heading().textContent).toBe(COPY.finishingTitle);
    expect(heading().querySelector("svg.animate-spin")).not.toBeNull();
    expect(
      heading().querySelector("svg")?.closest("[aria-hidden]"),
    ).not.toBeNull();
    expect(screen.queryByText(COPY.finishingBody)).toBeNull();
    act(() => vi.advanceTimersByTime(REFRESH_EVERY_MS * REFRESH_TIMES));
    expect(mocks.refresh).toHaveBeenCalledTimes(REFRESH_TIMES);
    expect(screen.getByText(COPY.finishingBody)).toBeTruthy();
    expect(heading().querySelector("svg")).toBeNull();
  });

  it("shows the finishing body at once without a session id, and never refreshes", () => {
    vi.useFakeTimers();
    render(<RequestStatusView view="finishing" {...props} />);
    expect(screen.getByText(COPY.finishingBody)).toBeTruthy();
    act(() => vi.advanceTimersByTime(60_000));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("puts the static 40 px seal above the approved ending only (04 §10.2)", () => {
    const { container, rerender } = render(
      <RequestStatusView view="approved" {...props} />,
    );
    const seal = container.querySelector("svg");
    expect(seal?.getAttribute("aria-hidden")).toBe("true");
    expect(seal?.getAttribute("width")).toBe("40");
    expect(heading().textContent).toBe(COPY.approvedTitle);
    expect(
      screen.getByText(COPY.approvedBody("maya", "CA$1,732.50")),
    ).toBeTruthy();
    rerender(<RequestStatusView view="capture_failed" {...props} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
