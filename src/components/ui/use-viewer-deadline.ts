import { formatDeadline } from "@/lib/format";
import { useClientValue } from "./use-client-value";

/** The viewer's zone, read in the browser only. */
const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * A page's deadline in the viewer's zone (01 G.7, 07 D84: "Sun 18 Oct, 3:10 PM EDT"), read after mount so the server's
 * HTML and the first client render agree (02 §4.4); null before then and without one.
 */
export function useViewerDeadline(iso: string | null): string | null {
  return useClientValue(
    () => (iso ? formatDeadline(new Date(iso), viewerTimeZone()) : null),
    null,
  );
}
