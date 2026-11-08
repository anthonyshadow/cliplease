// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getSessionUser, requireUser } from "@/server/auth/session";
import type { getBuyerLicense } from "@/server/buyers/queries";
import {
  BUYER,
  buyerLicenseDetail,
  KEY,
  LICENSE_ID,
} from "../../../../../tests/helpers/buyer-license-fixtures";
import { FIRST_SNOW } from "../../../../../tests/helpers/license-snapshot-fixtures";
import { BARE_DOLLAR } from "../../../../../tests/helpers/money";
import MyLicensePage, { generateMetadata } from "./page";

// S31 /licenses/[licenseId] (05 §4.10; 07 D126): the title only for the buyer's own license, the gate before the
// lookup, the 404 for anything else, and /l's facts and files through the session routes. The session and the lookup
// are mocked (the [int] suite and the e2e specs run them for real).
const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn<typeof getSessionUser>(),
  requireUser: vi.fn<typeof requireUser>(),
  getBuyerLicense: vi.fn<typeof getBuyerLicense>(),
}));
vi.mock("@/server/env", () => ({
  env: { APP_URL: "http://localhost:3100" },
}));
vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser,
  requireUser: mocks.requireUser,
}));
vi.mock("@/server/buyers/queries", () => ({
  getBuyerLicense: mocks.getBuyerLicense,
}));

const props = (query: Record<string, string> = {}) => ({
  params: Promise.resolve({ licenseId: LICENSE_ID }),
  searchParams: Promise.resolve(query),
});

const page = async (query: Record<string, string> = {}) =>
  render(await MyLicensePage(props(query)));

const link = (name: string) => screen.queryByRole("link", { name });

/** The facts as label → value text. */
const facts = (): Record<string, string> =>
  Object.fromEntries(
    Array.from(document.querySelectorAll("dt"), (dt) => [
      dt.textContent ?? "",
      dt.nextElementSibling?.textContent ?? "",
    ]),
  );

const PRIVATE = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

beforeEach(() => {
  mocks.getSessionUser.mockResolvedValue(BUYER);
  mocks.requireUser.mockResolvedValue(BUYER);
  mocks.getBuyerLicense.mockResolvedValue(buyerLicenseDetail());
  // jsdom lays nothing out, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("generateMetadata (07 §9.2)", () => {
  it("titles the buyer's own license with its video, never indexed, no referrer", async () => {
    await expect(generateMetadata(props())).resolves.toEqual({
      ...PRIVATE,
      title: "First snow",
    });
    expect(mocks.getBuyerLicense).toHaveBeenCalledWith(BUYER, LICENSE_ID);
  });

  it("gives another email's or an unknown license no title, so its 404 never names the video", async () => {
    mocks.getBuyerLicense.mockResolvedValue(null);
    await expect(generateMetadata(props())).resolves.toEqual(PRIVATE);
  });

  it("looks nothing up signed out, and never redirects", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    await expect(generateMetadata(props())).resolves.toEqual(PRIVATE);
    expect(mocks.getBuyerLicense).not.toHaveBeenCalled();
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });
});

describe("MyLicensePage (05 §4.10)", () => {
  it("gates on the session with the license's own path, then reads it by the session's user", async () => {
    await page();
    expect(mocks.requireUser).toHaveBeenCalledWith(`/licenses/${LICENSE_ID}`);
    expect(mocks.getBuyerLicense).toHaveBeenCalledWith(BUYER, LICENSE_ID);
  });

  it("answers the 404 for anything that isn't the buyer's license", async () => {
    mocks.getBuyerLicense.mockResolvedValue(null);
    await expect(MyLicensePage(props())).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  it("heads the page with the back link, the title, @handle · code, the pill and Standard", async () => {
    await page();
    expect(link("My licenses")?.getAttribute("href")).toBe("/licenses");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "First snow",
    );
    expect(screen.getByText("@maya ·", { exact: false }).textContent).toBe(
      "@maya · CL-7K3M-9QXA",
    );
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.queryByText("Exclusive")).toBeNull();
  });

  it("prints /l's facts with the Rights row and Paid in the snapshot's currency", async () => {
    const { container } = await page();
    const f = facts();
    expect(Object.keys(f)).toEqual([
      "License",
      "Status",
      "Use",
      "Term",
      "Territory",
      "Rights",
      "Licensed to",
      "Paid",
    ]);
    expect(f.Status).toBe("Valid");
    expect(f.Rights).toBe("Non-exclusive");
    expect(f.Paid).toBe("CA$1,732.50");
    expect(screen.getByText("CA$1,732.50").className).toContain("tabular-nums");
    expect(screen.getByText("Amounts in Canadian dollars (CAD).")).toBeTruthy();
    expect(container.textContent).not.toMatch(BARE_DOLLAR);
  });

  it("downloads through the session routes while valid, and links the public record", async () => {
    await page();
    expect(link("Download original · MP4 · 84 MB")?.getAttribute("href")).toBe(
      `/api/my/licenses/${LICENSE_ID}/original`,
    );
    expect(link("Download license PDF")?.getAttribute("href")).toBe(
      `/api/my/licenses/${LICENSE_ID}/pdf`,
    );
    expect(screen.getByText("Anyone can check this license:")).toBeTruthy();
    expect(
      screen.getByText("http://localhost:3100/verify/CL-7K3M-9QXA"),
    ).toBeTruthy();
  });

  it("keeps only the PDF once expired (07 D16)", async () => {
    mocks.getBuyerLicense.mockResolvedValue(buyerLicenseDetail("expired"));
    await page();
    expect(link("Download original · MP4 · 84 MB")).toBeNull();
    expect(link("Download license PDF")?.getAttribute("data-variant")).toBe(
      "primary",
    );
  });

  it("replaces both downloads with /l's revoke message", async () => {
    mocks.getBuyerLicense.mockResolvedValue(buyerLicenseDetail("revoked"));
    await page();
    expect(link("Download original · MP4 · 84 MB")).toBeNull();
    expect(link("Download license PDF")).toBeNull();
    expect(screen.getByText("Revoked on 20 Oct 2026, 09:15 UTC.")).toBeTruthy();
  });

  it("says a download didn't start only when a route sent the buyer back (Q-185)", async () => {
    await page({ download: "nope" });
    expect(
      screen.queryByText("Couldn't start the download. Try again."),
    ).toBeNull();
    cleanup();
    await page({ download: "failed" });
    expect(
      screen.getByText("Couldn't start the download. Try again."),
    ).toBeTruthy();
  });

  it("tags an exclusive license and reads Exclusive until its end", async () => {
    mocks.getBuyerLicense.mockResolvedValue(
      buyerLicenseDetail("valid", {
        exclusive: true,
        snapshot: { ...FIRST_SNOW, exclusive: true },
      }),
    );
    await page();
    expect(screen.getByText("Exclusive").className).toContain("bg-fill");
    expect(screen.queryByText("Standard")).toBeNull();
    expect(facts().Rights).toBe("Exclusive until 15 Oct 2027, 14:32 UTC");
  });

  it("never prints the original's storage key", async () => {
    const { container } = await page();
    expect(container.innerHTML).not.toContain(KEY);
  });
});
