import { describe, expect, it } from "vitest";
import {
  ADMIN_TAB_LABELS,
  ADMIN_TABS,
  adminTabHref,
  parseAdminTab,
} from "./tabs";

describe("parseAdminTab (01 A.2)", () => {
  it.each(ADMIN_TABS)("keeps %s", (tab) => {
    expect(parseAdminTab(tab)).toBe(tab);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["unknown", "payouts"],
    ["another case", "Videos"],
    ["repeated", ["videos", "events"]],
    ["a number", 3],
  ])("falls back to creators when %s", (_label, value) => {
    expect(parseAdminTab(value)).toBe("creators");
  });
});

describe("the tab row (05 §7)", () => {
  it("names the six tabs in order, connections as Accounts", () => {
    expect(ADMIN_TABS.map((tab) => ADMIN_TAB_LABELS[tab])).toEqual([
      "Creators",
      "Accounts",
      "Videos",
      "Requests",
      "Licenses",
      "Events",
    ]);
  });

  it("links each tab by its query", () => {
    expect(adminTabHref("connections")).toBe("/admin?tab=connections");
  });
});
