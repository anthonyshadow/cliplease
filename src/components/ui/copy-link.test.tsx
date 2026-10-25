// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyLinkButton } from "./copy-link-button";
import { CopyLinkField } from "./copy-link-field";
import { ShareButton } from "./share-button";

const URL_ = "http://localhost:3000/@maya/snow-day";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function clipboard(writeText: () => Promise<void>) {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
}

describe("CopyLinkField (04 §9.25)", () => {
  it("copies: “Copied” and a polite “Link copied”, back to Copy after 2 s", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    render(<CopyLinkField url={URL_} label="Share link" />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(screen.getByRole("button").textContent).toBe("Copied");
    expect(screen.getByText("Link copied").closest("[aria-live]")).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("button").textContent).toBe("Copy");
  });

  it("without a clipboard, selects the link and says “Press and hold to copy”", async () => {
    clipboard(async () => {
      throw new Error("denied");
    });
    render(<CopyLinkField url={URL_} label="Share link" />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByText("Press and hold to copy")).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe(URL_);
  });

  it("has no Share inside the row (ShareButton sits beside it)", () => {
    render(<CopyLinkField url={URL_} label="Share link" />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("CopyLinkButton (04 §9.27)", () => {
  it("reads “Link copied” for 2 s, announced politely", async () => {
    vi.useFakeTimers();
    clipboard(async () => {});
    render(<CopyLinkButton url={URL_} label="Share link" />);
    const button = screen.getByRole("button", { name: "Copy link" });
    await act(async () => fireEvent.click(button));
    expect(button.textContent).toBe("Link copied");
    expect(
      screen
        .getAllByText("Link copied")
        .some((node) => node.closest("[aria-live]")),
    ).toBe(true);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(button.textContent).toBe("Copy link");
  });

  it("without a clipboard, shows the link selected in a read-only field", async () => {
    clipboard(async () => {
      throw new Error("denied");
    });
    render(<CopyLinkButton url={URL_} label="Share link" />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    const field = screen.getByRole("textbox", {
      name: "Share link",
    }) as HTMLInputElement;
    expect(field.value).toBe(URL_);
    expect(field.readOnly).toBe(true);
    expect(screen.getByText("Press and hold to copy")).toBeTruthy();
  });
});

describe("ShareButton (05 §6.5 callout 55)", () => {
  it("appears only where the browser can share", () => {
    const { unmount } = render(<ShareButton url={URL_} />);
    expect(screen.queryByRole("button", { name: "Share…" })).toBeNull();
    unmount();
    const share = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, share });
    render(<ShareButton url={URL_} />);
    fireEvent.click(screen.getByRole("button", { name: "Share…" }));
    expect(share).toHaveBeenCalledWith({ url: URL_ });
  });
});
