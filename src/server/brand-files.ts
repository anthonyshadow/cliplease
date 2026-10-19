import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { PLATFORM_MARKS } from "../lib/brand";
import { SOCIAL_PROVIDERS, type SocialProviderId } from "../lib/domain/values";

// Which official mark files a human has added under public/brand/ (04 §8.2), checked once per server process so
// PlatformMark never probes with an <img> that could show a broken image.

let present: Readonly<Record<SocialProviderId, boolean>> | undefined;

export function platformMarkFiles(): Readonly<
  Record<SocialProviderId, boolean>
> {
  present ??= Object.fromEntries(
    SOCIAL_PROVIDERS.map((platform) => {
      const { src } = PLATFORM_MARKS[platform];
      return [
        platform,
        src !== undefined &&
          existsSync(path.join(process.cwd(), "public", src)),
      ];
    }),
  ) as Record<SocialProviderId, boolean>;
  return present;
}
