"use client";

import { useEffect } from "react";
import { SESSION_UPDATE_AGE_S } from "@/lib/sign-in";

// When this page last asked, so a long-open tab asks again only once the next daily extension is due.
let askedAt = 0;

/**
 * Keeps a 7-day sign-in alive while it's used (owner answer, P04). Pages read the session without extending it, because
 * a Server Component can't write the cookie. Once an extension is due (`refreshAt`, from the server) this asks
 * /api/auth/get-session, which extends the session and re-sets the cookie; it checks again when a tab comes back into
 * view. Renders nothing.
 */
export function SessionRefresh({ refreshAt }: { refreshAt: number | null }) {
  useEffect(() => {
    if (refreshAt === null) return;
    const refreshIfDue = () => {
      const now = Date.now();
      if (now < refreshAt || now - askedAt < SESSION_UPDATE_AGE_S * 1000) {
        return;
      }
      askedAt = now;
      // Loaded on first use: most page views never need the auth client.
      void import("@/lib/auth-client")
        .then(({ authClient }) => authClient.getSession())
        .catch(() => null);
    };
    refreshIfDue();
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshIfDue();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshAt]);
  return null;
}
