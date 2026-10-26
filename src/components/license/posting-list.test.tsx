// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicPostingDTO } from "@/lib/postings/types";
import { PostingList } from "./posting-list";

afterEach(cleanup);

const REL = "nofollow ugc noopener noreferrer";

const posting = (over: Partial<PublicPostingDTO>): PublicPostingDTO => ({
  platform: "instagram",
  label: "Instagram",
  verified: false,
  verifiedUsername: null,
  linkedAt: null,
  noLongerLinked: false,
  url: null,
  hostLabel: null,
  removed: false,
  hasLink: false,
  ...over,
});

const verified = (over: Partial<PublicPostingDTO> = {}) =>
  posting({
    verified: true,
    verifiedUsername: "@maya.films",
    linkedAt: "2026-10-12T09:00:00.000Z",
    url: "https://www.instagram.com/reel/C1a2b3c4d5e/",
    hasLink: true,
    ...over,
  });

/** The rows as their visible text, and each row's links. */
function rows() {
  return screen.getAllByRole("listitem").map((row) => ({
    text: row.textContent,
    links: within(row)
      .queryAllByRole("link")
      .map((a) => ({
        name: a.getAttribute("aria-label"),
        text: a.textContent,
        href: a.getAttribute("href"),
        target: a.getAttribute("target"),
        rel: a.getAttribute("rel"),
      })),
  }));
}

describe("PostingList (04 §9.34; 07 D70)", () => {
  it("is titled Where it was posted and renders nothing without postings", () => {
    const { container } = render(<PostingList postings={[]} />);
    expect(container.innerHTML).toBe("");
    render(<PostingList postings={[verified()]} />);
    expect(
      screen.getByRole("region", { name: "Where it was posted" }),
    ).toBeTruthy();
    expect(screen.getByRole("list")).toBeTruthy();
  });

  it("a verified row: the name as stored on the platform, Verified, and View post opening the stored url", () => {
    render(<PostingList postings={[verified()]} />);
    expect(rows()).toEqual([
      {
        text: "@maya.films on InstagramVerifiedView post ↗",
        links: [
          {
            name: "View post on Instagram (opens in a new tab)",
            text: "View post ↗",
            href: "https://www.instagram.com/reel/C1a2b3c4d5e/",
            target: "_blank",
            rel: REL,
          },
        ],
      },
    ]);
  });

  it("the demo account's row, and a YouTube channel title with no @", () => {
    render(
      <PostingList
        postings={[
          verified({
            platform: "mock",
            label: "Demo",
            verifiedUsername: "@demo.creator",
            url: "https://example.com/mock/mock_post_0001_01",
          }),
          verified({
            platform: "youtube",
            label: "YouTube",
            verifiedUsername: "Maya Films",
            url: "https://www.youtube.com/shorts/abcdefghijk",
          }),
        ]}
      />,
    );
    const [demo, youtube] = rows();
    expect(demo?.text).toBe("@demo.creator on DemoVerifiedView post ↗");
    expect(youtube?.text).toBe(
      "Maya Films on YouTubeVerifiedView on YouTube ↗",
    );
    expect(youtube?.links[0]?.name).toBe(
      "View on YouTube (opens in a new tab)",
    );
  });

  it("an unverified row never shows a handle; with a link it says Not verified and links it", () => {
    render(
      <PostingList
        postings={[
          posting({
            platform: "facebook",
            label: "Facebook",
            url: "https://www.facebook.com/reel/123456789",
            hasLink: true,
          }),
          posting({
            platform: "youtube",
            label: "YouTube",
            url: "https://www.youtube.com/shorts/abcdefghijk",
            hasLink: true,
          }),
        ]}
      />,
    );
    const [facebook, youtube] = rows();
    expect(facebook?.text).toBe("FacebookNot verifiedView post ↗");
    expect(facebook?.links[0]).toMatchObject({
      name: "View post on Facebook (opens in a new tab)",
      href: "https://www.facebook.com/reel/123456789",
      rel: REL,
    });
    expect(youtube?.text).toBe("YouTubeNot verifiedView on YouTube ↗");
  });

  it("no link: Also posted on {Platform}; a hidden link: the name and Not verified, no link (owner answer Q-112 a)", () => {
    render(
      <PostingList
        postings={[
          posting({ platform: "snapchat", label: "Snapchat" }),
          posting({ hasLink: true }),
          posting({ platform: "other", label: "Vimeo" }),
        ]}
      />,
    );
    expect(rows()).toEqual([
      { text: "Also posted on Snapchat", links: [] },
      { text: "InstagramNot verified", links: [] },
      { text: "Also posted on Vimeo", links: [] },
    ]);
  });

  it("an Other site: its name, no pill, and its hostname as the link", () => {
    render(
      <PostingList
        postings={[
          posting({
            platform: "other",
            label: "Vimeo",
            url: "https://vimeo.com/76979871",
            hostLabel: "vimeo.com",
            hasLink: true,
          }),
        ]}
      />,
    );
    expect(rows()).toEqual([
      {
        text: "Vimeovimeo.com ↗",
        links: [
          {
            name: "vimeo.com (opens in a new tab)",
            text: "vimeo.com ↗",
            href: "https://vimeo.com/76979871",
            target: "_blank",
            rel: REL,
          },
        ],
      },
    ]);
  });

  it("a verified post the platform removed keeps its row but no link: Original post no longer available", () => {
    render(
      <PostingList
        postings={[
          verified({ url: null, removed: true }),
          verified({ url: null }),
        ]}
      />,
    );
    expect(rows()).toEqual([
      {
        text: "@maya.films on InstagramVerifiedOriginal post no longer available",
        links: [],
      },
      { text: "@maya.films on InstagramVerified", links: [] },
    ]);
  });

  it("shows no image or frame of any posting (07 D08)", () => {
    const { container } = render(
      <PostingList
        postings={[
          verified(),
          posting({ platform: "facebook", label: "Facebook", hasLink: true }),
        ]}
      />,
    );
    expect(container.querySelectorAll("img, iframe, [role=img]")).toHaveLength(
      0,
    );
  });
});
