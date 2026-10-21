import { describe, expect, it } from "vitest";
import { APP_NAME } from "../app-name";
import {
  BADGE_COPY,
  badgeExplainer,
  badgeText,
  type VerifiedBadgeInput,
  verifiedAs,
  verifiedUsernameDisplay,
} from "./ownership";

describe("verifiedUsernameDisplay (07 D43)", () => {
  it("names the account by its handle with one @", () => {
    expect(
      verifiedUsernameDisplay({
        username: "demo.creator",
        displayName: "Demo Creator",
      }),
    ).toBe("@demo.creator");
    expect(
      verifiedUsernameDisplay({ username: "@maya.films", displayName: null }),
    ).toBe("@maya.films");
    expect(
      verifiedUsernameDisplay({ username: "@@maya.films", displayName: null }),
    ).toBe("@maya.films");
  });

  it("falls back to the display name or channel title, never adding an @", () => {
    expect(
      verifiedUsernameDisplay({
        username: null,
        displayName: "Maya Films",
      }),
    ).toBe("Maya Films");
    expect(
      verifiedUsernameDisplay({ username: " @ ", displayName: "Maya Films" }),
    ).toBe("Maya Films");
    expect(
      verifiedUsernameDisplay({ username: "", displayName: "@maya" }),
    ).toBe("@maya");
  });

  it("is null when the account has neither", () => {
    expect(
      verifiedUsernameDisplay({ username: null, displayName: null }),
    ).toBeNull();
    expect(
      verifiedUsernameDisplay({ username: "​", displayName: "  \n" }),
    ).toBeNull();
  });

  it("tidies what buyers read (owner answer Q-43 a)", () => {
    expect(
      verifiedUsernameDisplay({
        username: "‮maya.films​",
        displayName: null,
      }),
    ).toBe("@maya.films");
    expect(
      verifiedUsernameDisplay({
        username: null,
        displayName: " Maya\n\tFilms⁦ ",
      }),
    ).toBe("Maya Films");
  });
});

describe("verifiedAs (07 D43; createVideoFromPost's step 3, the Source page's state)", () => {
  const demo = {
    status: "connected",
    username: "demo.creator",
    displayName: "Demo Creator",
  } as const;

  it("a connected account verifies under its display form", () => {
    expect(verifiedAs(demo)).toBe("@demo.creator");
    expect(verifiedAs({ ...demo, username: null })).toBe("Demo Creator");
  });

  it.each(["needs_reconnect", "disconnected"] as const)(
    "an account that is %s can't verify",
    (status) => {
      expect(verifiedAs({ ...demo, status })).toBeNull();
    },
  );

  it("a connected account with neither a handle nor a name can't verify", () => {
    expect(
      verifiedAs({ ...demo, username: " @ ", displayName: null }),
    ).toBeNull();
  });
});

describe("badgeText (04 §9.19; 07 D43, D70, D89)", () => {
  const maya: VerifiedBadgeInput = {
    size: "lg",
    ownership: "verified_owner",
    provider: "instagram",
    platformLabel: "Instagram",
    verifiedUsername: "@maya.films",
    linkedAt: new Date("2026-10-12T09:00:00Z"),
    noLongerLinked: false,
  };

  it("lg: the account on the platform, and the day it was linked", () => {
    expect(badgeText(maya)).toEqual({
      line1: "Verified · @maya.films on Instagram",
      line2: "Account linked 12 Oct 2026",
    });
  });

  it("lg after a disconnect adds ' · no longer linked'", () => {
    expect(badgeText({ ...maya, noLongerLinked: true })).toEqual({
      line1: "Verified · @maya.films on Instagram",
      line2: "Account linked 12 Oct 2026 · no longer linked",
    });
  });

  it("sm: one line, the platform after a dot", () => {
    expect(badgeText({ ...maya, size: "sm" })).toEqual({
      line1: "Verified · @maya.films · Instagram",
      line2: null,
    });
    expect(
      badgeText({ ...maya, size: "sm", noLongerLinked: true }).line2,
    ).toBeNull();
  });

  it("a YouTube channel without a handle reads its title, with no @", () => {
    const channel = {
      ...maya,
      provider: "youtube",
      platformLabel: "YouTube",
      verifiedUsername: "Maya Films",
    } as const;
    expect(badgeText(channel)).toEqual({
      line1: "Verified · Maya Films on YouTube",
      line2: "Account linked 12 Oct 2026",
    });
    expect(badgeText({ ...channel, size: "sm" }).line1).toBe(
      "Verified · Maya Films · YouTube",
    );
  });

  it("Demo names the demo account at lg and sm, never the platform", () => {
    const demo = {
      ...maya,
      provider: "mock",
      platformLabel: "Demo",
      verifiedUsername: "@demo.creator",
      linkedAt: "2026-10-01T15:00:00.000Z",
    } as const;
    expect(badgeText(demo)).toEqual({
      line1: "Verified · @demo.creator (demo account)",
      line2: "Account linked 1 Oct 2026",
    });
    expect(badgeText({ ...demo, noLongerLinked: true }).line2).toBe(
      "Account linked 1 Oct 2026 · no longer linked",
    );
    expect(badgeText({ ...demo, size: "sm" })).toEqual({
      line1: "Verified · @demo.creator (demo account)",
      line2: null,
    });
  });

  it("dates the link in UTC from a Date or an ISO string", () => {
    expect(
      badgeText({ ...maya, linkedAt: "2026-10-12T23:30:00-05:00" }).line2,
    ).toBe("Account linked 13 Oct 2026");
  });

  it("self-attested names no platform, at either size", () => {
    for (const size of ["lg", "sm"] as const) {
      expect(badgeText({ size, ownership: "self_attested" })).toEqual({
        line1: "Self-attested by the creator",
        line2: null,
      });
    }
  });

  it("never adds an @ to the stored display form", () => {
    for (const size of ["lg", "sm"] as const) {
      expect(badgeText({ ...maya, size }).line1).not.toContain("@@");
      expect(
        badgeText({ ...maya, size, verifiedUsername: "Maya Films" }).line1,
      ).not.toContain("@");
    }
  });
});

describe("badgeExplainer (04 §9.19, 07 D70)", () => {
  const verified = `The creator connected the account that posted this video. This confirms who controls the account, not who filmed it. ${APP_NAME} didn't compare the delivered file with the post.`;
  const postings = `Verified means the post is on an account the creator linked to ${APP_NAME}. Not verified means the creator added the link, but we couldn't confirm the account is theirs.`;
  const selfAttested = `The creator uploaded this file and confirmed they own the rights. ${APP_NAME} hasn't matched it to a linked social account.`;

  it("verified: D43's explainer, then D70's sentence", () => {
    expect(badgeExplainer("verified_owner")).toEqual([verified, postings]);
  });

  it("self-attested: 01 §4.5's line alone", () => {
    expect(badgeExplainer("self_attested")).toEqual([selfAttested]);
  });

  it("keeps the link and sheet words (04 §11.2)", () => {
    expect(BADGE_COPY.explainerLink).toBe("What does this mean?");
    expect(BADGE_COPY.sheetTitle).toBe("What “Verified” means.");
    expect(BADGE_COPY.selfAttested).toBe("Self-attested by the creator");
  });
});
