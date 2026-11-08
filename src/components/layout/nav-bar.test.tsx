// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuItem } from "@/components/ui/menu";
import { NavBar } from "./nav-bar";

const mocks = vi.hoisted(() => ({ pathname: "/licenses" }));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  usePathname: () => mocks.pathname,
}));

afterEach(cleanup);

const LICENSE_PATH = "/licenses/0b6f7a52-3c1d-4e8f-9a2b-5c6d7e8f9a0b";
const USER = { name: "ana.buyer@studio.com" };
const SIGN_OUT = <MenuItem>Sign out</MenuItem>;

const banner = () => screen.getByRole("banner");
const hrefOf = (element: HTMLElement) => element.getAttribute("href");

/** Opens the account Menu by keyboard (Radix opens on keydown) and lists its items with their links. */
function accountMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "Account menu" }), {
    key: "Enter",
  });
  return screen
    .getAllByRole("menuitem")
    .map((item) => [item.textContent, hrefOf(item)]);
}

describe("NavBar buyer variant (04 §9.30; 05 §1.3)", () => {
  it("shows the wordmark to /licenses, one current My licenses link and the account Menu, with no Settings", () => {
    mocks.pathname = "/licenses";
    render(
      <NavBar
        variant="buyer"
        hasCreatorProfile={false}
        user={USER}
        signOut={SIGN_OUT}
      />,
    );
    expect(
      hrefOf(within(banner()).getByRole("link", { name: "ClipLease" })),
    ).toBe("/licenses");
    const nav = within(banner()).getByRole("navigation", { name: "Main" });
    const link = within(nav).getByRole("link");
    expect([link.textContent, hrefOf(link)]).toEqual([
      "My licenses",
      "/licenses",
    ]);
    expect(link.getAttribute("aria-current")).toBe("page");
    // The avatar falls back to the email's first letter.
    expect(within(banner()).getByText("A")).toBeTruthy();
    expect(accountMenu()).toEqual([
      ["My licenses", "/licenses"],
      ["Sign out", null],
    ]);
  });

  it("sends a creator who also buys to /dashboard from the wordmark, and keeps the link current on a license", () => {
    mocks.pathname = LICENSE_PATH;
    render(<NavBar variant="buyer" hasCreatorProfile user={USER} />);
    expect(
      hrefOf(within(banner()).getByRole("link", { name: "ClipLease" })),
    ).toBe("/dashboard");
    expect(
      within(banner())
        .getByRole("link", { name: "My licenses" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("is the same bar at every tier: nothing in it hides or switches by tier (07 D147)", () => {
    mocks.pathname = "/licenses";
    render(<NavBar variant="buyer" hasCreatorProfile={false} user={USER} />);
    for (const element of banner().querySelectorAll("*")) {
      expect(element.getAttribute("class") ?? "").not.toMatch(
        /(^|\s)(hidden|(md|lg|2xl):)/,
      );
    }
  });
});

describe("NavBar creator account Menu (04 §9.30)", () => {
  it("lists My licenses, Settings and Sign out for a creator", () => {
    mocks.pathname = "/dashboard";
    render(
      <NavBar
        variant="creator"
        user={{ name: "Maya R." }}
        signOut={SIGN_OUT}
      />,
    );
    expect(accountMenu()).toEqual([
      ["My licenses", "/licenses"],
      ["Settings", "/dashboard/settings"],
      ["Sign out", null],
    ]);
  });

  it("lists My licenses and Sign out, with no bar links, before a creator profile exists (/onboarding)", () => {
    mocks.pathname = "/onboarding";
    render(
      <NavBar
        variant="creator"
        withoutProfile
        user={{ name: "ana.buyer@studio.com" }}
        signOut={SIGN_OUT}
      />,
    );
    expect(within(banner()).queryByRole("navigation")).toBeNull();
    expect(accountMenu()).toEqual([
      ["My licenses", "/licenses"],
      ["Sign out", null],
    ]);
  });
});
