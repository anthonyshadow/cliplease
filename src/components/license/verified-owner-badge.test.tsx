// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { BADGE_COPY, type VerifiedBadgeInput } from "@/lib/videos/ownership";
import { VerifiedOwnerBadge } from "./verified-owner-badge";

afterEach(cleanup);

const maya: VerifiedBadgeInput = {
  size: "lg",
  ownership: "verified_owner",
  provider: "instagram",
  platformLabel: "Instagram",
  verifiedUsername: "@maya.films",
  linkedAt: "2026-10-12T09:00:00.000Z",
  noLongerLinked: false,
};

const explainerLink = () =>
  screen.queryByRole("button", { name: BADGE_COPY.explainerLink });
const icon = (name: string) =>
  document.querySelector(`svg.lucide-${name}`)?.getAttribute("width");

/** Opens the explainer and returns its paragraphs. */
function openExplainer(): string[] {
  const link = explainerLink();
  if (!link) throw new Error("no What does this mean? link");
  fireEvent.click(link);
  const sheet = screen.getByRole("dialog", { name: BADGE_COPY.sheetTitle });
  return [...sheet.querySelectorAll("p")].map((p) => p.textContent ?? "");
}

describe("VerifiedOwnerBadge (04 §9.19)", () => {
  it("lg: a 20 px ShieldCheck, both lines and the link, all in the server HTML; the explainer only once opened", () => {
    const html = renderToStaticMarkup(<VerifiedOwnerBadge {...maya} />);
    expect(html).toContain("Verified · @maya.films on Instagram");
    expect(html).toContain("Account linked 12 Oct 2026");
    expect(html).toContain(BADGE_COPY.explainerLink);
    expect(html).not.toContain(BADGE_COPY.verifiedExplainer);

    render(<VerifiedOwnerBadge {...maya} noLongerLinked />);
    expect(icon("shield-check")).toBe("20");
    expect(
      screen.getByText("Account linked 12 Oct 2026 · no longer linked"),
    ).toBeTruthy();
    expect(
      explainerLink()?.querySelector("svg.lucide-info")?.getAttribute("width"),
    ).toBe("16");
  });

  it("the link opens the Sheet with D43's explainer and D70's sentence, focus inside; Escape closes it and focus returns", async () => {
    render(<VerifiedOwnerBadge {...maya} />);
    expect(openExplainer()).toEqual([
      BADGE_COPY.verifiedExplainer,
      BADGE_COPY.postingsExplainer,
    ]);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
      true,
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    // Radix returns focus to the trigger on the next tick.
    await waitFor(() => expect(document.activeElement).toBe(explainerLink()));
  });

  it("Demo keeps lg's line 2 and the same explainer", () => {
    render(
      <VerifiedOwnerBadge
        {...maya}
        provider="mock"
        platformLabel="Demo"
        verifiedUsername="@demo.creator"
      />,
    );
    expect(
      screen.getByText("Verified · @demo.creator (demo account)"),
    ).toBeTruthy();
    expect(screen.getByText("Account linked 12 Oct 2026")).toBeTruthy();
    expect(openExplainer()).toEqual([
      BADGE_COPY.verifiedExplainer,
      BADGE_COPY.postingsExplainer,
    ]);
  });

  it("sm: a 16 px ShieldCheck and one line, no link", () => {
    const { container } = render(<VerifiedOwnerBadge {...maya} size="sm" />);
    expect(icon("shield-check")).toBe("16");
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(screen.getByText("Verified · @maya.films · Instagram")).toBeTruthy();
    expect(explainerLink()).toBeNull();
  });

  it("self-attested lg: UserRound and ink-2, never a ShieldCheck; the explainer is 01 §4.5's alone", () => {
    render(<VerifiedOwnerBadge size="lg" ownership="self_attested" />);
    const line = screen.getByText(BADGE_COPY.selfAttested);
    expect(line.className).toContain("text-ink-2");
    expect(line.className).not.toContain("font-semibold");
    expect(icon("user-round")).toBe("20");
    expect(icon("shield-check")).toBeUndefined();
    expect(openExplainer()).toEqual([BADGE_COPY.selfAttestedExplainer]);
  });

  it("self-attested sm: a 16 px UserRound and the line, no link", () => {
    render(<VerifiedOwnerBadge size="sm" ownership="self_attested" />);
    expect(icon("user-round")).toBe("16");
    expect(screen.getByText(BADGE_COPY.selfAttested)).toBeTruthy();
    expect(explainerLink()).toBeNull();
  });
});
