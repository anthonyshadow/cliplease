// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/app-name";
import { BADGE_COPY } from "@/lib/videos/ownership";
import type { PublicLicenseView } from "@/server/licensing/verify";
import { PublicRecord } from "./public-record";

afterEach(cleanup);

// S05's record (05 §4.5; 01 J10.1–J10.5; 07 D113; owner answer Q-186), from a view as getPublicLicenseView builds it.
const VIEW: PublicLicenseView = {
  status: "valid",
  code: "CL-7K3M-9QXA",
  sentence:
    "This license is active. Daily Laughs Media LLC may use this video for Paid social ads in the United States until 15 Oct 2027, 14:32 UTC.",
  issuedAt: "2026-10-15T14:32:01.000Z",
  startsAt: "2026-10-15T14:32:00.000Z",
  endsAt: "2027-10-15T14:32:00.000Z",
  revokedAt: null,
  licenseeName: "Daily Laughs Media LLC",
  creator: { handle: "maya", displayName: "Maya R." },
  badge: {
    size: "lg",
    ownership: "verified_owner",
    provider: "instagram",
    platformLabel: "Instagram",
    verifiedUsername: "@maya.films",
    linkedAt: "2026-10-12T09:00:00.000Z",
    noLongerLinked: false,
    alsoVerifiedOn: ["TikTok"],
  },
  postings: [
    {
      platform: "instagram",
      label: "Instagram",
      verified: true,
      verifiedUsername: "@maya.films",
      linkedAt: "2026-10-12T09:00:00.000Z",
      noLongerLinked: false,
      url: "https://www.instagram.com/reel/C9xQ2abc/",
      hostLabel: null,
      removed: false,
      hasLink: true,
    },
  ],
  video: { title: "First snow" },
  scope: {
    useLabel: "Paid social ads",
    termLabel: "1 year",
    territoryLabel: "One country",
    territoryDetail: "United States",
  },
  exclusions: { music: false, people: false },
  exclusive: false,
  termsVersion: "v1",
};

const DOMAIN = "cliplease.com";

/** The FactList as label → value text. */
const facts = () =>
  Object.fromEntries(
    screen
      .getAllByRole("term")
      .map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
  );

describe("PublicRecord (05 §4.5)", () => {
  it("shows a valid license's status, code and public facts in 05's order", () => {
    const { container } = render(<PublicRecord view={VIEW} domain={DOMAIN} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Valid license" }),
    ).toBeTruthy();
    expect(screen.getByText(VIEW.sentence)).toBeTruthy();
    expect(screen.getByText("CL-7K3M-9QXA")).toBeTruthy();
    expect(container.querySelector(".bg-cleared-tint")).not.toBeNull();
    expect(facts()).toEqual({
      "Licensed to": "Daily Laughs Media LLC",
      "Licensed by": "Maya R. (@maya)",
      Ownership: expect.stringContaining("Verified · @maya.films on Instagram"),
      Video: "First snow",
      Use: "Paid social ads",
      Term: "1 year",
      Territory: "One country — United States",
      Starts: "15 Oct 2026, 14:32 UTC",
      Ends: "15 Oct 2027, 14:32 UTC",
      Rights: "Non-exclusive",
      Issued: "15 Oct 2026",
      Terms: "ClipLease Video License v1",
    });
    expect(
      screen.getByRole("link", { name: "@maya" }).getAttribute("href"),
    ).toBe("/@maya");
    expect(
      screen
        .getByRole("link", { name: "ClipLease Video License v1" })
        .getAttribute("href"),
    ).toBe("/legal/license/v1");
  });

  it("lists the snapshot's postings after the facts, and never an amount", () => {
    const { container } = render(<PublicRecord view={VIEW} domain={DOMAIN} />);
    const postings = screen.getByRole("region", {
      name: "Where it was posted",
    });
    expect(within(postings).getAllByRole("listitem")).toHaveLength(1);
    expect(
      container.querySelector("dl")?.compareDocumentPosition(postings),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(container.textContent).not.toMatch(/\$|Canadian dollars/);
  });

  it("reads Uploaded file under the same heading when there are no postings", () => {
    render(<PublicRecord view={{ ...VIEW, postings: [] }} domain={DOMAIN} />);
    const postings = screen.getByRole("region", {
      name: "Where it was posted",
    });
    expect(postings.textContent).toContain("Uploaded file");
  });

  it("prints the exclusive Rights row (07 D113) and Perpetual's No end date", () => {
    render(
      <PublicRecord view={{ ...VIEW, exclusive: true }} domain={DOMAIN} />,
    );
    expect(facts().Rights).toBe("Exclusive until 15 Oct 2027, 14:32 UTC");
    cleanup();
    render(
      <PublicRecord
        view={{
          ...VIEW,
          endsAt: null,
          scope: { ...VIEW.scope, termLabel: "Perpetual" },
        }}
        domain={DOMAIN}
      />,
    );
    expect(facts().Ends).toBe("No end date");
  });

  it("adds the exclusion rows only when flagged (Q-186)", () => {
    render(
      <PublicRecord
        view={{ ...VIEW, exclusions: { music: true, people: true } }}
        domain={DOMAIN}
      />,
    );
    expect(facts()).toMatchObject({
      Music: "not included",
      People: "no releases",
    });
  });

  it("shows Expired off the green row", () => {
    const { container } = render(
      <PublicRecord view={{ ...VIEW, status: "expired" }} domain={DOMAIN} />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Expired" }),
    ).toBeTruthy();
    expect(container.querySelector(".bg-cleared-tint")).toBeNull();
  });

  it("shows Revoked off the green row, the support address a link", () => {
    const { container } = render(
      <PublicRecord
        view={{
          ...VIEW,
          status: "revoked",
          sentence: `This license was revoked on 1 Nov 2026, 10:00 UTC and no longer allows any use of this video. Questions? ${SUPPORT_EMAIL}`,
        }}
        domain={DOMAIN}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Revoked" }),
    ).toBeTruthy();
    expect(container.querySelector(".bg-cleared-tint")).toBeNull();
    expect(
      screen.getByRole("link", { name: SUPPORT_EMAIL }).getAttribute("href"),
    ).toBe(`mailto:${SUPPORT_EMAIL}`);
  });

  it("ends with the record footer, the D43 explainer and D70's sentence (J10.5)", () => {
    const { container } = render(<PublicRecord view={VIEW} domain={DOMAIN} />);
    const paragraphs = [
      ...(container.querySelector("footer")?.querySelectorAll("p") ?? []),
    ].map((p) => p.textContent);
    expect(paragraphs[0]).toContain(
      "Check that your address bar shows cliplease.com.",
    );
    expect(paragraphs.slice(1)).toEqual([
      BADGE_COPY.verifiedExplainer,
      BADGE_COPY.postingsExplainer,
    ]);
  });
});
