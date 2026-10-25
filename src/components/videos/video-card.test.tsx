// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CreatorVideoCardDTO } from "@/server/videos/queries";
import { CreatorVideoCard, PublicVideoCard } from "./video-card";

afterEach(cleanup);

const ID = "00000000-0000-4000-8000-000000000002";
const LIVE: CreatorVideoCardDTO = {
  id: ID,
  title: "He saw snow for the first time",
  status: "published",
  posterSrc: "/poster.jpg?v=abcd1234",
  width: 720,
  height: 1280,
  badge: {
    size: "sm",
    ownership: "verified_owner",
    provider: "mock",
    platformLabel: "Demo",
    verifiedUsername: "@demo.creator",
    linkedAt: "2026-10-01T12:00:00.000Z",
    noLongerLinked: false,
  },
  fromPriceCents: 15000,
  currency: "cad",
  continueHref: null,
  shareUrl: "http://localhost:3000/@maya/he-saw-snow",
  pendingCount: 0,
  licenseCount: 0,
};

const card = (video: CreatorVideoCardDTO) => {
  render(
    <ul>
      <CreatorVideoCard video={video} />
    </ul>,
  );
  return screen.getByRole("listitem");
};

describe("CreatorVideoCard (04 §9.27; 05 §6.8)", () => {
  it("shows a live video's poster, badge, From price and status, with Copy link beside the link", () => {
    const item = card(LIVE);
    const link = within(item).getByRole("link");
    expect(link.getAttribute("href")).toBe(`/dashboard/videos/${ID}`);
    expect(
      within(link).getByRole("img", { name: `Poster for ${LIVE.title}` }),
    ).toBeTruthy();
    expect(
      within(link).getByText("Verified · @demo.creator (demo account)"),
    ).toBeTruthy();
    expect(within(link).getByText("From CA$150.00")).toBeTruthy();
    expect(within(link).getByText("Live")).toBeTruthy();
    // Copy link is the card's own action, never inside the link.
    expect(within(link).queryByRole("button")).toBeNull();
    expect(
      within(item).getByRole("button", { name: "Copy link" }),
    ).toBeTruthy();
  });

  it("gives a draft Continue to its first incomplete step instead of Copy link", () => {
    const item = card({
      ...LIVE,
      status: "draft",
      shareUrl: null,
      continueHref: `/dashboard/videos/${ID}?step=rights`,
    });
    expect(
      within(item).queryByRole("button", { name: "Copy link" }),
    ).toBeNull();
    expect(
      within(item).getByRole("link", { name: "Continue" }).getAttribute("href"),
    ).toBe(`/dashboard/videos/${ID}?step=rights`);
    expect(within(item).getByText("Draft")).toBeTruthy();
  });

  it("leaves the From line out when nothing can be bought, and shows a fill block without a poster", () => {
    const item = card({ ...LIVE, fromPriceCents: null, posterSrc: null });
    expect(within(item).queryByText(/^From /)).toBeNull();
    expect(within(item).queryByRole("img")).toBeNull();
  });
});

describe("PublicVideoCard (04 §9.27; 05 §4.6)", () => {
  it("is one link to the license page, with no status and no action", () => {
    render(
      <ul>
        <PublicVideoCard video={LIVE} href="/@maya/he-saw-snow" />
      </ul>,
    );
    const item = screen.getByRole("listitem");
    const links = within(item).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("/@maya/he-saw-snow");
    expect(within(item).queryByText("Live")).toBeNull();
    expect(within(item).queryByRole("button")).toBeNull();
  });
});
