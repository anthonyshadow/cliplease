// @vitest-environment jsdom
import "../../../tests/helpers/postings-fixtures";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishVideo } from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import type { CreatorVideoCardDTO } from "@/server/videos/queries";
import { CreatorVideoCard } from "./creator-video-card";
import { PublicVideoCard } from "./video-card";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

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
  availability: { state: "open", until: null, licenseeName: null },
};
const UNTIL = "2027-11-20T15:00:00.000Z";
const LICENSEE = "Daily Laughs Media LLC";

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

  it("says a live video no buyer can license can't be licensed, with the way to the prices, in place of Copy link (owner answer Q-137 a)", () => {
    const item = card({ ...LIVE, fromPriceCents: null });
    expect(
      within(item).getByText("Buyers can't license this video right now."),
    ).toBeTruthy();
    expect(
      within(item)
        .getByRole("link", {
          name: "Turn on at least one use, term and territory",
        })
        .getAttribute("href"),
    ).toBe("/dashboard/pricing");
    expect(
      within(item).queryByRole("button", { name: "Copy link" }),
    ).toBeNull();
  });

  it("keeps an Off video's Copy link whatever its prices", () => {
    const item = card({ ...LIVE, status: "unpublished", fromPriceCents: null });
    expect(
      within(item).getByRole("button", { name: "Copy link" }),
    ).toBeTruthy();
    expect(
      within(item).queryByText("Buyers can't license this video right now."),
    ).toBeNull();
  });

  it.each([
    ["reserved", null, null, "Exclusive request waiting"],
    [
      "exclusive_active",
      UNTIL,
      LICENSEE,
      `Licensed exclusively to ${LICENSEE} until 20 Nov 2027`,
    ],
  ] as const)(
    "prints a %s video's line after the status pill, inside the card's link (07 D110)",
    (state, until, licenseeName, text) => {
      const item = card({
        ...LIVE,
        availability: { state, until, licenseeName },
      });
      const link = within(item).getAllByRole("link")[0] as HTMLElement;
      const line = within(link).getByText(text);
      expect(line.previousElementSibling).toBe(within(link).getByText("Live"));
    },
  );

  it.each(["open", "non_exclusive_only"] as const)(
    "has no line for a %s video: the status pill ends the text",
    (state) => {
      const item = card({
        ...LIVE,
        availability: { state, until: null, licenseeName: null },
      });
      expect(within(item).getByText("Live").nextElementSibling).toBeNull();
    },
  );
});

describe("CreatorVideoCard's Menu (05 §6.8 callout 4)", () => {
  /** Opens the card's "···" Menu by keyboard (Radix opens on keydown) and lists its items. */
  function menuOf(item: HTMLElement) {
    fireEvent.keyDown(
      within(item).getByRole("button", { name: `More for ${LIVE.title}` }),
      { key: "Enter" },
    );
    return screen.getAllByRole("menuitem").map((i) => i.textContent);
  }

  it("a live card: Copy link and the Menu beside the link, with Edit to its page and Turn off", () => {
    const item = card(LIVE);
    expect(menuOf(item)).toEqual(["Edit", "Turn off"]);
    expect(
      screen.getByRole("menuitem", { name: "Edit" }).getAttribute("href"),
    ).toBe(`/dashboard/videos/${ID}`);
  });

  it("an Off card keeps Copy link and offers Turn on", () => {
    const item = card({ ...LIVE, status: "unpublished" });
    expect(within(item).getByText("Off")).toBeTruthy();
    expect(
      within(item).getByRole("button", { name: "Copy link" }),
    ).toBeTruthy();
    expect(menuOf(item)).toEqual(["Edit", "Turn on"]);
  });

  it("opens the video's page at its blockers when a blocker refuses Turn on", async () => {
    vi.mocked(publishVideo).mockResolvedValue({
      ok: false,
      error: { code: "publish_blocked", message: "Before you can publish" },
    });
    menuOf(card({ ...LIVE, status: "unpublished" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Turn on" }), {
      key: "Enter",
    });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/dashboard/videos/${ID}#publish-blockers`,
      ),
    );
  });

  it("a draft offers Delete draft; a disabled video says so, with no Copy link and Edit only", () => {
    expect(
      menuOf(
        card({
          ...LIVE,
          status: "draft",
          shareUrl: null,
          continueHref: `/dashboard/videos/${ID}?step=file`,
        }),
      ),
    ).toEqual(["Edit", "Delete draft"]);
    cleanup();
    const item = card({ ...LIVE, status: "disabled", shareUrl: null });
    expect(within(item).getByText("Disabled by ClipLease")).toBeTruthy();
    expect(
      within(item).queryByRole("button", { name: "Copy link" }),
    ).toBeNull();
    expect(menuOf(item)).toEqual(["Edit"]);
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

  const publicCard = (availability: CreatorVideoCardDTO["availability"]) => {
    render(
      <ul>
        <PublicVideoCard
          video={{ ...LIVE, availability }}
          href="/@maya/he-saw-snow"
        />
      </ul>,
    );
    return screen.getByRole("listitem");
  };

  it("prints a reserved video's line under the price, inside its one link (07 D110)", () => {
    const item = publicCard({
      state: "reserved",
      until: null,
      licenseeName: null,
    });
    const line = within(within(item).getByRole("link")).getByText("Reserved");
    expect(line.previousElementSibling).toBe(
      within(item).getByText("From CA$150.00"),
    );
  });

  it("says until when a video is licensed exclusively, and never to whom, even when handed a name", () => {
    const item = publicCard({
      state: "exclusive_active",
      until: UNTIL,
      licenseeName: LICENSEE,
    });
    expect(
      within(item).getByText("Licensed exclusively until 20 Nov 2027"),
    ).toBeTruthy();
    expect(item.textContent).not.toContain(LICENSEE);
  });

  it("has no line for an open video", () => {
    const item = publicCard(LIVE.availability);
    expect(
      within(item).getByText("From CA$150.00").nextElementSibling,
    ).toBeNull();
  });
});
