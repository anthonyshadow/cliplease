import { formatPostDate } from "@/lib/format";
import {
  AVAILABILITY_COPY,
  type AvailabilityDisplay,
} from "@/lib/licensing/availability";

const COPY = AVAILABILITY_COPY.line;

type AvailabilityLineProps = {
  availability: AvailabilityDisplay;
  audience: "creator" | "public";
  /** The running exclusive licensee, for the creator's words only. */
  licenseeName?: string | null;
  /** The video page's perpetual line: a perpetual license runs while exclusive licenses are on offer. */
  perpetualBlocksExclusive?: boolean;
};

/** The line's words, or null with nothing to say. Only the creator's words name a licensee; with no name, the public's. */
function lineText({
  availability: { state, until },
  audience,
  licenseeName,
  perpetualBlocksExclusive,
}: AvailabilityLineProps): string | null {
  const name = audience === "creator" ? licenseeName : null;
  const date = until ? formatPostDate(new Date(until)) : null;
  switch (state) {
    case "reserved":
      return audience === "creator" ? COPY.requestWaiting : COPY.reserved;
    case "exclusive_active":
      if (!date) return null;
      return name ? COPY.licensedTo(name, date) : COPY.licensedUntil(date);
    case "renewal_reserved":
      return name && date ? COPY.reservedFor(name, date) : COPY.reserved;
    case "non_exclusive_only":
      return audience === "creator" && perpetualBlocksExclusive
        ? COPY.perpetual
        : null;
    case "open":
      return null;
  }
}

/**
 * What holds a video, one plain line at every state (07 D110): on a creator's card and video page, and the public grid's
 * card, under its price, where it wraps inside the card. It takes the display shape, never a plan id or `canRequest*`.
 */
export function AvailabilityLine(props: AvailabilityLineProps) {
  const text = lineText(props);
  if (!text) return null;
  return (
    <p className="text-footnote text-ink-2 tabular-nums wrap-anywhere">
      {text}
    </p>
  );
}
