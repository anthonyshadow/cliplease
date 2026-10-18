import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../src/db/client";
import { session, user } from "../../../src/db/schema";
import { DAY_MS, MINUTE_MS } from "../../../src/lib/time";
import { auth } from "../../../src/server/auth/auth";
import {
  getCreatorForApi,
  getSessionUser,
  hasStaleSessionCookie,
  requireAdmin,
  requireCreator,
  requireUser,
  toActor,
} from "../../../src/server/auth/session";
import { NOT_FOUND, redirectTo } from "../../helpers/actions";
import {
  mockNextHeaders,
  newCreatorEmail,
  SESSION_COOKIE_NAME,
  signInWithOtp,
  userByEmail,
} from "../../helpers/auth";
import { resetDb } from "../../helpers/db";
import { insertCreator } from "../../helpers/factories";
import { headers as requestHeaders } from "../../helpers/next-headers";

// The session helpers (02 §5.1) against real sessions. Outside a request, redirect() and notFound() throw errors whose
// digest names the outcome.
vi.mock("next/headers", () => import("../../helpers/next-headers"));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));

async function signedIn(email = newCreatorEmail()) {
  mockNextHeaders(await signInWithOtp(email));
  return userByEmail(email);
}

describe("signed out", () => {
  it("sends every gate to /sign-in with next", async () => {
    expect(await getSessionUser()).toBeNull();
    await expect(requireUser()).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fdashboard"),
    );
    await expect(requireUser("/onboarding")).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fonboarding"),
    );
    await expect(
      requireCreator("/dashboard/library?platform=mock"),
    ).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fdashboard%2Flibrary%3Fplatform%3Dmock"),
    );
    await expect(requireAdmin()).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fadmin"),
    );
    expect(await getCreatorForApi()).toBeNull();
    expect(await hasStaleSessionCookie()).toBe(false);
  });

  it("tells a stale session cookie apart from none (the signed-out banner)", async () => {
    mockNextHeaders(`${SESSION_COOKIE_NAME}=ended.c2lnbmF0dXJl`);
    expect(await getSessionUser()).toBeNull();
    expect(await hasStaleSessionCookie()).toBe(true);
  });
});

describe("signed in", () => {
  it("returns the user, and sends a user without a creator profile to /onboarding", async () => {
    const row = await signedIn();
    expect(await requireUser()).toEqual({
      id: row.id,
      email: row.email,
      name: "",
      role: "creator",
    });
    expect(await hasStaleSessionCookie()).toBe(false);
    await expect(requireCreator()).rejects.toMatchObject(
      redirectTo("/onboarding"),
    );
    expect(await getCreatorForApi()).toBeNull();
  });

  it("returns the creator context and its actor once a profile exists", async () => {
    const row = await signedIn();
    const profile = await insertCreator({ userId: row.id });
    const ctx = await requireCreator();
    expect(ctx.creator).toEqual({
      id: profile.id,
      handle: profile.handle,
      displayName: profile.displayName,
      approvalWindowHours: 72,
      timeZone: "UTC",
      payoutCurrency: "cad",
      stripeAccountId: null,
      payoutsStatus: "not_started",
    });
    expect(await getCreatorForApi()).toEqual(ctx);
    expect(toActor(ctx)).toEqual({
      kind: "creator",
      userId: row.id,
      creatorId: profile.id,
    });
  });

  it("never extends the session from a page read; the auth route does, and re-sets the cookie", async () => {
    const row = await signedIn();
    // Signed in 2 days ago: past the 1-day updateAge, so a refresh is due.
    const due = new Date(Date.now() + 5 * DAY_MS);
    await db
      .update(session)
      .set({ expiresAt: due })
      .where(eq(session.userId, row.id));
    const expiresAt = async () =>
      (
        await db
          .select({ expiresAt: session.expiresAt })
          .from(session)
          .where(eq(session.userId, row.id))
      )[0].expiresAt.getTime();

    await requireUser();
    expect(await expiresAt()).toBe(due.getTime());

    // The browser's call (SessionRefresh), with the same cookie the page read used.
    const response = await auth.handler(
      new Request(new URL("/api/auth/get-session", auth.options.baseURL), {
        headers: await requestHeaders(),
      }),
    );
    expect(response.status).toBe(200);
    expect(await expiresAt()).toBeGreaterThan(
      Date.now() + 7 * DAY_MS - MINUTE_MS,
    );
    const [cookie] = response.headers.getSetCookie();
    expect(cookie).toMatch(/^better-auth\.session_token=.*Max-Age=604800/);
  });

  it("shows a creator the 404 on admin pages", async () => {
    await signedIn();
    await expect(requireAdmin()).rejects.toMatchObject(NOT_FOUND);
  });

  it("lets an ADMIN_EMAILS user through requireAdmin, reading the role fresh", async () => {
    const row = await signedIn("e2e-admin@example.com");
    expect(await requireAdmin()).toMatchObject({ id: row.id, role: "admin" });
    await db.update(user).set({ role: "creator" }).where(eq(user.id, row.id));
    await expect(requireAdmin()).rejects.toMatchObject(NOT_FOUND);
  });
});
