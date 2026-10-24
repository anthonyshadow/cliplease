// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PUBLISH_BLOCKERS, publishBlockerRows } from "@/lib/videos/review";
import { ReviewBlockers } from "./review-blockers";

afterEach(cleanup);

const VIDEO_ID = "00000000-0000-4000-8000-000000000002";

describe("ReviewBlockers (05 §6.5 callout 51)", () => {
  it("renders one link per row: its page, its anchor, or the connect back to this Review", () => {
    const rows = publishBlockerRows(PUBLISH_BLOCKERS, VIDEO_ID, ["mock"]);
    render(<ReviewBlockers rows={rows} />);
    const box = screen.getByRole("region", { name: "Before you can publish" });
    const links = within(box).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(
      rows.map((row) => row.label),
    );
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      ...rows.flatMap((row) => (row.kind === "reconnect" ? [] : [row.href])),
      `/api/connect/mock/start?returnTo=%2Fdashboard%2Fvideos%2F${VIDEO_ID}%3Fstep%3Dreview`,
    ]);
  });

  it("renders nothing when nothing blocks", () => {
    const { container } = render(<ReviewBlockers rows={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
