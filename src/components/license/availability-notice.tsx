import { Lock } from "lucide-react";
import { Notice } from "@/components/ui/notice";
import { formatPostDate } from "@/lib/format";
import { AVAILABILITY_COPY } from "@/lib/licensing/availability";
import type { LicensePageDTO } from "@/lib/licensing/license-page";
import { cn } from "@/lib/utils";

const COPY = AVAILABILITY_COPY.notice;

type Availability = LicensePageDTO["availability"];

/** The notice's words, or null for a video that can take a request. */
function noticeCopy({
  state,
  until,
}: Availability): { title: string; body?: string } | null {
  if (state === "reserved") {
    return { title: COPY.reservedTitle, body: COPY.reservedBody };
  }
  if (!until) return null;
  const date = formatPostDate(new Date(until));
  if (state === "exclusive_active") {
    return { title: COPY.exclusiveActive(date) };
  }
  return state === "renewal_reserved"
    ? { title: COPY.renewalReserved(date) }
    : null;
}

/**
 * 04 §9.35: why this video's page has no options (07 D110, D122), page content present at load, so no `role="status"`.
 * `data-availability-notice` and `tabIndex`: AvailabilityFocus moves focus here after a refusal. The wrapper takes the
 * tier class because `Notice` is `flex` and would beat `hidden` (owner answer Q-169: one copy for each side of lg).
 */
export function AvailabilityNotice({
  availability,
  className,
}: {
  availability: Availability;
  className?: string;
}) {
  const copy = noticeCopy(availability);
  if (!copy) return null;
  return (
    <div
      data-availability-notice
      tabIndex={-1}
      className={cn("rounded-md outline-none", className)}
    >
      <Notice icon={Lock} title={copy.title}>
        {copy.body}
      </Notice>
    </div>
  );
}
