import { unstable_rethrow } from "next/navigation";
import { type ActionResult, GENERIC_ERROR_MESSAGE } from "@/lib/result";

/** Next's own redirect (an expired session on its way to sign-in) also rejects the action; the router is already going. */
function isNextNavigation(error: unknown): boolean {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}

/**
 * Calls a Server Action from an event handler, never as a form action or inside an async transition: those open React's
 * one async-action scope, which holds every router transition (a link, the search) until the action returns. A
 * rejection (offline, a timeout, a server error) comes back as a refusal with the generic message instead of reaching
 * the error boundary; Next's redirect comes back as null (nothing to say, the page is leaving).
 */
export async function runAction<T>(
  action: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T> | null> {
  try {
    return await action();
  } catch (error) {
    if (isNextNavigation(error)) return null;
    return {
      ok: false,
      error: { code: "failed", message: GENERIC_ERROR_MESSAGE },
    };
  }
}
