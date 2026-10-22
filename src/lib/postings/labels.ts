// A posting's platform name as the UI writes it (07 D67, 04 §9.16). Client-safe: the picker, the owner's step and the
// buyer's PostingList all read it.
import { PLATFORM_LABELS } from "../brand";
import type { PostingPlatform } from "../domain/values";

/** P06's four provider names, plus the three link-only platforms. Other is named by the creator. */
const POSTING_PLATFORM_LABELS = {
  ...PLATFORM_LABELS,
  facebook: "Facebook",
  x: "X",
  snapchat: "Snapchat",
} as const satisfies Record<Exclude<PostingPlatform, "other">, string>;

/** "Instagram" … "Snapchat", "Demo" for mock, and for Other the creator's trimmed name for it ("Other" when it has none). */
export function postingPlatformLabel(
  platform: PostingPlatform,
  otherLabel: string | null,
): string {
  if (platform !== "other") return POSTING_PLATFORM_LABELS[platform];
  const label = otherLabel?.trim() ?? "";
  return label === "" ? "Other" : label;
}
