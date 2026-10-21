// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SOURCE_POST as POST, PROVENANCE } from "./file-step-fixtures";
import { PostSummary } from "./file-step-post-summary";

afterEach(cleanup);

const COVER = {
  src: "/api/media/posters/v?v=abcd1234",
  width: 720,
  height: 1280,
};

const summary = () =>
  document.querySelector<HTMLElement>("[data-post-summary]");
const images = () => Array.from(document.querySelectorAll("img"));

describe("PostSummary (05 §6.5 callout 9; owner answers Q-65 a, Q-66 a)", () => {
  it("shows only the provenance line until the original is attached", () => {
    render(
      <PostSummary
        post={POST}
        provenance={PROVENANCE}
        attached={false}
        cover={COVER}
      />,
    );
    expect(summary()?.textContent).toBe(
      "From Demo · @demo.creator · posted 1 Oct 2026 · Verified",
    );
    expect(images()).toEqual([]);
    expect(screen.queryByText("Post")).toBeNull();
  });

  it("once attached, puts the post's picture beside the cover, 64 px tall and contained, captioned Post and Cover image", () => {
    render(
      <PostSummary
        post={POST}
        provenance={PROVENANCE}
        attached
        cover={COVER}
      />,
    );
    const figures = Array.from(document.querySelectorAll("figure"));
    expect(
      figures.map((f) => f.querySelector("figcaption")?.textContent),
    ).toEqual(["Post", "Cover image"]);
    const [post, cover] = images();
    expect(post?.getAttribute("src")).toBe(POST.thumbnailSrc);
    expect(cover?.getAttribute("src")).toBe(COVER.src);
    for (const img of [post, cover]) {
      // The captions name them; the File step's cover picker keeps "Cover image for {title}" to itself.
      expect(img?.getAttribute("alt")).toBe("");
      expect(img?.className).toContain("object-contain");
      expect(img?.parentElement?.className).toContain("h-16");
    }
    expect(post?.parentElement?.style.aspectRatio).toBe("720 / 1280");
  });

  it("shows 04 §9.12's failed state when the post's image fails or there is none, never a broken image", () => {
    render(
      <PostSummary
        post={POST}
        provenance={PROVENANCE}
        attached
        cover={COVER}
      />,
    );
    const [post] = images();
    if (!post) throw new Error("no post image");
    fireEvent.error(post);
    expect(screen.getByText("Demo · Sync to refresh")).toBeTruthy();
    expect(images().map((img) => img.getAttribute("src"))).toEqual([COVER.src]);
    cleanup();

    render(
      <PostSummary
        post={{ ...POST, thumbnailSrc: null }}
        provenance={PROVENANCE}
        attached
        cover={COVER}
      />,
    );
    expect(screen.getByText("Demo · Sync to refresh")).toBeTruthy();
  });

  it("leaves the cover out while the video has none (the picker asks for one)", () => {
    render(
      <PostSummary post={POST} provenance={PROVENANCE} attached cover={null} />,
    );
    expect(
      Array.from(document.querySelectorAll("figcaption")).map(
        (c) => c.textContent,
      ),
    ).toEqual(["Post"]);
  });

  it("is the left column from lg (07 D146)", () => {
    render(
      <PostSummary
        post={POST}
        provenance={PROVENANCE}
        attached={false}
        cover={null}
      />,
    );
    expect(summary()?.className).toContain("lg:col-span-5");
  });
});
