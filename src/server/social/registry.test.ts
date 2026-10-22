import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_PROFILE } from "../../../tests/helpers/social-fixtures";
import { env } from "../env";
import { mockProvider } from "./providers/mock";
import {
  createSocialRegistry,
  enabledPlatforms,
  getProvider,
  mockEnabled,
  redirectUriFor,
} from "./registry";
import type { SocialProvider } from "./types";

const APP_URL = "http://localhost:3000";
const fakeYouTube = { ...mockProvider, platform: "youtube" } as SocialProvider;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSocialRegistry (02 §5.3)", () => {
  it("lists enabled platforms in the UI order, whatever the env order", () => {
    const registry = createSocialRegistry(
      { ENABLED_SOCIAL_PROVIDERS: ["mock", "youtube"], APP_URL },
      { mock: mockProvider, youtube: fakeYouTube },
    );
    expect(registry.enabledPlatforms()).toEqual(["youtube", "mock"]);
    expect(registry.getProvider("youtube")?.platform).toBe("youtube");
  });

  it("answers null for a platform that isn't enabled or isn't a provider", () => {
    const registry = createSocialRegistry({
      ENABLED_SOCIAL_PROVIDERS: ["mock"],
      APP_URL,
    });
    for (const name of [
      "youtube",
      "nope",
      "MOCK",
      "",
      "constructor",
      "__proto__",
    ]) {
      expect(registry.getProvider(name)).toBeNull();
    }
    expect(registry.getProvider("mock")?.platform).toBe("mock");
  });

  it("hands out each adapter with its reads cleaned (text.ts), the rest its own", async () => {
    const provider = createSocialRegistry({
      ENABLED_SOCIAL_PROVIDERS: ["mock"],
      APP_URL,
    }).getProvider("mock");
    vi.spyOn(mockProvider, "getProfile").mockResolvedValue({
      ...DEMO_PROFILE,
      username: "demo.creator\u0000",
    });
    expect(await provider?.getProfile("t")).toEqual(DEMO_PROFILE);
    expect(provider?.requiredScopes).toBe(mockProvider.requiredScopes);
  });

  it("fails when an enabled platform has no adapter yet", () => {
    expect(() =>
      createSocialRegistry({
        ENABLED_SOCIAL_PROVIDERS: ["mock", "instagram"],
        APP_URL,
      }),
    ).toThrow(
      "ENABLED_SOCIAL_PROVIDERS: instagram adapter not built yet (P27–P29)",
    );
  });

  it("builds the callback URL from APP_URL", () => {
    const registry = createSocialRegistry({
      ENABLED_SOCIAL_PROVIDERS: ["mock"],
      APP_URL,
    });
    expect(registry.redirectUriFor("mock")).toBe(
      "http://localhost:3000/api/connect/mock/callback",
    );
  });
});

describe("the app's registry", () => {
  it("enables the mock in test runs and returns the same adapter every time", () => {
    expect(enabledPlatforms()).toEqual(["mock"]);
    expect(mockEnabled()).toBe(true);
    expect(getProvider("mock")).toBe(getProvider("mock"));
    expect(redirectUriFor("mock")).toBe(
      `${env.APP_URL}/api/connect/mock/callback`,
    );
  });
});
