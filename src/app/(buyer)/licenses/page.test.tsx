// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { requireUser, SessionUser } from "@/server/auth/session";
import type {
  BuyerLicenseRow,
  listBuyerLicenses,
} from "@/server/buyers/queries";
import { FIRST_SNOW } from "../../../../tests/helpers/license-snapshot-fixtures";
import MyLicensesPage, { metadata } from "./page";

// S30 /licenses (05 §4.9; 04 §9.37, §11.11): the gate, the title and the masked email over one card of rows, or the
// empty state standing for the page. The session and the query are mocked (the [int] suite runs them for real).
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn<typeof requireUser>(),
  listBuyerLicenses: vi.fn<typeof listBuyerLicenses>(),
}));
vi.mock("@/server/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/server/buyers/queries", () => ({
  listBuyerLicenses: mocks.listBuyerLicenses,
}));

const USER: SessionUser = {
  id: "user-ana",
  email: "ana.buyer@studio.com",
  name: "",
  role: "creator",
};

const row = (n: number): BuyerLicenseRow => ({
  licenseId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  videoId: FIRST_SNOW.video.id,
  code: `CL-7K3M-9QX${n}`,
  videoTitle: `Video ${n}`,
  creatorHandle: "maya",
  status: "valid",
  exclusive: false,
  startsAt: FIRST_SNOW.startsAt,
  endsAt: FIRST_SNOW.endsAt,
  renewal: null,
});

beforeEach(() => {
  mocks.requireUser.mockResolvedValue(USER);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MyLicensesPage (05 §4.9)", () => {
  it("is titled My licenses, never indexed, with no referrer", () => {
    expect(metadata).toEqual({
      title: "My licenses",
      referrer: "no-referrer",
      robots: { index: false, follow: false },
    });
  });

  it("gates on the session, then lists the session user's licenses in the query's order", async () => {
    mocks.listBuyerLicenses.mockResolvedValue([row(2), row(1)]);
    render(await MyLicensesPage());
    expect(mocks.requireUser).toHaveBeenCalledWith("/licenses");
    expect(mocks.listBuyerLicenses).toHaveBeenCalledWith(USER);
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.textContent).toBe("My licenses. Everything you've licensed.");
    expect(title.querySelector(".text-ink-2")?.textContent).toBe(
      "Everything you've licensed.",
    );
    expect(screen.getByText("Signed in as a…@studio.com")).toBeTruthy();
    const list = screen.getByRole("list");
    expect(list.className).toContain("rounded-lg");
    expect(
      Array.from(list.querySelectorAll("a"), (a) => a.getAttribute("href")),
    ).toEqual([
      `/licenses/${row(2).licenseId}`,
      `/licenses/${row(1).licenseId}`,
    ]);
  });

  it("lets the empty state stand for the page, with the masked email and no other heading", async () => {
    mocks.listBuyerLicenses.mockResolvedValue([]);
    const { container } = render(await MyLicensesPage());
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0].tagName).toBe("H1");
    expect(headings[0].textContent).toBe("My licenses. None yet.");
    expect(
      screen.getByText(
        "Licenses you buy with a…@studio.com show up here. Bought with another email? Sign out and sign in with that one.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(container.textContent).not.toContain("Signed in as");
    expect(container.textContent).not.toContain(USER.email);
  });
});
