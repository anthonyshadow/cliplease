// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VideoHeaderView } from "./video-header";

afterEach(cleanup);

const VIDEO = {
  title: "He saw snow for the first time",
  posterSrc: "/poster.jpg?v=abcd1234",
  width: 720,
  height: 1280,
};
const SELF = { size: "sm", ownership: "self_attested" } as const;
const URL_ = "http://localhost:3000/@maya/he-saw-snow";

describe("VideoHeaderView (05 §6.7 callout 1; P14a's minimal video page)", () => {
  it("shows a live video's title, status, badge and link with Copy", () => {
    render(
      <VideoHeaderView
        video={{ ...VIDEO, status: "published" }}
        badge={SELF}
        shareUrl={URL_}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: VIDEO.title }),
    ).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("Self-attested by the creator")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Videos" }).getAttribute("href"),
    ).toBe("/dashboard/videos");
  });

  it("keeps Off's link, and shows a disabled video read-only, without one", () => {
    const { unmount } = render(
      <VideoHeaderView
        video={{ ...VIDEO, status: "unpublished" }}
        badge={SELF}
        shareUrl={URL_}
      />,
    );
    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    unmount();
    render(
      <VideoHeaderView
        video={{ ...VIDEO, status: "disabled" }}
        badge={SELF}
        shareUrl={null}
      />,
    );
    expect(screen.getByText("Disabled by ClipLease")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
