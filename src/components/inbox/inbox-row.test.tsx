// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatDeadline } from "@/lib/format";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { InboxRow } from "./inbox-row";
import { RequestFacts } from "./request-facts";

afterEach(cleanup);

const EXPIRES_AT = "2026-10-30T19:10:00.000Z";
const waiting: CreatorRequest = {
  id: "7d3c0a52-5b1e-4f7e-9f61-0d6f4a1b2c3d",
  status: "awaiting_approval",
  displayStatus: "awaiting_approval",
  statusReason: null,
  useKey: "paid_social",
  termKey: "y1",
  territoryKey: "worldwide",
  territoryCode: null,
  licensePriceCents: 157500,
  amountTotalCents: 173250,
  currency: "cad",
  expiresAt: EXPIRES_AT,
  videoId: "0b9c5b6e-5b8f-4a52-9d3b-7c1d2e3f4a5b",
  title: "First snow",
  posterUrl: null,
  handle: "maya",
  slug: "first-snow",
  licenseCode: null,
  licenseeName: "Daily Laughs Media LLC",
  contactName: "Jordan Lee",
  intendedUse: "Instagram + TikTok ads, Q4 campaign",
  createdAt: "2026-10-27T19:10:00.000Z",
};
const viewerDeadline = formatDeadline(
  new Date(EXPIRES_AT),
  Intl.DateTimeFormat().resolvedOptions().timeZone,
);

const inList = (request: CreatorRequest) =>
  render(
    <ul>
      <InboxRow request={request} />
    </ul>,
  );

/** The facts as label → value. */
function factsOf(container: HTMLElement) {
  const out: Record<string, string> = {};
  for (const dt of container.querySelectorAll("dt")) {
    out[dt.textContent ?? ""] = dt.nextElementSibling?.textContent ?? "";
  }
  return out;
}

describe("InboxRow (04 §9.11; 05 §6.3)", () => {
  it("shows a waiting request's licensee, scope, title with what the creator gets, a countdown and Details", () => {
    const { container } = inList(waiting);
    const row = within(
      container.querySelector("[data-inbox-row]") as HTMLElement,
    );
    expect(row.getByText("Daily Laughs Media LLC")).toBeTruthy();
    expect(row.getByText("Paid social ads · 1 year · Worldwide")).toBeTruthy();
    expect(row.getByText("First snow · You get CA$1,575.00")).toBeTruthy();
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      EXPIRES_AT,
    );
    expect(row.getByRole("button", { name: "Details" })).toBeTruthy();
  });

  it("reads Processing… for a claimed request, with no countdown (07 D26)", () => {
    const { container } = inList({ ...waiting, displayStatus: "processing" });
    expect(screen.getByText("Processing…")).toBeTruthy();
    expect(container.querySelector("time")).toBeNull();
  });

  it("shows a History row's price without 'You get', its pill, its code and no Details", () => {
    inList({
      ...waiting,
      status: "approved",
      displayStatus: "approved",
      licenseCode: "CL-7K3M-9QXA",
    });
    expect(screen.getByText("First snow · CA$1,575.00")).toBeTruthy();
    expect(screen.queryByText(/You get/)).toBeNull();
    expect(
      screen.queryByText("Paid social ads · 1 year · Worldwide"),
    ).toBeNull();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("CL-7K3M-9QXA")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("shows an expired request's line with its deadline", () => {
    inList({ ...waiting, status: "expired", displayStatus: "expired" });
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(
      screen.getByText(
        `Expired. No answer by ${viewerDeadline}. The buyer wasn't charged.`,
      ),
    ).toBeTruthy();
  });
});

describe("RequestFacts (04 §9.11; owner answer Q-128 a)", () => {
  it("lists every fact while the request waits, the deadline in the viewer's zone", () => {
    const { container } = render(<RequestFacts request={waiting} />);
    expect(factsOf(container)).toEqual({
      "Licensed to": "Daily Laughs Media LLC",
      Contact: "Jordan Lee",
      "Planned use": "Instagram + TikTok ads, Q4 campaign",
      Scope: "Paid social ads · 1 year · Worldwide",
      "You get": "CA$1,575.00 (buyer pays CA$1,732.50 incl. service fee)",
      Payment: "Card on hold. Charged only if you approve.",
      "Answer by": `${viewerDeadline}. If you don't answer, the hold is released.`,
    });
  });

  it("keeps 'You get' once approved, but not the hold or the deadline", () => {
    const { container } = render(
      <RequestFacts
        request={{ ...waiting, status: "approved", displayStatus: "approved" }}
      />,
    );
    expect(Object.keys(factsOf(container))).toEqual([
      "Licensed to",
      "Contact",
      "Planned use",
      "Scope",
      "You get",
    ]);
  });

  it.each(["declined", "expired", "capture_failed"] as const)(
    "drops what the creator gets, the hold and the deadline once %s",
    (status) => {
      const { container } = render(
        <RequestFacts
          request={{ ...waiting, status, displayStatus: status }}
        />,
      );
      expect(Object.keys(factsOf(container))).toEqual([
        "Licensed to",
        "Contact",
        "Planned use",
        "Scope",
      ]);
    },
  );

  it("leaves out Planned use when the buyer gave none", () => {
    const { container } = render(
      <RequestFacts request={{ ...waiting, intendedUse: null }} />,
    );
    expect(factsOf(container)).not.toHaveProperty("Planned use");
  });
});
