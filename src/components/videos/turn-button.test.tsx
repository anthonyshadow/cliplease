// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publishVideo,
  unpublishVideo,
} from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { BLOCKERS_HEADING_ID, REVIEW_COPY } from "@/lib/videos/review";
import { FocusBlockersOnArrival } from "./focus-blockers-on-arrival";
import { TurnButton } from "./turn-button";

vi.mock("@/app/(dashboard)/dashboard/videos/[id]/actions", () => ({
  publishVideo: vi.fn(),
  unpublishVideo: vi.fn(),
}));

afterEach(cleanup);

const ID = "00000000-0000-4000-8000-000000000002";

/** The button beside the page's "Before you can publish" heading, as the video page renders them. */
function turn(props: { live: boolean; blocked: boolean }) {
  return (
    <>
      {props.blocked ? (
        <h2 id={BLOCKERS_HEADING_ID} tabIndex={-1}>
          {REVIEW_COPY.blockersTitle}
        </h2>
      ) : null}
      <TurnButton videoId={ID} {...props} />
    </>
  );
}

const heading = () =>
  screen.getByRole("heading", { name: "Before you can publish" });

describe("TurnButton (05 §6.7 callout 9)", () => {
  it("keeps the focus on the one button when Turn off leaves Turn on free", async () => {
    vi.mocked(unpublishVideo).mockResolvedValue({ ok: true, data: undefined });
    const { rerender } = render(turn({ live: true, blocked: false }));
    const button = screen.getByRole("button", { name: "Turn off" });
    button.focus();
    await act(async () => fireEvent.click(button));
    rerender(turn({ live: false, blocked: false }));
    expect(screen.getByRole("button", { name: "Turn on" })).toBe(button);
    expect(document.activeElement).toBe(button);
  });

  it("moves the focus to the blockers after a Turn off that leaves Turn on blocked", async () => {
    vi.mocked(unpublishVideo).mockResolvedValue({ ok: true, data: undefined });
    const { rerender } = render(turn({ live: true, blocked: false }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Turn off" })),
    );
    rerender(turn({ live: false, blocked: true }));
    expect(document.activeElement).toBe(heading());
  });

  it("moves the focus to the blockers once a refused Turn on lists them", async () => {
    vi.mocked(publishVideo).mockResolvedValue({
      ok: false,
      error: { code: "publish_blocked", message: REVIEW_COPY.blockersTitle },
    });
    const { rerender } = render(turn({ live: false, blocked: false }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Turn on" })),
    );
    rerender(turn({ live: false, blocked: true }));
    expect(document.activeElement).toBe(heading());
  });
});

describe("FocusBlockersOnArrival (05 §6.8: a blocked Turn on from the Videos Menu)", () => {
  it("focuses the blockers when the page opens at #publish-blockers, then drops the fragment", () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/videos/${ID}#${BLOCKERS_HEADING_ID}`,
    );
    render(
      <>
        {turn({ live: false, blocked: true })}
        <FocusBlockersOnArrival />
      </>,
    );
    expect(document.activeElement).toBe(heading());
    expect(window.location.hash).toBe("");
  });
});
