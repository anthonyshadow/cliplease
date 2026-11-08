// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BuyerLicenseRow as BuyerLicenseRowData } from "@/server/buyers/queries";
import { FIRST_SNOW } from "../../../tests/helpers/license-snapshot-fixtures";
import { BARE_DOLLAR } from "../../../tests/helpers/money";
import { BuyerLicenseRow } from "./buyer-license-row";

afterEach(cleanup);

const LICENSE_ID = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

/** @maya's "First snow", a standard 1-year license, valid. */
const ROW: BuyerLicenseRowData = {
  licenseId: LICENSE_ID,
  videoId: FIRST_SNOW.video.id,
  code: FIRST_SNOW.code,
  videoTitle: FIRST_SNOW.video.title,
  creatorHandle: FIRST_SNOW.creator.handle,
  status: "valid",
  exclusive: false,
  startsAt: FIRST_SNOW.startsAt,
  endsAt: FIRST_SNOW.endsAt,
  renewal: null,
};

const row = (over: Partial<BuyerLicenseRowData> = {}) =>
  render(
    <ul>
      <BuyerLicenseRow license={{ ...ROW, ...over }} />
    </ul>,
  );

const link = () => screen.getByRole("link");

describe("BuyerLicenseRow (04 §9.37; 05 §4.9)", () => {
  it("is one link to the license's page, named {title}, {code}, {status} and described by lines 2–3", () => {
    row();
    expect(
      screen.getByRole("link", {
        name: "First snow, CL-7K3M-9QXA, Valid",
        description:
          /@maya · CL-7K3M-9QXA.*Standard.*15 Oct 2026 – 15 Oct 2027 \(UTC\)/,
      }),
    ).toBe(link());
    expect(link().getAttribute("href")).toBe(`/licenses/${LICENSE_ID}`);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the bare poster route, the title, the filled Valid pill, the handle with the code and Standard", () => {
    const { container } = row();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      `/api/media/posters/${FIRST_SNOW.video.id}`,
    );
    const title = screen.getByText("First snow");
    expect(title.className).toContain("line-clamp-2");
    expect(screen.getByText("Valid").className).toContain("bg-cleared");
    const code = screen.getByText("CL-7K3M-9QXA");
    expect(code.className).toContain("tracking-code");
    expect(code.parentElement?.textContent).toBe("@maya · CL-7K3M-9QXA");
    expect(screen.getByText("Standard").tagName).toBe("SPAN");
    expect(
      screen.getByText("15 Oct 2026 – 15 Oct 2027 (UTC)").textContent,
    ).toBe("15 Oct 2026 – 15 Oct 2027 (UTC)");
  });

  it("tags an exclusive license with the neutral Exclusive pill instead of Standard", () => {
    row({ exclusive: true });
    expect(screen.getByText("Exclusive").className).toContain("bg-fill");
    expect(screen.queryByText("Standard")).toBeNull();
  });

  it("reads From {start} · No end date for a Perpetual license", () => {
    row({ endsAt: null });
    expect(screen.getByText("From 15 Oct 2026 · No end date")).toBeTruthy();
    expect(screen.queryByText(/\(UTC\)/)).toBeNull();
  });

  it("prints the days in UTC, not the viewer's", () => {
    // Half an hour from midnight UTC at each end: any other zone moves one of the two days.
    row({
      startsAt: "2026-10-15T00:30:00.000Z",
      endsAt: "2026-11-14T23:30:00.000Z",
    });
    expect(screen.getByText("15 Oct 2026 – 14 Nov 2026 (UTC)")).toBeTruthy();
  });

  it.each([
    ["expired", "Expired", "bg-fill"],
    ["revoked", "Revoked", "bg-danger-tint"],
  ] as const)("keeps its dates with the %s pill", (status, label, tone) => {
    row({ status });
    expect(screen.getByText(label).className).toContain(tone);
    expect(
      screen.getByRole("link", { name: `First snow, CL-7K3M-9QXA, ${label}` }),
    ).toBeTruthy();
    expect(screen.getByText("15 Oct 2026 – 15 Oct 2027 (UTC)")).toBeTruthy();
  });

  it("shows no amount, and never a bare $ (Q-192; 07 D98)", () => {
    const { container } = row({ exclusive: true });
    expect(container.textContent).not.toMatch(BARE_DOLLAR);
    expect(container.textContent).not.toContain("$");
  });
});
