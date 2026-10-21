// @vitest-environment jsdom
// First: it mocks confirmSameVideo with a vi.fn() before the form loads.
import "./file-step-fixtures";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmSameVideo } from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { SameVideoForm } from "./file-step-same-video";

const confirm = vi.mocked(confirmSameVideo);

afterEach(() => {
  cleanup();
  confirm.mockReset();
});

const VIDEO_ID = "00000000-0000-4000-8000-000000000002";
const WARNING =
  "This file is 0:14 but the post is 0:38. Make sure it's the same video.";

const tick = () =>
  screen.getByRole<HTMLInputElement>("checkbox", {
    name: "This file is the same video as the post",
  });
const continueButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Continue" });
const helper = () => screen.queryByText("Tick the box to continue.");

async function submit() {
  await act(async () => {
    fireEvent.submit(continueButton().closest("form") as HTMLFormElement);
  });
}

describe("SameVideoForm (07 D39; owner answer Q-64 a)", () => {
  it("keeps Continue disabled with the helper until the box is ticked", () => {
    render(
      <SameVideoForm videoId={VIDEO_ID} confirmed={false} warning={null} />,
    );
    expect(tick().checked).toBe(false);
    expect(tick().required).toBe(true);
    expect(continueButton().disabled).toBe(true);
    expect(helper()?.id).toBe(
      continueButton().getAttribute("aria-describedby"),
    );

    fireEvent.click(tick());
    expect(continueButton().disabled).toBe(false);
    expect(helper()).toBeNull();
    expect(continueButton().getAttribute("aria-describedby")).toBeNull();

    fireEvent.click(tick());
    expect(continueButton().disabled).toBe(true);
    expect(helper()).not.toBeNull();
  });

  it("starts ticked when the server already stored the tick", () => {
    render(<SameVideoForm videoId={VIDEO_ID} confirmed warning={null} />);
    expect(tick().checked).toBe(true);
    expect(continueButton().disabled).toBe(false);
  });

  it("shows the duration warning above the tick, and none without one", () => {
    render(
      <SameVideoForm videoId={VIDEO_ID} confirmed={false} warning={WARNING} />,
    );
    const banner = screen.getByRole("status");
    expect(banner.textContent).toBe(WARNING);
    expect(
      banner.compareDocumentPosition(tick()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    cleanup();

    render(
      <SameVideoForm videoId={VIDEO_ID} confirmed={false} warning={null} />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("posts the video id and sameVideo=on to confirmSameVideo", async () => {
    confirm.mockResolvedValue(null);
    render(
      <SameVideoForm videoId={VIDEO_ID} confirmed={false} warning={null} />,
    );
    fireEvent.click(tick());
    await submit();

    expect(confirm).toHaveBeenCalledTimes(1);
    const form = confirm.mock.calls[0]?.[1];
    expect(form?.get("videoId")).toBe(VIDEO_ID);
    expect(form?.get("sameVideo")).toBe("on");
  });

  it("shows a missing tick on the box and moves the focus to it", async () => {
    confirm.mockResolvedValue({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Tick the box to continue.",
        fields: { sameVideo: ["Tick the box to continue."] },
      },
    });
    render(<SameVideoForm videoId={VIDEO_ID} confirmed warning={null} />);
    await submit();

    expect(tick().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(tick());
    expect(screen.getAllByText("Tick the box to continue.")).toHaveLength(1);
  });

  it("says any other refusal under Continue, as an alert", async () => {
    confirm.mockResolvedValue({
      ok: false,
      error: {
        code: "original_not_ready",
        message: "Choose the original file to continue.",
      },
    });
    render(<SameVideoForm videoId={VIDEO_ID} confirmed warning={null} />);
    await submit();

    expect(screen.getByRole("alert").textContent).toBe(
      "Choose the original file to continue.",
    );
    expect(tick().getAttribute("aria-invalid")).toBeNull();
  });
});
