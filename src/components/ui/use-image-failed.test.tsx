// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useImageFailed } from "./use-image-failed";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Picture({ src }: { src: string | null }) {
  const { failed, imageProps } = useImageFailed(src);
  if (failed || src === null) return <p>failed</p>;
  // biome-ignore lint/performance/noImgElement: the hook serves the plain <img> the post-image proxies stream into.
  return <img {...imageProps} src={src} alt="" />;
}

/** jsdom loads no images: stand in for what the browser reports by mount. */
function imageState(complete: boolean, naturalWidth: number) {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
    complete,
  );
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
    naturalWidth,
  );
}

describe("useImageFailed (04 §9.12)", () => {
  it("is failed from the start without a src", () => {
    render(<Picture src={null} />);
    expect(screen.getByText("failed")).toBeTruthy();
  });

  it("fails when the image fires onError", () => {
    const { container } = render(<Picture src="/a.png" />);
    const img = container.querySelector("img");
    if (!img) throw new Error("no image");
    fireEvent.error(img);
    expect(screen.getByText("failed")).toBeTruthy();
  });

  it("fails on mount when the image already failed before hydration", () => {
    imageState(true, 0);
    render(<Picture src="/a.png" />);
    expect(screen.getByText("failed")).toBeTruthy();
  });

  it("keeps an image that loaded, or is still loading", () => {
    imageState(true, 720);
    const { container, unmount } = render(<Picture src="/a.png" />);
    expect(container.querySelector("img")).not.toBeNull();
    unmount();

    imageState(false, 0);
    const again = render(<Picture src="/a.png" />);
    expect(again.container.querySelector("img")).not.toBeNull();
  });
});
