// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/app-name";
import type { LicenseSnapshotV1 } from "@/lib/licensing/snapshot";
import {
  FIRST_SNOW,
  INSTAGRAM_VERIFIED,
  SNAPCHAT_NO_LINK,
  US_SCOPE,
} from "../../../tests/helpers/license-snapshot-fixtures";
import { LicenseDelivery } from "./license-delivery";

const KEY = "a".repeat(43);
const VERIFY_URL = "http://localhost:3000/verify/CL-7K3M-9QXA";

const SNAPSHOT: LicenseSnapshotV1 = {
  ...FIRST_SNOW,
  postings: [INSTAGRAM_VERIFIED, SNAPCHAT_NO_LINK],
  scope: US_SCOPE,
};

type Props = ComponentProps<typeof LicenseDelivery>;

const PROPS: Props = {
  snapshot: SNAPSHOT,
  status: "valid",
  revokedAt: null,
  original: { type: "MP4", bytes: 84 * 1024 ** 2 },
  territoryCode: "US",
  amountTotalCents: 173_250,
  maskedEmail: "s…@dailylaughs.com",
  links: {
    original: `/api/licenses/${KEY}/original`,
    pdf: `/api/licenses/${KEY}/pdf`,
    verify: VERIFY_URL,
  },
  fresh: false,
  downloadFailed: false,
};

const page = (over: Partial<Props> = {}) =>
  render(<LicenseDelivery {...PROPS} {...over} />);
const heading = () => screen.getByRole("heading", { level: 1 });
const link = (name: string) => screen.queryByRole("link", { name });

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  // jsdom lays nothing out, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LicenseDelivery, /l (05 §4.4; 04 §10.2)", () => {
  it("opens with the static seal, the two-tone headline and the approval line in UTC", () => {
    const { container } = page();
    const seal = container.querySelector("svg");
    expect(seal?.getAttribute("width")).toBe("72");
    expect(seal?.getAttribute("class")).toContain("lg:size-22");
    expect(heading().textContent).toBe("Cleared. Yours to post.");
    expect(heading().getAttribute("tabindex")).toBe("-1");
    expect(heading().querySelector(".text-ink-2")?.textContent).toBe(
      "Yours to post.",
    );
    expect(
      screen.getByText("@maya approved your request · 15 Oct 2026, 14:32 UTC"),
    ).toBeTruthy();
  });

  it("moves the focus to the headline only for a license issued in the last 24 h (05 §4.4 Fresh)", () => {
    page();
    expect(document.activeElement).not.toBe(heading());
    cleanup();
    page({ fresh: true });
    expect(document.activeElement).toBe(heading());
  });

  it("lays out 04 §10.2's order: card, downloads, credit, postings, summary, verify link, receipt", () => {
    page();
    const order = [
      screen.getByRole("region", { name: "First snow" }),
      screen.getByRole("link", { name: "Download original · MP4 · 84 MB" }),
      screen.getByRole("link", { name: "Download license PDF" }),
      screen.getByText("Credit when you post"),
      screen.getByRole("region", { name: "Where it was posted" }),
      screen.getByRole("button", { name: "What you can do" }),
      screen.getByText("Anyone can check this license:"),
      screen.getByText(/^Paid CA\$1,732\.50 on 15 Oct 2026\./),
    ];
    order.slice(1).forEach((next, i) => {
      expect(
        order[i].compareDocumentPosition(next) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("copies the credit line, shares the verify link and masks the receipt's email", () => {
    page();
    expect(screen.getByText("Video: @maya.films on Instagram")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy credit line" }),
    ).toBeTruthy();
    expect(screen.getByText(VERIFY_URL)).toBeTruthy();
    expect(
      screen.getByText(
        "Paid CA$1,732.50 on 15 Oct 2026. Receipt sent to s…@dailylaughs.com. Questions? Reply to the license email.",
      ),
    ).toBeTruthy();
  });

  it("lists Where it was posted from the snapshot, a hidden link as Also posted on (07 D71)", () => {
    page();
    expect(screen.getByText(/^Also posted on/)).toBeTruthy();
  });

  it("folds the summary under What you can do, with the request's territory and no Prices in line (07 D98)", async () => {
    const { container } = page();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "What you can do" })),
    );
    expect(container.textContent).toContain("in the United States");
    expect(container.textContent).toContain("until 15 Oct 2027, 14:32 UTC");
    expect(container.textContent).not.toContain("Prices in");
    expect(container.textContent).not.toContain("from approval");
  });

  it("shows the music and people notices only when the record flags them", () => {
    page();
    expect(screen.queryByText("Music not included.")).toBeNull();
    cleanup();
    page({
      snapshot: { ...SNAPSHOT, exclusions: { music: true, people: true } },
    });
    expect(screen.getByText("Music not included.")).toBeTruthy();
    expect(screen.getByText(/^People in this video/)).toBeTruthy();
  });

  it("keeps only the PDF, as the primary, once expired", () => {
    page({ status: "expired" });
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(link("Download original · MP4 · 84 MB")).toBeNull();
    expect(link("Download license PDF")?.getAttribute("data-variant")).toBe(
      "primary",
    );
  });

  it("replaces both downloads with the revoke message, the date in UTC and no reason (Q-186)", () => {
    page({
      status: "revoked",
      revokedAt: new Date("2026-10-20T09:15:00.000Z"),
    });
    expect(screen.getByText("Revoked")).toBeTruthy();
    expect(link("Download original · MP4 · 84 MB")).toBeNull();
    expect(link("Download license PDF")).toBeNull();
    expect(screen.getByText("Revoked on 20 Oct 2026, 09:15 UTC.")).toBeTruthy();
    expect(
      screen.getByText(
        `This license no longer allows any use of this video. Questions? ${SUPPORT_EMAIL}`,
      ),
    ).toBeTruthy();
  });

  it("says a download didn't start when a route sent the buyer back", () => {
    page({ downloadFailed: true });
    expect(
      screen.getByText("Couldn't start the download. Try again."),
    ).toBeTruthy();
  });

  it("lands a fresh license sent back from a failed download on that line, not the headline (Q-185)", () => {
    page({ fresh: true, downloadFailed: true });
    const line = screen.getByText("Couldn't start the download. Try again.");
    expect(document.activeElement).toBe(line);
    expect(heading().getAttribute("tabindex")).toBe("-1");
    expect(window.scrollTo).not.toHaveBeenCalled();
    cleanup();
    // A revoked license has no downloads, so no line: the headline keeps the focus.
    page({
      fresh: true,
      downloadFailed: true,
      status: "revoked",
      revokedAt: new Date("2026-10-20T09:15:00.000Z"),
    });
    expect(document.activeElement).toBe(heading());
  });

  it("prints the exclusive rights row for an exclusive license (07 D113)", () => {
    page({ snapshot: { ...SNAPSHOT, exclusive: true } });
    expect(
      screen.getByText("Exclusive until 15 Oct 2027, 14:32 UTC"),
    ).toBeTruthy();
  });

  it("never prints the key outside the download links", () => {
    const { container } = page();
    const hrefs = Array.from(container.querySelectorAll("a[href]"), (a) =>
      a.getAttribute("href"),
    ).filter((href) => href?.includes(KEY));
    expect(hrefs).toEqual([PROPS.links.original, PROPS.links.pdf]);
    expect(container.textContent).not.toContain(KEY);
  });
});
