// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/app-name";
import { BADGE_COPY } from "@/lib/videos/ownership";
import { NoLicenseFound } from "./no-license-found";

afterEach(cleanup);

const DOMAIN = "cliplease.com";

describe("NoLicenseFound (research/license.md §6.4; Q-184)", () => {
  it("names a canonical code it looked up", () => {
    render(<NoLicenseFound code="CL-0000-0000" domain={DOMAIN} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "No license found" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /^We couldn't find a license with the code CL-0000-0000\. License codes look like CL-XXXX-XXXX/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: SUPPORT_EMAIL }).getAttribute("href"),
    ).toBe(`mailto:${SUPPORT_EMAIL}`);
  });

  it("reads the malformed line when there is no code, and keeps the footer", () => {
    const { container } = render(
      <NoLicenseFound code={null} domain={DOMAIN} />,
    );
    expect(
      screen.getByText(
        /^That doesn't look like a license code\. License codes/,
      ),
    ).toBeTruthy();
    expect(container.textContent).toContain(BADGE_COPY.postingsExplainer);
  });
});
