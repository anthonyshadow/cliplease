// The email time zone (07 D84). Pure. Never Intl.supportedValuesOf: its list differs between runtimes.
const ZONE_RE = /^[A-Za-z0-9_+\-/:]+$/;

/** `input` trimmed when it is a zone this runtime accepts, else "UTC". Returns the zone as given, not a canonical form. */
export function normalizeTimeZone(input: string | null | undefined): string {
  const zone = (input ?? "").trim();
  if (zone === "" || zone.length > 64 || !ZONE_RE.test(zone)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}
