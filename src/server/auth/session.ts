import "server-only";
import { getSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client";
import { creatorProfile } from "@/db/schema";
import {
  APPROVAL_WINDOW_HOURS,
  type ApprovalWindowHours,
  type Currency,
  type PayoutsStatus,
  type UserRole,
} from "@/lib/domain/values";
import {
  SESSION_EXPIRES_IN_S,
  SESSION_UPDATE_AGE_S,
  signInPath,
} from "@/lib/sign-in";
import type { Actor } from "./actor";
import { auth } from "./auth";

// Session helpers (02 §5.1). The role is read fresh on every request (no cookie cache).
export type Role = UserRole;
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};
export type CreatorContext = {
  user: SessionUser;
  creator: {
    id: string;
    handle: string;
    displayName: string;
    approvalWindowHours: ApprovalWindowHours;
    timeZone: string;
    payoutCurrency: Currency;
    stripeAccountId: string | null;
    payoutsStatus: PayoutsStatus;
  };
};

/**
 * The session, once per request. The read never extends it: a Server Component can't write the cookie, so the expiry
 * would move in the database but not in the browser. SessionRefresh extends it through the auth route instead.
 */
const readSession = cache(async () =>
  auth.api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  }),
);

/** The signed-in user, once per request. `name` is "" after an OTP sign-up until onboarding sets it (P05). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await readSession();
  if (!session) return null;
  const { id, email, name, role } = session.user;
  return { id, email, name, role: role === "admin" ? "admin" : "creator" };
});

const getCreatorContext = cache(
  async (user: SessionUser): Promise<CreatorContext | null> => {
    const [profile] = await db
      .select()
      .from(creatorProfile)
      .where(eq(creatorProfile.userId, user.id))
      .limit(1);
    if (!profile) return null;
    return {
      user,
      creator: {
        id: profile.id,
        handle: profile.handle,
        displayName: profile.displayName,
        // A CHECK keeps the column to these values; 72 is the column default.
        approvalWindowHours:
          APPROVAL_WINDOW_HOURS.find(
            (h) => h === profile.approvalWindowHours,
          ) ?? 72,
        timeZone: profile.timeZone,
        payoutCurrency: profile.payoutCurrency,
        stripeAccountId: profile.stripeAccountId,
        payoutsStatus: profile.payoutsStatus,
      },
    };
  },
);

/** When Better Auth would extend the session again (epoch ms): a day after its last extension. Null when signed out. */
export async function getSessionRefreshAt(): Promise<number | null> {
  const session = await readSession();
  if (!session) return null;
  const expiresAt = new Date(session.session.expiresAt).getTime();
  return expiresAt - (SESSION_EXPIRES_IN_S - SESSION_UPDATE_AGE_S) * 1000;
}

/** True when the request carries a session cookie that no longer signs anyone in (the signed-out banner). */
export async function hasStaleSessionCookie(): Promise<boolean> {
  return (
    getSessionCookie(await headers()) !== null &&
    (await getSessionUser()) === null
  );
}

/** The signed-in user, else a redirect to /sign-in?next=… */
export async function requireUser(next = "/dashboard"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(signInPath(next));
  return user;
}

/** The creator, else /sign-in, or /onboarding when the user has no creator profile yet. */
export async function requireCreator(
  next = "/dashboard",
): Promise<CreatorContext> {
  const user = await requireUser(next);
  const ctx = await getCreatorContext(user);
  if (!ctx) redirect("/onboarding");
  return ctx;
}

/** An admin, else /sign-in when nobody is signed in, or the 404 page for everyone else. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser("/admin");
  if (user.role !== "admin") notFound();
  return user;
}

/** The creator, or null when signed out or without a profile: route handlers answer 401, the creator shell renders bare. */
export async function getCreatorForApi(): Promise<CreatorContext | null> {
  const user = await getSessionUser();
  return user ? getCreatorContext(user) : null;
}

export function toActor(ctx: CreatorContext): Actor {
  return { kind: "creator", userId: ctx.user.id, creatorId: ctx.creator.id };
}
