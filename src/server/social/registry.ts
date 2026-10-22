import "server-only";
import {
  SOCIAL_PROVIDERS,
  type SocialProviderId,
} from "../../lib/domain/values";
import { type Env, env } from "../env";
import { mockProvider } from "./providers/mock";
import { withCleanReads } from "./text";
import type { SocialProvider } from "./types";

// The enabled providers (02 §5.3), parsed once from ENABLED_SOCIAL_PROVIDERS. Only the mock has an adapter until the real
// platforms arrive (YouTube P27, Instagram P28, TikTok P29); enabling one sooner fails at the first import. The
// per-platform *_REDIRECT_URI overrides are Phase C env vars that those prompts add. Each adapter is handed out with its
// reads cleaned (text.ts): this is where platform data enters the app.

export type SocialRegistry = {
  /** Enabled platforms in the UI order (Instagram · TikTok · YouTube · Demo), whatever the env order. */
  enabledPlatforms(): readonly SocialProviderId[];
  /** The adapter (its reads cleaned), or null when `platform` isn't a provider or isn't enabled (routes answer 404). */
  getProvider(platform: string): SocialProvider | null;
  redirectUriFor(p: SocialProviderId): string;
};

/** A registry for `e`: the app's env in production code, an injected one in tests. */
export function createSocialRegistry(
  e: Pick<Env, "ENABLED_SOCIAL_PROVIDERS" | "APP_URL">,
  adapters: Partial<Record<SocialProviderId, SocialProvider>> = {
    mock: mockProvider,
  },
): SocialRegistry {
  const enabled = SOCIAL_PROVIDERS.filter((p) =>
    e.ENABLED_SOCIAL_PROVIDERS.includes(p),
  );
  // Keyed by the platform name: any other string (including "constructor" or "__proto__") finds nothing.
  const byPlatform = new Map<string, SocialProvider>();
  for (const p of enabled) {
    const adapter = adapters[p];
    if (!adapter) {
      throw new Error(
        `ENABLED_SOCIAL_PROVIDERS: ${p} adapter not built yet (P27–P29)`,
      );
    }
    byPlatform.set(p, withCleanReads(adapter));
  }
  return {
    enabledPlatforms: () => enabled,
    getProvider: (platform) => byPlatform.get(platform) ?? null,
    redirectUriFor: (p) => `${e.APP_URL}/api/connect/${p}/callback`,
  };
}

export const { enabledPlatforms, getProvider, redirectUriFor } =
  createSocialRegistry(env);

/** Whether the mock (Demo) platform is enabled: Demo links are read and Demo postings taken only then. */
export function mockEnabled(): boolean {
  return enabledPlatforms().includes("mock");
}
