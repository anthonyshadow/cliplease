// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LicenseDownloads, PREPARING_MS } from "./license-downloads";

const ORIGINAL = {
  href: `/api/licenses/${"a".repeat(43)}/original`,
  type: "MP4",
  bytes: 84 * 1024 ** 2,
};
const PDF = `/api/licenses/${"a".repeat(43)}/pdf`;

const downloads = (status: "valid" | "expired" = "valid", failed = false) =>
  render(
    <LicenseDownloads
      status={status}
      original={ORIGINAL}
      pdfHref={PDF}
      failed={failed}
    />,
  );

const ORIGINAL_NAME = "Download original · MP4 · 84 MB";
const PDF_NAME = "Download license PDF";
const link = (name: string) => screen.getByRole("link", { name });

const press = (target: HTMLElement, init: MouseEventInit = {}) =>
  act(() => {
    fireEvent.click(target, init);
  });

const FAILED_LINE = "Couldn't start the download. Try again.";
/** Where a failed route sends the buyer (Q-185); any /l path will do, the line reads only the query. */
const SENT_BACK = "/l/back?download=failed";

/** The page stays put, as it does for a download: the click is stopped after the link's own handlers ran. */
const stay = (event: Event) => event.preventDefault();
beforeEach(() => {
  window.addEventListener("click", stay);
  // jsdom lays nothing out, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  window.removeEventListener("click", stay);
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("LicenseDownloads (05 §4.4 callouts 5–6; owner answer Q-185)", () => {
  it("offers the original as the primary, then the PDF, as plain full-width links", () => {
    downloads();
    const [original, pdf] = screen.getAllByRole("link");
    expect(original).toBe(link(ORIGINAL_NAME));
    expect(original.getAttribute("href")).toBe(ORIGINAL.href);
    expect(original.getAttribute("data-variant")).toBe("primary");
    expect(pdf).toBe(link(PDF_NAME));
    expect(pdf.getAttribute("href")).toBe(PDF);
    expect(pdf.getAttribute("data-variant")).toBe("secondary");
    for (const link of [original, pdf]) {
      expect(link.tagName).toBe("A");
      expect(link.classList.contains("w-full")).toBe(true);
    }
  });

  it("keeps only the PDF, as the primary, once the license has expired (07 D16)", () => {
    downloads("expired");
    expect(
      screen.getByText("Expired. Only the license PDF stays available."),
    ).toBeTruthy();
    expect(screen.getAllByRole("link")).toEqual([link(PDF_NAME)]);
    expect(link(PDF_NAME).getAttribute("href")).toBe(PDF);
    expect(link(PDF_NAME).getAttribute("data-variant")).toBe("primary");
  });

  it("reads Preparing… for a fixed time after a tap, ignoring further taps", () => {
    vi.useFakeTimers();
    downloads();
    const original = link(ORIGINAL_NAME);
    press(original);
    expect(original.getAttribute("aria-busy")).toBe("true");
    // Button's loading layer; the label beside it is `invisible`, which jsdom doesn't apply.
    expect(original.textContent).toContain("Preparing…");
    const again = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      original.dispatchEvent(again);
    });
    expect(again.defaultPrevented).toBe(true);
    act(() => vi.advanceTimersByTime(PREPARING_MS));
    expect(original.getAttribute("aria-busy")).toBeNull();
  });

  it("leaves a new-tab click to the browser, with no Preparing…", () => {
    downloads();
    const pdf = link(PDF_NAME);
    press(pdf, { metaKey: true });
    expect(pdf.getAttribute("aria-busy")).toBeNull();
  });

  it("shows the label again when the page comes back from the back-forward cache", () => {
    downloads();
    const pdf = link(PDF_NAME);
    press(pdf);
    expect(pdf.getAttribute("aria-busy")).toBe("true");
    act(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });
    expect(pdf.getAttribute("aria-busy")).toBeNull();
  });

  it("says the download didn't start, under the buttons, only after a route sent the buyer back", () => {
    downloads();
    expect(screen.queryByText(FAILED_LINE)).toBeNull();
    cleanup();
    downloads("valid", true);
    const line = screen.getByText(FAILED_LINE);
    expect(
      link(PDF_NAME).compareDocumentPosition(line) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lands on the line: scrolled to the middle of the view and focused, with no live role", () => {
    downloads("valid", true);
    const line = screen.getByText(FAILED_LINE);
    expect(line.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).toBe(line);
    expect(line.getAttribute("tabindex")).toBe("-1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the line on a plain click on either download, not on a new-tab click", () => {
    downloads("valid", true);
    press(link(PDF_NAME), { metaKey: true });
    expect(screen.getByText(FAILED_LINE)).toBeTruthy();
    press(link(PDF_NAME));
    expect(screen.queryByText(FAILED_LINE)).toBeNull();
    cleanup();
    downloads("valid", true);
    press(link(ORIGINAL_NAME));
    expect(screen.queryByText(FAILED_LINE)).toBeNull();
  });

  it("drops ?download=failed from the address right after the mount, keeping the rest (a one-shot signal)", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", `${SENT_BACK}&x=1#top`);
    downloads("valid", true);
    // In a timeout, after the router's own mount effect (StripConnectParams).
    expect(window.location.search).toBe("?download=failed&x=1");
    act(() => vi.runOnlyPendingTimers());
    expect(window.location.pathname).toBe("/l/back");
    expect(window.location.search).toBe("?x=1");
    expect(window.location.hash).toBe("#top");
    expect(screen.getByText(FAILED_LINE)).toBeTruthy();
  });
});
