// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Avatar } from "./avatar";

afterEach(cleanup);

describe("Avatar", () => {
  it("puts the initials and the name in the server HTML when there is no image", () => {
    const html = renderToStaticMarkup(<Avatar name="Maya Ruiz" />);
    expect(html).toContain('<span aria-hidden="true">MR</span>');
    expect(html).toContain('<span class="sr-only">Maya Ruiz</span>');
  });

  it("shows the initials at once when its image goes away before the 300 ms wait ends", () => {
    const { rerender } = render(
      <Avatar name="Maya Ruiz" src="https://example.com/a.jpg" />,
    );
    expect(screen.queryByText("MR")).toBeNull();
    rerender(<Avatar name="Maya Ruiz" src={null} />);
    expect(screen.getByText("MR")).toBeTruthy();
    expect(screen.getByText("Maya Ruiz")).toBeTruthy();
  });
});
