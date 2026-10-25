// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateVideoDetails } from "@/app/(dashboard)/dashboard/videos/[id]/review-actions";
import type { ActionResult } from "@/lib/result";
import { SLUG_COPY } from "@/lib/validation/video";
import { ReviewDetails } from "./review-details";

vi.mock("@/app/(dashboard)/dashboard/videos/[id]/review-actions", () => ({
  updateVideoDetails: vi.fn(),
}));

const save = vi.mocked(updateVideoDetails);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const VIDEO_ID = "00000000-0000-4000-8000-000000000002";
const PROPS = {
  videoId: VIDEO_ID,
  title: "Snow day",
  slug: "snow-day",
  handle: "maya",
  slugLocked: false,
  facts: [],
};

const editName = (row: "title" | "link") => `Edit ${row}`;
const edit = (row: "title" | "link") =>
  fireEvent.click(screen.getByRole("button", { name: editName(row) }));
const field = (name: "Title" | "Link") =>
  screen.getByRole("textbox", { name }) as HTMLInputElement;

describe("ReviewDetails (05 §6.5 callouts 43–44; 07 D09, D23)", () => {
  it("edits the title in place and sends that field alone, then gives the focus back to its Edit", async () => {
    save.mockResolvedValue({ ok: true, data: undefined });
    render(<ReviewDetails {...PROPS} />);
    edit("title");
    expect(document.activeElement).toBe(field("Title"));
    expect(screen.queryByRole("button", { name: editName("link") })).toBeNull();
    fireEvent.change(field("Title"), { target: { value: "Storm" } });
    fireEvent.submit(field("Title"));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: editName("title") }),
      ),
    );
    expect(save).toHaveBeenCalledExactlyOnceWith({
      videoId: VIDEO_ID,
      title: "Storm",
    });
  });

  it("announces a refusal and keeps the focus on the field", async () => {
    save.mockResolvedValue({
      ok: false,
      error: {
        code: "slug_taken",
        message: SLUG_COPY.taken,
        fields: { slug: [SLUG_COPY.taken] },
      },
    });
    render(<ReviewDetails {...PROPS} />);
    edit("link");
    fireEvent.submit(field("Link"));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      SLUG_COPY.taken,
    );
    expect(field("Link").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field("Link"));
  });

  it("keeps the row open while a save runs: Cancel is off and Escape waits", async () => {
    let finish: (result: ActionResult) => void = () => {};
    save.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<ReviewDetails {...PROPS} />);
    edit("title");
    fireEvent.submit(field("Title"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled"),
      ).toBe(true),
    );
    fireEvent.keyDown(field("Title"), { key: "Escape" });
    expect(field("Title")).toBeTruthy();
    await act(async () => finish({ ok: true, data: undefined }));
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
  });

  it("reads the link as locked, with no Edit, once published (05 §6.7 callout 5)", () => {
    render(<ReviewDetails {...PROPS} slugLocked />);
    expect(screen.getByText("/@maya/snow-day (locked)")).toBeTruthy();
    expect(screen.queryByText("Can't change after you publish.")).toBeNull();
    expect(screen.queryByRole("button", { name: editName("link") })).toBeNull();
    expect(
      screen.getByRole("button", { name: editName("title") }),
    ).toBeTruthy();
  });
});
