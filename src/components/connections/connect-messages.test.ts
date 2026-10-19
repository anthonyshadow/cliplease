import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/app-name";
import { CONNECT_ERROR_CODES } from "@/lib/domain/values";
import {
  accountLine,
  CONNECT_ERROR_MESSAGES,
  connectErrorBanner,
  connectedToastMessage,
  connectStartHref,
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

  it("writes one line per account", () => {
    expect(
      accountLine({
        platform: "mock",
        username: "demo.creator",
        displayName: "Demo Creator",
        status: "connected",
      }),
    ).toBe("@demo.creator · Demo · Connected");
    expect(
      accountLine({
        platform: "youtube",
        username: null,
        displayName: "Maya Films",
        status: "needs_reconnect",
      }),
    ).toBe("Maya Films · YouTube · Needs reconnect");
  });

  it("encodes returnTo once in the start link", () => {
    expect(connectStartHref("mock", "/onboarding?step=connect")).toBe(
      "/api/connect/mock/start?returnTo=%2Fonboarding%3Fstep%3Dconnect",
    );
  });
});
