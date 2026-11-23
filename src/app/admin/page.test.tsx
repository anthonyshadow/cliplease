// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as queries from "@/server/admin/queries";
import type { requireAdmin, SessionUser } from "@/server/auth/session";
import {
  CONNECTION,
  CREATOR,
  EVENTS,
  LIVE_VIDEO,
  VALID_LICENSE,
  WAITING_REQUEST,
} from "../../../tests/helpers/admin-fixtures";
import AdminPage, { generateMetadata, maxDuration } from "./page";

// S24 /admin (05 §7; design/P21-admin-view.md §4, §6): the gate, the tab row, the caption, and the one tab's loader. The
// session and the loaders are mocked (tests/integration/admin.test.ts runs them for real).
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn<typeof requireAdmin>(),
  /** The loaders module as the page imports it. */
  loaders: {
    listAdminCreators: vi.fn<typeof queries.listAdminCreators>(),
    listAdminConnections: vi.fn<typeof queries.listAdminConnections>(),
    listAdminVideos: vi.fn<typeof queries.listAdminVideos>(),
    listAdminRequests: vi.fn<typeof queries.listAdminRequests>(),
    listAdminLicenses: vi.fn<typeof queries.listAdminLicenses>(),
    listAdminEvents: vi.fn<typeof queries.listAdminEvents>(),
  },
}));
vi.mock("@/server/auth/session", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/server/admin/queries", () => mocks.loaders);
vi.mock("@/app/admin/actions", () => ({
  adminDisableVideo: vi.fn(),
  adminEnableVideo: vi.fn(),
  adminRevokeLicense: vi.fn(),
  adminRetryMoneyMovement: vi.fn(),
}));

const ADMIN: SessionUser = {
  id: "user-owner",
  email: "owner@example.com",
  name: "",
  role: "admin",
};

const { loaders } = mocks;

beforeEach(() => {
  mocks.requireAdmin.mockResolvedValue(ADMIN);
  loaders.listAdminCreators.mockResolvedValue([CREATOR]);
  loaders.listAdminConnections.mockResolvedValue([CONNECTION]);
  loaders.listAdminVideos.mockResolvedValue([LIVE_VIDEO]);
  loaders.listAdminRequests.mockResolvedValue([WAITING_REQUEST]);
  loaders.listAdminLicenses.mockResolvedValue([VALID_LICENSE]);
  loaders.listAdminEvents.mockResolvedValue(EVENTS);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Each tab's loader. */
const LOADERS = {
  creators: loaders.listAdminCreators,
  connections: loaders.listAdminConnections,
  videos: loaders.listAdminVideos,
  requests: loaders.listAdminRequests,
  licenses: loaders.listAdminLicenses,
  events: loaders.listAdminEvents,
} as const;

async function renderTab(tab?: string | string[]) {
  render(
    await AdminPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(tab === undefined ? {} : { tab }),
    }),
  );
}

const tabRow = () => screen.getByRole("navigation", { name: "Admin tables" });
const currentTab = () =>
  within(tabRow())
    .getAllByRole("link")
    .filter((a) => a.getAttribute("aria-current") === "page")
    .map((a) => a.textContent);

describe("AdminPage (05 §7; 01 A.1–A.3)", () => {
  it("gates its title too, and gives its actions a minute (07 D26)", async () => {
    expect(await generateMetadata()).toEqual({ title: "Admin" });
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(maxDuration).toBe(60);
  });

  it("links the six tabs in a scrolling row, then the caption", async () => {
    await renderTab();
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Admin");
    const links = within(tabRow()).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Creators", "/admin?tab=creators"],
      ["Accounts", "/admin?tab=connections"],
      ["Videos", "/admin?tab=videos"],
      ["Requests", "/admin?tab=requests"],
      ["Licenses", "/admin?tab=licenses"],
      ["Events", "/admin?tab=events"],
    ]);
    expect(tabRow().className).toContain("overflow-x-auto");
    expect(screen.getByText("Newest 50")).toBeTruthy();
  });

  it.each([
    [undefined, "creators", "Creators", "Creators"],
    ["unknown", "creators", "Creators", "Creators"],
    [["videos", "events"], "creators", "Creators", "Creators"],
    ["connections", "connections", "Accounts", "Accounts"],
    ["videos", "videos", "Videos", "Videos"],
    ["requests", "requests", "Requests", "Requests"],
    ["licenses", "licenses", "Licenses", "Licenses"],
  ] as const)(
    "?tab=%s loads %s only, as the current tab, in one table named %s",
    async (query, tab, label, caption) => {
      await renderTab(query as string | string[] | undefined);
      expect(currentTab()).toEqual([label]);
      for (const [key, loader] of Object.entries(LOADERS)) {
        if (key === tab) {
          expect(loader).toHaveBeenCalledExactlyOnceWith({
            kind: "admin",
            userId: ADMIN.id,
          });
        } else {
          expect(loader).not.toHaveBeenCalled();
        }
      }
      expect(screen.getAllByRole("table").length).toBe(1);
      expect(screen.getByRole("table", { name: caption })).toBeTruthy();
    },
  );

  it("?tab=events shows the four lists under their headings", async () => {
    await renderTab("events");
    expect(currentTab()).toEqual(["Events"]);
    expect(loaders.listAdminEvents).toHaveBeenCalledExactlyOnceWith({
      kind: "admin",
      userId: ADMIN.id,
    });
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      "Latest events",
      "Failed money movements",
      "Failed emails",
      "Unprocessed Stripe events",
    ]);
  });

  it("shows “Nothing here yet.” for an empty tab, under the caption", async () => {
    loaders.listAdminVideos.mockResolvedValue([]);
    await renderTab("videos");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
  });
});
