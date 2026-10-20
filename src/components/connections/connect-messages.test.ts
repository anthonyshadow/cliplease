import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/app-name";
import { CONNECT_ERROR_CODES } from "@/lib/domain/values";
import {
  accountName,
  CONNECT_ERROR_MESSAGES,
  cardState,
  connectErrorBanner,
  connectErrorCode,
  connectedToastMessage,
  connectStartHref,
  disconnectedToast,
  disconnectTitle,
  liveVideosSentence,
  platformLine,
  rateLimitMessage,
  reconnectMessage,
  syncLine,
} from "./connect-messages";

describe("connect messages (05 §6.2, 07 D37)", () => {
  it("has one line per error code, with no placeholder left", () => {
    for (const code of CONNECT_ERROR_CODES) {
      const message = CONNECT_ERROR_MESSAGES[code];
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("{");
    }
    expect(CONNECT_ERROR_MESSAGES.state).toBe(
      "Finish in the same browser you started in. Try again.",
    );
    expect(CONNECT_ERROR_MESSAGES.already_linked).toContain(SUPPORT_EMAIL);
    expect(CONNECT_ERROR_MESSAGES.provider_error).toBe(
      "Couldn't reach the platform. Try again.",
    );
  });

  it("shows a Banner only for a known code: info for denied, error otherwise", () => {
    expect(connectErrorBanner("denied")).toEqual({
      tone: "info",
      message: "Nothing was linked.",
    });
    expect(connectErrorBanner(["state", "denied"])?.tone).toBe("error");
    for (const raw of ["bogus", "", undefined, "constructor"]) {
      expect(connectErrorBanner(raw)).toBeNull();
    }
  });

  it("names the platform in the connected toast, and ignores anything else", () => {
    expect(connectedToastMessage("mock")).toBe(
      "Demo connected. Showing your latest videos.",
    );
    expect(connectedToastMessage("youtube")).toBe(
      "YouTube connected. Showing your latest videos.",
    );
    for (const raw of ["nope", "", undefined, "__proto__"]) {
      expect(connectedToastMessage(raw)).toBeNull();
    }
  });

  it("encodes returnTo once in the start link, after switch=1 for another account", () => {
    expect(connectStartHref("mock", "/onboarding?step=connect")).toBe(
      "/api/connect/mock/start?returnTo=%2Fonboarding%3Fstep%3Dconnect",
    );
    expect(
      connectStartHref("mock", "/dashboard/connections", { switch: true }),
    ).toBe(
      "/api/connect/mock/start?switch=1&returnTo=%2Fdashboard%2Fconnections",
    );
  });
});

describe("syncLine (04 §11.8, §9.18; owner answer Q-16 a)", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("reads the time since the sync and the video count", () => {
    expect(syncLine({ lastSyncedAt: ago(10_000), postCount: 24 }, now)).toBe(
      "Synced just now · 24 videos",
    );
    expect(
      syncLine({ lastSyncedAt: ago(3 * 60_000), postCount: 24 }, now),
    ).toBe("Synced 3 min ago · 24 videos");
    expect(
      syncLine({ lastSyncedAt: ago(3 * 86_400_000), postCount: 128 }, now),
    ).toBe("Synced 3 days ago · 128 videos");
  });

  it("says 1 video, and videos for every other count", () => {
    expect(syncLine({ lastSyncedAt: ago(0), postCount: 1 }, now)).toBe(
      "Synced just now · 1 video",
    );
    expect(syncLine({ lastSyncedAt: ago(0), postCount: 0 }, now)).toBe(
      "Synced just now · 0 videos",
    );
  });

  it("is null before the first sync has finished", () => {
    expect(syncLine({ lastSyncedAt: null, postCount: 0 }, now)).toBeNull();
  });
});

describe("the account card (04 §9.18, §11.7, §11.8; 07 D43)", () => {
  it("names the account by @username, else its display name or channel title, else the platform", () => {
    const name = (username: string | null, displayName: string | null) =>
      accountName({ platform: "youtube", username, displayName });
    expect(name("demo.creator", "Demo Creator")).toBe("@demo.creator");
    expect(name(null, "Maya Films")).toBe("Maya Films");
    expect(name(null, null)).toBe("YouTube");
  });

  it("writes the platform line by platform first, so the Demo account never reads Creator account", () => {
    expect(
      platformLine({ platform: "mock", accountType: "Media_Creator" }),
    ).toBe("Demo");
    expect(
      platformLine({ platform: "instagram", accountType: "Media_Creator" }),
    ).toBe("Instagram · Creator account");
    expect(
      platformLine({ platform: "instagram", accountType: "Business" }),
    ).toBe("Instagram · Business account");
    expect(platformLine({ platform: "instagram", accountType: null })).toBe(
      "Instagram",
    );
    expect(platformLine({ platform: "youtube", accountType: null })).toBe(
      "YouTube channel",
    );
    expect(platformLine({ platform: "tiktok", accountType: null })).toBe(
      "TikTok",
    );
  });

  it("words the reconnect and rate-limit messages with the platform", () => {
    expect(reconnectMessage("mock")).toBe(
      "Demo signed you out. Reconnect to keep syncing.",
    );
    expect(rateLimitMessage("Demo", 15)).toBe(
      "Demo asked us to slow down. Try again in 15 min.",
    );
  });

  it("says how many live videos came from the account, in the singular for one (owner answer Q-20 a)", () => {
    expect(liveVideosSentence(0, "@maya.films")).toBeNull();
    expect(liveVideosSentence(1, "@maya.films")).toBe(
      '1 live video came from @maya.films. It stays live and keeps its Verified label, marked "no longer linked". Licenses already sold don\'t change.',
    );
    expect(liveVideosSentence(3, "@maya.films")).toBe(
      '3 live videos came from @maya.films. They stay live and keep their Verified label, marked "no longer linked". Licenses already sold don\'t change.',
    );
  });

  it("titles the sheet and the toast with the account (owner answer Q-19 a)", () => {
    expect(disconnectTitle("@demo.creator")).toBe("Disconnect @demo.creator?");
    expect(disconnectedToast("@demo.creator")).toBe(
      "Disconnected @demo.creator.",
    );
  });
});

describe("cardState (04 §9.18, 05 §6.2 States)", () => {
  const healthy = {
    status: "connected" as const,
    syncing: false,
    blockedMinutes: null,
    syncProblem: false,
  };

  it("puts the most urgent state first: reconnect, syncing, rate limited, sync problem", () => {
    const all = {
      status: "needs_reconnect" as const,
      syncing: true,
      blockedMinutes: 15,
      syncProblem: true,
    };
    expect(cardState(all)).toEqual({ kind: "needs_reconnect" });
    expect(cardState({ ...all, status: "connected" })).toEqual({
      kind: "syncing",
    });
    expect(cardState({ ...all, status: "connected", syncing: false })).toEqual({
      kind: "rate_limited",
      minutes: 15,
    });
    expect(cardState({ ...healthy, syncProblem: true })).toEqual({
      kind: "sync_problem",
    });
    expect(cardState(healthy)).toEqual({ kind: "connected" });
  });
});

describe("connectErrorCode", () => {
  it("reads one of the eight codes and ignores anything else", () => {
    expect(connectErrorCode("ig_personal")).toBe("ig_personal");
    expect(connectErrorCode(["state", "denied"])).toBe("state");
    for (const raw of ["nope", "", undefined, "__proto__"]) {
      expect(connectErrorCode(raw)).toBeNull();
    }
  });
});
