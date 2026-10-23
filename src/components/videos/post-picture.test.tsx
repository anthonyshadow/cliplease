// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PostPicture } from "./post-picture";

afterEach(cleanup);

const SRC = "/api/library/thumbnails/00000000-0000-4000-8000-000000000001?v=1";

const image = () => document.querySelector("img");

describe("PostPicture (04 §9.33, §9.12; 01 J3.10)", () => {
  it("shows the proxy image 64 px tall in a 9:16 box, contained and never cropped, with no description", () => {
    render(<PostPicture platform="youtube" thumbnailSrc={SRC} />);
    const img = image();
    expect(img?.getAttribute("src")).toBe(SRC);
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.className).toContain("object-contain");
    expect(img?.className).not.toContain("object-cover");
    const box = img?.parentElement;
    expect(box?.className).toContain("h-16");
    expect(box?.className).toContain("w-auto");
    // Sized by its own height and aspect, never by the image (WebKit widened it around an SVG thumbnail).
    expect(box?.className).toContain("contain-size");
    expect(box?.style.aspectRatio).toBe("1080 / 1920");
  });

  it("shows the failed state instead of a broken image when the image fails", () => {
    render(<PostPicture platform="tiktok" thumbnailSrc={SRC} />);
    const img = image();
    if (!img) throw new Error("no image");
    fireEvent.error(img);
    expect(image()).toBeNull();
    const line = screen.getByText("TikTok · Sync to refresh");
    expect(line.parentElement?.className).toContain("h-16");
    expect(
      line.parentElement?.querySelector("svg")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("shows the failed state at once when the post has no image", () => {
    render(<PostPicture platform="instagram" thumbnailSrc={null} />);
    expect(image()).toBeNull();
    expect(screen.getByText("Instagram · Sync to refresh")).toBeTruthy();
  });
});
