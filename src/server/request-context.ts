import "server-only";
import { headers } from "next/headers";
import { z } from "zod";

// Where a request came from, for the evidence rows that keep it (terms acceptance now; downloads and renewal consent
// later): an address Postgres's inet accepts, and the browser's user agent cut to what those columns hold.

const IP = z.union([z.ipv4(), z.ipv6()]);

/** The longest user agent a row keeps: the CHECKs on terms_accepted_user_agent and download_event.user_agent. */
const USER_AGENT_MAX = 512;

/**
 * The first x-forwarded-for value (Vercel sets it to the one client address; locally Next fills it from the socket),
 * when it is a plain IPv4 or IPv6 address; anything else (a zone id, a port, junk) is null rather than a failed insert.
 */
export function clientIp(forwardedFor: string | null): string | null {
  const first = forwardedFor?.split(",")[0]?.trim() ?? "";
  return IP.safeParse(first).success ? first : null;
}

/** The user-agent header cut to USER_AGENT_MAX characters, so no row refuses it; null when absent or empty. */
export function clientUserAgent(header: string | null): string | null {
  return header ? header.slice(0, USER_AGENT_MAX) : null;
}

/** A request's client address (one Postgres's inet takes) and user agent (one every row takes); null when absent. */
export type RequestContext = { ip: string | null; userAgent: string | null };

/** This request's client address and user agent. */
export async function requestContext(): Promise<RequestContext> {
  const h = await headers();
  return {
    ip: clientIp(h.get("x-forwarded-for")),
    userAgent: clientUserAgent(h.get("user-agent")),
  };
}
