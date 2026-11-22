// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { Toaster } from "@/components/ui/toast";
import { DISABLE_COPY, ENABLE_COPY } from "@/lib/admin/copy";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";
import { LIVE_VIDEO, video } from "../../../../tests/helpers/admin-fixtures";
import { type AdminVideoAction, VideoRowAction } from "./video-row-action";

const mocks = vi.hoisted(() => ({
  adminDisableVideo: vi.fn(),
  adminEnableVideo: vi.fn(),
}));
vi.mock("@/app/admin/actions", () => ({
  adminDisableVideo: mocks.adminDisableVideo,
  adminEnableVideo: mocks.adminEnableVideo,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const VIDEO_ID = LIVE_VIDEO.id;

function Row({ row }: { row: AdminVideoAction }) {
  return (
    <>
      <VideoRowAction video={row} />
      <Toaster />
    </>
  );
}

const sheet = () => screen.getByRole("alertdialog");
const noSheet = () => screen.queryByRole("alertdialog");
const inSheet = () => within(sheet());
const reasonField = () =>
  inSheet().getByRole<HTMLSelectElement>("combobox", { name: "Reason" });
const noteField = () =>
  inSheet().getByRole<HTMLTextAreaElement>("textbox", {
    name: "Note (optional)",
  });
/** A button's words as a screen reader gets them while it is idle: without its hidden loading layer. */
function label(button: Element): string {
  const copy = button.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) {
    hidden.remove();
  }
  return copy.textContent ?? "";
}
/** The footer's buttons, primary first as the sheet lays them out below md (the header's ✕ is not one of them). */
const footerButtons = () => [
  ...sheet().querySelectorAll<HTMLButtonElement>("button[data-variant]"),
];
const footer = () =>
  footerButtons().map((b) => [label(b), b.getAttribute("data-variant")]);
/** Pressed and waiting: busy, its loading layer ("Disabling…") no longer hidden. */
function expectLoading(button: HTMLElement, loadingLabel: string) {
  expect(button.getAttribute("aria-busy")).toBe("true");
  const layer = [...button.querySelectorAll('[aria-hidden="false"]')].find(
    (el) => el.textContent === loadingLabel,
  );
  expect(layer).toBeTruthy();
}
/** The newest toast: the Toaster's last list item (the store outlives a test, so never a count). */
const latestToast = () =>
  [...document.querySelectorAll("ol > li")].at(-1)?.textContent ?? null;
const toastCount = () => document.querySelectorAll("ol > li").length;

function openDisable() {
  fireEvent.click(screen.getByRole("button", { name: "Disable First snow" }));
  return sheet();
}

function choose(reason: string) {
  fireEvent.change(reasonField(), { target: { value: reason } });
}

async function press(name: string) {
  await act(async () => {
    fireEvent.click(inSheet().getByRole("button", { name }));
  });
}

/** Holds back the mocked action's answer: returns the call that gives it. */
function holdAnswer(action: Mock) {
  let answer: (value: unknown) => void = () => {};
  action.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  return (value: unknown) =>
    act(async () => {
      answer(value);
    });
}

/**
 * Disable's answer: `stillOpen` requests left, `capturing` payments already going through (Q-202), the video still
 * disabled unless another admin enabled it meanwhile.
 */
const disabled = (
  stillOpen: number,
  { capturing = 0, stillDisabled = true } = {},
) => ({
  ok: true,
  data: { stillOpen, capturing, disabled: stillDisabled },
});

describe("VideoRowAction (05 §7 callout 5; design §4.11)", () => {
  it.each([
    ["published", "Disable", "Disable First snow"],
    ["unpublished", "Disable", "Disable First snow"],
    ["draft", "Disable", "Disable First snow"],
    ["disabled", "Enable", "Enable First snow"],
  ] as const)(
    "a %s video's row offers %s, named by its title",
    (status, label, name) => {
      render(<Row row={video(status)} />);
      const button = screen.getByRole("button", { name });
      expect(button.textContent).toBe(label);
      expect(button.getAttribute("data-variant")).toBe("secondary");
      expect(noSheet()).toBeNull();
    },
  );
});

describe("The Disable sheet (05 §7 callout 6; design §6.8; owner answers Q-198 a, Q-199 a, Q-201–Q-203)", () => {
  it.each([0, 1, 2])(
    "asks with the body for %i waiting requests, a reason to choose and the optional note",
    (n) => {
      render(<Row row={video("published", n)} />);
      const dialog = openDisable();
      expect(
        within(dialog).getByRole("heading", { name: "Disable First snow?" }),
      ).toBeTruthy();
      expect(dialog.textContent).toContain(DISABLE_COPY.body(n));
      expect(
        [...reasonField().options].map((o) => [o.value, o.textContent]),
      ).toEqual([
        ["", "Choose a reason"],
        ["rights_claim", "Rights claim"],
        ["prohibited_content", "Prohibited content"],
        ["other", "Other"],
      ]);
      expect(reasonField().value).toBe("");
      expect(noteField().maxLength).toBe(200);
      expect(dialog.textContent).toContain(DISABLE_COPY.noteHelper);
      expect(footer()).toEqual([
        ["Disable video", "destructive"],
        ["Keep it live", "secondary"],
      ]);
      // The safe button takes the first focus.
      expect(document.activeElement?.textContent).toBe("Keep it live");
    },
  );

  it("refuses without a reason: the field's error, the focus on it, and no call", async () => {
    render(<Row row={video()} />);
    openDisable();
    await press("Disable video");
    expect(mocks.adminDisableVideo).not.toHaveBeenCalled();
    expect(reasonField().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(reasonField());
    const errorId = reasonField()
      .getAttribute("aria-describedby")
      ?.split(" ")[0];
    expect(document.getElementById(errorId ?? "")?.textContent).toBe(
      "Choose a reason.",
    );
    choose("rights_claim");
    expect(reasonField().getAttribute("aria-invalid")).toBeNull();
  });

  it("shows the server's error on the reason when it refuses one", async () => {
    mocks.adminDisableVideo.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Choose a reason.",
        fields: { reason: ["Choose a reason."] },
      },
    });
    render(<Row row={video()} />);
    openDisable();
    choose("other");
    await press("Disable video");
    expect(reasonField().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(reasonField());
    expect(inSheet().queryByRole("alert")).toBeNull();
  });

  it("disables with the reason and note, can't be closed while “Disabling…”, then closes with the toast", async () => {
    const answer = holdAnswer(mocks.adminDisableVideo);
    render(<Row row={video()} />);
    openDisable();
    choose("rights_claim");
    fireEvent.change(noteField(), { target: { value: "ticket-4821" } });
    const confirm = inSheet().getByRole("button", { name: "Disable video" });
    await press("Disable video");
    expect(mocks.adminDisableVideo).toHaveBeenCalledExactlyOnceWith({
      videoId: VIDEO_ID,
      reason: "rights_claim",
      note: "ticket-4821",
    });
    expectLoading(confirm, DISABLE_COPY.pending);
    fireEvent.click(confirm);
    expect(mocks.adminDisableVideo).toHaveBeenCalledTimes(1);
    fireEvent.click(inSheet().getByRole("button", { name: "Keep it live" }));
    fireEvent.click(inSheet().getByRole("button", { name: "Close" }));
    fireEvent.keyDown(sheet(), { key: "Escape" });
    expect(sheet()).toBeTruthy();
    await answer(disabled(0));
    await waitFor(() => expect(noSheet()).toBeNull());
    expect(latestToast()).toBe("Video disabled.");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Disable First snow" }),
    );
  });

  it("keeps everything on a failure, with the error Banner in the sheet", async () => {
    mocks.adminDisableVideo.mockResolvedValueOnce({
      ok: false,
      error: { code: "failed", message: GENERIC_ERROR_MESSAGE },
    });
    render(<Row row={video()} />);
    openDisable();
    choose("rights_claim");
    fireEvent.change(noteField(), { target: { value: "ticket-4821" } });
    await press("Disable video");
    expect(inSheet().getByRole("alert").textContent).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(reasonField().value).toBe("rights_claim");
    expect(noteField().value).toBe("ticket-4821");
    expect(footer()[0]).toEqual(["Disable video", "destructive"]);
  });

  it("stays open when the sweep left requests waiting: the warning above the still-open body, now the description, the reason and note read-only, Close and Try again", async () => {
    mocks.adminDisableVideo.mockResolvedValueOnce(disabled(1));
    const view = render(<Row row={video()} />);
    openDisable();
    expect(
      screen.getByRole("alertdialog", { description: DISABLE_COPY.body(2) }),
    ).toBe(sheet());
    choose("other");
    fireEvent.change(noteField(), { target: { value: "ticket-4821" } });
    const toasts = toastCount();
    await press("Disable video");
    expect(toastCount()).toBe(toasts);
    const warning = inSheet().getByRole("status");
    expect(warning.textContent).toBe("1 waiting request is still open.");
    expect(
      screen.getByRole("alertdialog", {
        description: DISABLE_COPY.stillOpenBody(1),
      }),
    ).toBe(sheet());
    // The warning sits above the description, outside it.
    const description = document.getElementById(
      sheet().getAttribute("aria-describedby") ?? "",
    );
    expect(description?.textContent).toBe(DISABLE_COPY.stillOpenBody(1));
    expect(
      warning.compareDocumentPosition(description as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(sheet().textContent).not.toContain(DISABLE_COPY.body(2));
    expect(sheet().textContent).not.toContain(DISABLE_COPY.noteHelper);
    expect(reasonField().disabled).toBe(true);
    expect(reasonField().value).toBe("other");
    expect(noteField().readOnly).toBe(true);
    expect(noteField().value).toBe("ticket-4821");
    expect(footer()).toEqual([
      ["Try again", "primary"],
      ["Close", "secondary"],
    ]);

    // The refresh turns the row's button to Enable; the sheet stays.
    view.rerender(<Row row={video("disabled", 1)} />);
    expect(sheet().textContent).toContain(DISABLE_COPY.stillOpen(1));

    // Each Try again that leaves requests open is a new warning, read out again even when its words are the same.
    mocks.adminDisableVideo.mockResolvedValueOnce(disabled(1));
    await press("Try again");
    const again = inSheet().getByRole("status");
    expect(again.textContent).toBe("1 waiting request is still open.");
    expect(again).not.toBe(warning);
    expect(warning.isConnected).toBe(false);

    mocks.adminDisableVideo.mockResolvedValueOnce(disabled(2));
    await press("Try again");
    expect(inSheet().getByRole("status").textContent).toBe(
      "2 waiting requests are still open.",
    );
    expect(
      screen.getByRole("alertdialog", {
        description: DISABLE_COPY.stillOpenBody(2),
      }),
    ).toBe(sheet());
    mocks.adminDisableVideo.mockResolvedValueOnce(disabled(0));
    await press("Try again");
    // Disable once, then each Try again the sweep alone, with the same reason and note.
    const fields = { videoId: VIDEO_ID, reason: "other", note: "ticket-4821" };
    expect(mocks.adminDisableVideo.mock.calls).toEqual([
      [fields],
      [{ ...fields, sweepOnly: true }],
      [{ ...fields, sweepOnly: true }],
      [{ ...fields, sweepOnly: true }],
    ]);
    await waitFor(() => expect(noSheet()).toBeNull());
    expect(latestToast()).toBe("Video disabled.");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Enable First snow" }),
    );
  });

  it.each([
    ["Disable", [], disabled(1, { stillDisabled: false })],
    [
      "Disable, a capture left",
      [],
      disabled(0, { capturing: 1, stillDisabled: false }),
    ],
    ["Try again", [disabled(1)], disabled(1, { stillDisabled: false })],
  ] as const)(
    "closes with no toast when %s finds the video no longer disabled (another admin's Enable): the refreshed row shows the truth",
    async (_, before, last) => {
      for (const answer of before) {
        mocks.adminDisableVideo.mockResolvedValueOnce(answer);
      }
      mocks.adminDisableVideo.mockResolvedValueOnce(last);
      render(<Row row={video()} />);
      openDisable();
      choose("rights_claim");
      const toasts = toastCount();
      await press("Disable video");
      if (before.length > 0) await press("Try again");
      await waitFor(() => expect(noSheet()).toBeNull());
      expect(toastCount()).toBe(toasts);
      expect(mocks.adminDisableVideo).toHaveBeenCalledTimes(before.length + 1);
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Disable First snow" }),
      );
    },
  );

  it.each([1, 2])(
    "with only captures left (%i), stays open with the capturing line alone, no description, and Close as the one button, focused (Q-202)",
    async (n) => {
      mocks.adminDisableVideo.mockResolvedValueOnce(
        disabled(0, { capturing: n }),
      );
      render(<Row row={video()} />);
      openDisable();
      choose("rights_claim");
      fireEvent.change(noteField(), { target: { value: "ticket-4821" } });
      const toasts = toastCount();
      await press("Disable video");
      expect(toastCount()).toBe(toasts);
      expect(inSheet().getByRole("status").textContent).toBe(
        DISABLE_COPY.capturing(n),
      );
      expect(sheet().hasAttribute("aria-describedby")).toBe(false);
      expect(sheet().textContent).not.toContain(DISABLE_COPY.body(2));
      expect(sheet().textContent).not.toContain(DISABLE_COPY.stillOpen(1));
      expect(sheet().textContent).not.toContain(DISABLE_COPY.stillOpenBody(1));
      expect(sheet().textContent).not.toContain(DISABLE_COPY.stillOpenBody(2));
      expect(reasonField().disabled).toBe(true);
      expect(noteField().readOnly).toBe(true);
      expect(footer()).toEqual([["Close", "secondary"]]);
      expect(document.activeElement).toBe(footerButtons()[0]);
      fireEvent.click(footerButtons()[0] as HTMLButtonElement);
      await waitFor(() => expect(noSheet()).toBeNull());
      expect(toastCount()).toBe(toasts);
      expect(mocks.adminDisableVideo).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Disable First snow" }),
      );
    },
  );

  it("with requests still open and a capture, warns with both lines over the still-open body and keeps Try again; a Try again that leaves only the capture drops it (Q-202)", async () => {
    mocks.adminDisableVideo.mockResolvedValueOnce(
      disabled(2, { capturing: 1 }),
    );
    render(<Row row={video("published", 3)} />);
    openDisable();
    choose("other");
    await press("Disable video");
    const warning = inSheet().getByRole("status");
    expect(warning.textContent).toBe(
      `${DISABLE_COPY.stillOpen(2)} ${DISABLE_COPY.capturing(1)}`,
    );
    expect(
      screen.getByRole("alertdialog", {
        description: DISABLE_COPY.stillOpenBody(2),
      }),
    ).toBe(sheet());
    expect(footer()).toEqual([
      ["Try again", "primary"],
      ["Close", "secondary"],
    ]);

    mocks.adminDisableVideo.mockResolvedValueOnce(
      disabled(1, { capturing: 1 }),
    );
    await press("Try again");
    expect(inSheet().getByRole("status").textContent).toBe(
      `${DISABLE_COPY.stillOpen(1)} ${DISABLE_COPY.capturing(1)}`,
    );
    expect(
      screen.getByRole("alertdialog", {
        description: DISABLE_COPY.stillOpenBody(1),
      }),
    ).toBe(sheet());

    mocks.adminDisableVideo.mockResolvedValueOnce(
      disabled(0, { capturing: 1 }),
    );
    await press("Try again");
    const last = inSheet().getByRole("status");
    expect(last.textContent).toBe(DISABLE_COPY.capturing(1));
    expect(last).not.toBe(warning);
    expect(sheet().hasAttribute("aria-describedby")).toBe(false);
    expect(footer()).toEqual([["Close", "secondary"]]);
    expect(document.activeElement).toBe(footerButtons()[0]);
    const fields = { videoId: VIDEO_ID, reason: "other", note: "" };
    expect(mocks.adminDisableVideo.mock.calls).toEqual([
      [fields],
      [{ ...fields, sweepOnly: true }],
      [{ ...fields, sweepOnly: true }],
    ]);
  });

  it("closes from the still-open state with Close, and shows a failed Try again's error", async () => {
    mocks.adminDisableVideo.mockResolvedValueOnce(disabled(1));
    render(<Row row={video()} />);
    openDisable();
    choose("prohibited_content");
    await press("Disable video");
    mocks.adminDisableVideo.mockResolvedValueOnce({
      ok: false,
      error: { code: "failed", message: GENERIC_ERROR_MESSAGE },
    });
    await press("Try again");
    expect(inSheet().getByRole("alert").textContent).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(inSheet().getByRole("status").textContent).toBe(
      DISABLE_COPY.stillOpen(1),
    );
    const close = footerButtons().find((b) => label(b) === "Close");
    fireEvent.click(close as HTMLButtonElement);
    await waitFor(() => expect(noSheet()).toBeNull());
  });

  it("starts afresh each time it opens", () => {
    render(<Row row={video()} />);
    openDisable();
    choose("other");
    fireEvent.change(noteField(), { target: { value: "draft note" } });
    fireEvent.click(inSheet().getByRole("button", { name: "Keep it live" }));
    openDisable();
    expect(reasonField().value).toBe("");
    expect(noteField().value).toBe("");
  });
});

