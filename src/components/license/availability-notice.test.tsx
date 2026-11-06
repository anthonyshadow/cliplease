// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LicenseAvailabilityState } from "@/lib/domain/values";
import { AVAILABILITY_COPY } from "@/lib/licensing/availability";
import type { LicensePageDTO } from "@/lib/licensing/license-page";
import { AvailabilityFocus } from "./availability-focus";
import { AvailabilityNotice } from "./availability-notice";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const UNTIL = "2027-11-20T15:00:00.000Z";

const availabilityOf = (
  state: LicenseAvailabilityState,
  until: string | null = null,
): LicensePageDTO["availability"] => ({
  state,
  until,
  canRequestExclusive: false,
  canRequestNonExclusive: false,
});

const notice = () => document.querySelector("[data-availability-notice]");

describe("AvailabilityNotice (04 §9.35; 07 D110)", () => {
  it("reserved: the title and, separately, check back in a few days", () => {
    render(<AvailabilityNotice availability={availabilityOf("reserved")} />);
    const [title, body] = [
      ...(notice()?.querySelector("p")?.parentElement?.children ?? []),
    ];
    expect(title?.textContent).toBe(AVAILABILITY_COPY.notice.reservedTitle);
    expect(body?.textContent).toBe(AVAILABILITY_COPY.notice.reservedBody);
  });

  it.each([
    [
      "exclusive_active",
      "This video is licensed exclusively until 20 Nov 2027.",
    ],
    [
      "renewal_reserved",
      "This video is reserved for its current licensee until 20 Nov 2027.",
    ],
  ] as const)("%s: its date in the title, and no body", (state, title) => {
    render(<AvailabilityNotice availability={availabilityOf(state, UNTIL)} />);
    expect(notice()?.querySelector("p")?.textContent).toBe(title);
    expect(notice()?.textContent).toBe(title);
  });

  it.each(["open", "non_exclusive_only"] as const)("%s: nothing", (state) => {
    const { container } = render(
      <AvailabilityNotice availability={availabilityOf(state)} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("never prints a renewal plan's id", () => {
    const planId = "0a1b2c3d-1111-4222-8333-444455556666";
    const withPlan = {
      ...availabilityOf("renewal_reserved", UNTIL),
      reservationPlanId: planId,
    };
    const { container } = render(
      <AvailabilityNotice availability={withPlan} />,
    );
    expect(container.innerHTML).not.toContain(planId);
  });

  it("puts the tier's class on the wrapper, which takes the focus", () => {
    render(
      <AvailabilityNotice
        availability={availabilityOf("reserved")}
        className="hidden lg:block"
      />,
    );
    expect(notice()?.className).toContain("hidden lg:block");
    expect(notice()?.getAttribute("tabindex")).toBe("-1");
  });
});

describe("AvailabilityFocus (AD-67)", () => {
  /** The page's grid: the two copies come with the refresh that takes the options away. */
  const grid = (sellable: boolean) => (
    <div>
      <AvailabilityFocus sellable={sellable} />
      {sellable ? null : (
        <>
          <AvailabilityNotice
            availability={availabilityOf("reserved")}
            className="below-lg"
          />
          <AvailabilityNotice
            availability={availabilityOf("reserved")}
            className="from-lg"
          />
        </>
      )}
    </div>
  );

  /** jsdom lays nothing out, so a test says which copy this width shows. */
  const showOnly = (visible: string) =>
    vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockImplementation(function (this: HTMLElement) {
        return (this.classList.contains(visible)
          ? [{}]
          : []) as unknown as DOMRectList;
      });

  it.each(["below-lg", "from-lg"])(
    "a page that stops selling focuses the copy showing at this width: %s",
    (visible) => {
      showOnly(visible);
      const { rerender } = render(grid(true));
      rerender(grid(false));
      expect(document.activeElement?.className).toContain(visible);
    },
  );

  it("a page that loads reserved moves nothing", () => {
    showOnly("from-lg");
    render(grid(false));
    expect(document.activeElement).toBe(document.body);
  });
});
