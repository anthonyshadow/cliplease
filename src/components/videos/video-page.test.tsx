// @vitest-environment jsdom
import "../../../tests/helpers/file-step-fixtures";
import "../../../tests/helpers/postings-fixtures";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBytes } from "@/lib/format";
import { FOLLOWS_RATE_CARD } from "@/lib/pricing/exclusive";
import { EXCLUSIVE_COPY } from "@/lib/pricing/exclusive-copy";
import type { PublishBlocker } from "@/lib/videos/review";
import { MUSIC_DISABLED_USES } from "@/lib/videos/rights";
import { VIDEO_PRICE_COPY } from "@/lib/videos/video-price";
import { effectiveOptions } from "@/server/pricing/rate-card";
import { creatorVideoFixture } from "../../../tests/helpers/creator-video-fixture";
import { savedPosting } from "../../../tests/helpers/postings-fixtures";
import {
  NO_VIDEO,
  rateCardFixture,
} from "../../../tests/helpers/rate-card-fixtures";
import { VideoPageView } from "./video-page";

vi.mock("@/app/(dashboard)/dashboard/videos/[id]/review-actions", () => ({
  updateVideoDetails: vi.fn(),
}));

afterEach(cleanup);

const ID = "00000000-0000-4000-8000-000000000002";
const URL_ = "http://localhost:3000/@maya/first-snow";
const LIVE = creatorVideoFixture({
  title: "First snow",
  slug: "first-snow",
  slugLocked: true,
  status: "published",
  source: "library",
  originalStatus: "ready",
  originalFilename: "first-snow.mp4",
  originalBytes: 166_229,
  durationMs: 14_000,
  width: 720,
  height: 1280,
  posterSrc: "/poster.jpg?v=abcd1234",
  originalLocked: true,
  containsMusic: false,
  identifiablePeople: false,
  rightsAnswered: true,
  hasVerifiedPosting: true,
  sameVideoConfirmed: true,
  postingsConfirmedAt: "2026-10-22T10:00:00.000Z",
});
const SOURCE = savedPosting({ isSource: true, position: 0 });
const RATE_CARD = rateCardFixture();
const OPTIONS = effectiveOptions(RATE_CARD, NO_VIDEO);

type Publish = ComponentProps<typeof VideoPageView>["publish"];

/** The publish facts of a video nothing blocks, `change` on top. */
const publishOf = (change: Partial<Publish> = {}): Publish => ({
  blockers: [],
  reconnectPlatforms: [],
  options: OPTIONS,
  rateCard: RATE_CARD,
  videoExclusive: FOLLOWS_RATE_CARD,
  disabledReason: null,
  ...change,
});

function page(
  change: Partial<ComponentProps<typeof VideoPageView>> = {},
  blockers: PublishBlocker[] = [],
) {
  render(
    <VideoPageView
      video={LIVE}
      handle="maya"
      shareUrl={URL_}
      postings={[SOURCE]}
      publish={publishOf({
        blockers,
        reconnectPlatforms: blockers.includes("reconnect_account")
          ? ["mock"]
          : [],
      })}
      counts={{ pendingCount: 1, licenseCount: 2 }}
      platformFeeBps={1000}
      progress={null}
      {...change}
    />,
  );
}

const section = (name: string) => screen.getByRole("region", { name });