describe("The Enable sheet (design §6.9; owner answer Q-199 a)", () => {
  function openEnable() {
    fireEvent.click(screen.getByRole("button", { name: "Enable First snow" }));
    return sheet();
  }

  it("asks with its body and a primary confirm", () => {
    render(<Row row={video("disabled", 0)} />);
    const dialog = openEnable();
    expect(
      within(dialog).getByRole("heading", { name: "Enable First snow?" }),
    ).toBeTruthy();
    expect(dialog.textContent).toContain(ENABLE_COPY.body);
    expect(footer()).toEqual([
      ["Enable video", "primary"],
      ["Keep it disabled", "secondary"],
    ]);
    expect(within(dialog).queryByRole("combobox")).toBeNull();
  });

  it("enables, can't be closed while “Enabling…”, then closes with the toast", async () => {
    const answer = holdAnswer(mocks.adminEnableVideo);
    render(<Row row={video("disabled", 0)} />);
    openEnable();
    const confirm = inSheet().getByRole("button", { name: "Enable video" });
    await press("Enable video");
    expect(mocks.adminEnableVideo).toHaveBeenCalledExactlyOnceWith({
      videoId: VIDEO_ID,
    });
    expectLoading(confirm, ENABLE_COPY.pending);
    fireEvent.click(
      inSheet().getByRole("button", { name: "Keep it disabled" }),
    );
    expect(sheet()).toBeTruthy();
    await answer({ ok: true, data: undefined });
    await waitFor(() => expect(noSheet()).toBeNull());
    expect(latestToast()).toBe("Video enabled.");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Enable First snow" }),
    );
  });

  it("stays open with the error Banner on a failure", async () => {
    mocks.adminEnableVideo.mockResolvedValueOnce({
      ok: false,
      error: { code: "not_found", message: GENERIC_ERROR_MESSAGE },
    });
    render(<Row row={video("disabled", 0)} />);
    openEnable();
    await press("Enable video");
    expect(inSheet().getByRole("alert").textContent).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(footer()[0]).toEqual(["Enable video", "primary"]);
  });

  it("shows the generic error when the action itself fails (offline, a timeout)", async () => {
    mocks.adminEnableVideo.mockRejectedValueOnce(new Error("offline"));
    render(<Row row={video("disabled", 0)} />);
    openEnable();
    await press("Enable video");
    expect(inSheet().getByRole("alert").textContent).toBe(
      GENERIC_ERROR_MESSAGE,
    );
  });
});