describe("VideoPageView (S19; 05 §6.7)", () => {
  it("a live video: its link, counts, details, read-only postings, locked file, rights, prices and Turn off", () => {
    page();
    expect(
      screen.getByRole("heading", { level: 1, name: "First snow" }),
    ).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(
      screen.getByText("Verified · @demo.creator (demo account)"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Videos" }).getAttribute("href"),
    ).toBe("/dashboard/videos");

    const requests = section("Requests");
    expect(within(requests).getByText("1 waiting · 2 licenses")).toBeTruthy();
    expect(
      within(requests)
        .getByRole("link", { name: "Open Inbox" })
        .getAttribute("href"),
    ).toBe("/dashboard");

    const details = section("Details");
    expect(
      within(details).getByText("/@maya/first-snow (locked)"),
    ).toBeTruthy();
    expect(
      within(details).getByRole("button", { name: "Edit title" }),
    ).toBeTruthy();
    expect(
      within(details).getByRole("button", { name: "Use a different image" }),
    ).toBeTruthy();

    const posted = section("Where it was posted");
    expect(
      within(posted).getByText("Turn off to edit where it was posted."),
    ).toBeTruthy();
    expect(within(posted).queryByRole("link")).toBeNull();

    const file = section("Original file");
    expect(
      within(file).getByText(
        `first-snow.mp4 · 0:14 · 720 × 1280 · ${formatBytes(166_229)}`,
      ),
    ).toBeTruthy();
    expect(
      within(file).getByText(
        "Can't replace while the video is live, or once a request or license exists.",
      ),
    ).toBeTruthy();
    expect(within(file).queryByRole("button", { name: "Replace" })).toBeNull();

    const rights = section("Rights");
    expect(within(rights).getByText("Music: No · People: No")).toBeTruthy();
    expect(
      within(rights)
        .getByRole("link", { name: "Edit rights" })
        .getAttribute("href"),
    ).toBe(`/dashboard/videos/${ID}?step=rights`);

    const prices = section("Prices for this video");
    expect(
      within(prices).getByRole<HTMLInputElement>("radio", {
        name: "Use my rate card (CA$150)",
      }).checked,
    ).toBe(true);
    expect(
      within(prices).getByRole<HTMLInputElement>("radio", {
        name: VIDEO_PRICE_COPY.setOwn,
      }).checked,
    ).toBe(false);
    expect(within(prices).queryByRole("switch")).toBeNull();
    const exclusiveRadio = (name: string) =>
      within(prices).getByRole<HTMLInputElement>("radio", { name });
    expect(exclusiveRadio("Use my rate card (off)").checked).toBe(true);
    expect(exclusiveRadio(EXCLUSIVE_COPY.offerOnVideo).checked).toBe(false);
    expect(exclusiveRadio(EXCLUSIVE_COPY.dontOffer).checked).toBe(false);
    expect(prices.querySelectorAll("[data-price-preview]")).toHaveLength(1);
    // The exclusive editor, then the preview, in document order (owner answer Q-166).
    expect(
      [
        ...prices.querySelectorAll(
          "[data-exclusive-offer-editor], [data-price-preview]",
        ),
      ].map((el) => el.hasAttribute("data-price-preview")),
    ).toEqual([false, true]);
    expect(prices.querySelector("[data-from-line]")?.textContent).toBe(
      "From CA$150.00 · Organic social repost · Paid social ads · TV / broadcast",
    );
    // The preview's link is the section's only one (owner answer Q-162).
    expect(
      within(prices)
        .getAllByRole("link", { name: "Edit your rate card" })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/dashboard/pricing"]);

    expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy();
    expect(screen.queryByText("Buyers can't see this video right now.")).toBe(
      null,
    );
  });

  it("a music video: its two Switches as stored, the helper once, and the From line's uses (07 D82)", () => {
    page({
      video: { ...LIVE, containsMusic: true },
      publish: publishOf({
        options: effectiveOptions(RATE_CARD, {
          ...NO_VIDEO,
          disabledUses: ["broadcast"],
        }),
      }),
    });
    const prices = section("Prices for this video");
    expect(within(prices).getAllByRole("switch")).toHaveLength(2);
    const checked = (name: string) =>
      within(prices).getByRole("switch", { name }).getAttribute("aria-checked");
    expect(checked(VIDEO_PRICE_COPY.allowAnyway("paid_social"))).toBe("true");
    expect(checked(VIDEO_PRICE_COPY.allowAnyway("broadcast"))).toBe("false");
    expect(
      within(prices).getAllByText(VIDEO_PRICE_COPY.musicHelper),
    ).toHaveLength(1);
    expect(prices.querySelector("[data-from-line]")?.textContent).toBe(
      "From CA$150.00 · Organic social repost · Paid social ads",
    );
  });

  it("an Off video: its Banner, Where posted and the original editable, Turn on with the blockers inline", () => {
    const off = {
      ...LIVE,
      status: "unpublished" as const,
      originalLocked: false,
    };
    page({ video: off }, ["reconnect_account"]);
    expect(screen.getByText("Off")).toBeTruthy();
    expect(
      screen.getByText("Buyers can't see this video right now."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    const posted = section("Where it was posted");
    expect(
      within(posted).getByText("Demo · @demo.creator · Verified"),
    ).toBeTruthy();
    expect(
      within(posted)
        .getByRole("link", { name: "Edit where it was posted" })
        .getAttribute("href"),
    ).toBe(`/dashboard/videos/${ID}?step=postings`);
    expect(
      within(section("Original file")).getByRole("button", {
        name: "Replace",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Before you can publish")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Reconnect Demo to publish." })
        .getAttribute("href"),
    ).toContain(encodeURIComponent(`/dashboard/videos/${ID}`));
    expect(
      screen.getByRole("button", { name: "Turn on" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("a disabled video: the reason label only, nothing to edit, no link, no prices, no Turn on", () => {
    page({
      video: { ...LIVE, status: "disabled" },
      publish: publishOf({
        blockers: ["disabled_by_admin"],
        disabledReason: "rights_claim",
      }),
    });
    expect(screen.getAllByText("Disabled by ClipLease")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toBe(
      "Disabled by ClipLease: Rights claim. Questions? support@example.com",
    );
    expect(
      screen.queryByRole("button", {
        name: /Copy|Share|Edit|Use a different|Turn/,
      }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit/ })).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Prices for this video" }),
    ).toBeNull();
    expect(
      screen.queryByRole("group", { name: EXCLUSIVE_COPY.title }),
    ).toBeNull();
    expect(
      screen.queryByText(
        "Can't replace while the video is live, or once a request or license exists.",
      ),
    ).toBeNull();
  });

  it("a removed post: the full line while live, the first sentence while off, none when disabled", () => {
    // A released posting's removed post says nothing (07 D66): only verified ones count.
    const released = savedPosting({
      id: "00000000-0000-4000-8000-0000000000b3",
      verification: "unverified",
      unverifiedReason: "released",
      removedAt: "2026-10-12T12:00:00.000Z",
    });
    const removed = [
      { ...SOURCE, removedAt: "2026-10-14T12:00:00.000Z" },
      released,
    ];
    page({ postings: removed });
    expect(
      screen.getByText(
        "This post was removed from Demo on 14 Oct 2026. Your video stays live.",
      ),
    ).toBeTruthy();
    cleanup();
    page({ postings: removed, video: { ...LIVE, status: "unpublished" } });
    expect(
      screen.getByText("This post was removed from Demo on 14 Oct 2026."),
    ).toBeTruthy();
    cleanup();
    page({ postings: removed, video: { ...LIVE, status: "disabled" } });
    expect(screen.queryByText(/This post was removed/)).toBeNull();
  });

  it("a live video no buyer can license: the line and the way to the prices in place of its link (owner answer Q-137 a)", () => {
    // With Organic social off on the rate card, music's rule (01 J5.14) leaves no use.
    const noUse = effectiveOptions(
      rateCardFixture((o) =>
        o.key === "organic_social" ? { enabled: false } : {},
      ),
      { ...NO_VIDEO, disabledUses: [...MUSIC_DISABLED_USES] },
    );
    page({
      publish: publishOf({ options: noUse }),
    });
    expect(
      screen.getByText("Buyers can't license this video right now."),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", {
          name: "Turn on at least one use, term and territory",
        })
        .getAttribute("href"),
    ).toBe("/dashboard/pricing");
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: /View license page/ }),
    ).toBeNull();
  });

  it("hides Rights' Edit once a license is sold, and says why", () => {
    page({ video: { ...LIVE, rightsLock: "license" } });
    const rights = section("Rights");
    expect(within(rights).queryByRole("link", { name: "Edit rights" })).toBe(
      null,
    );
    expect(
      within(rights).getByText(
        "You can't change these answers after a license is sold.",
      ),
    ).toBeTruthy();
  });

  it("says the badge's account is no longer linked", () => {
    page({ postings: [{ ...SOURCE, accountStatus: "disconnected" }] });
    expect(
      screen.getByText(
        "Verified · @demo.creator (demo account) · no longer linked",
      ),
    ).toBeTruthy();
  });
});
