import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { completeOnboarding as completeOnboardingAction } from "../../../src/app/(dashboard)/onboarding/actions";
import { db } from "../../../src/db/client";
import {
  auditEvent,
  creatorProfile,
  rateCard,
  rateOption,
  session,
  user,
} from "../../../src/db/schema";
import {
  DEFAULT_BASE_PRICE_CENTS,
  defaultRateOptions,
} from "../../../src/lib/pricing/presets";
import {
  HANDLE_COPY,
  HANDLE_RE,
  handleProblem,
} from "../../../src/lib/validation/handle";
import { AGE_ERROR } from "../../../src/lib/validation/profile";
import {
  requireUser,
  type SessionUser,
} from "../../../src/server/auth/session";
import {
  completeOnboarding,
  OnboardingError,
  updateProfile,
} from "../../../src/server/creators/profile";
import { checkHandleAvailability } from "../../../src/server/creators/queries";
import { INVALID_HANDLES, VALID_HANDLES } from "../../fixtures/handles";
import {
  mockNextHeaders,
  newCreatorEmail,
  signInWithOtp,
} from "../../helpers/auth";
import { expectDbError, PG_ERROR, resetDb } from "../../helpers/db";
import { insertCreator, insertUser, randomHex } from "../../helpers/factories";

// Onboarding (02 §5.2, 07 D93, D94): the domain function, the profile step's action and the handle rules against the
// database. Outside a request, redirect() throws an error whose digest names the target.
vi.mock("next/headers", () => import("../../helpers/next-headers"));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));

/** A free handle for one test: rows build up across the file. */
const uniqueHandle = () => `t.${randomHex(4)}`;

const redirectTo = (url: string) => ({
  digest: `NEXT_REDIRECT;replace;${url};307;`,
});

/** Signs a new email in for the action's requireUser and returns its session user. */
async function signedIn(): Promise<SessionUser> {
  mockNextHeaders(await signInWithOtp(newCreatorEmail()));
  return requireUser();
}

/** A user row as the session helpers return it, without a sign-in (for the domain function only). */
async function sessionUser(): Promise<SessionUser> {
  const row = await insertUser({ name: "" });
  return { id: row.id, email: row.email, name: row.name, role: "creator" };
}

function profileForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

const validInput = (handle: string) =>
  ({
    displayName: "Maya R.",
    handle,
    ageConfirmed: true,
    timeZone: "America/Toronto",
  }) as const;

async function profilesOf(userId: string) {
  return db
    .select()
    .from(creatorProfile)
    .where(eq(creatorProfile.userId, userId));
}

async function auditsBy(userId: string) {
  return db
    .select({
      action: auditEvent.action,
      actorType: auditEvent.actorType,
      entityId: auditEvent.entityId,
      data: auditEvent.data,
    })
    .from(auditEvent)
    .where(eq(auditEvent.actorUserId, userId))
    .orderBy(asc(auditEvent.createdAt));
}

async function userAndSessions(userId: string) {
  const [row] = await db.select().from(user).where(eq(user.id, userId));
  const sessions = await db
    .select()
    .from(session)
    .where(eq(session.userId, userId));
  return { row, sessions };
}

const byKey = <T extends { optionKey: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => a.optionKey.localeCompare(b.optionKey));

describe("completeOnboarding (the domain function)", () => {
  it("writes the profile, a CA$150 rate card with the 10 default options, user.name and one audit row", async () => {
    const owner = await sessionUser();
    const handle = uniqueHandle();
    const before = Date.now();
    const { creatorId } = await completeOnboarding(owner, {
      ...validInput(handle),
      displayName: "  Maya R.  ",
    });

    const [profile] = await profilesOf(owner.id);
    expect(profile).toMatchObject({
      id: creatorId,
      handle,
      displayName: "Maya R.",
      timeZone: "America/Toronto",
      payoutCurrency: "cad",
      stripeAccountId: null,
      payoutsStatus: "not_started",
      approvalWindowHours: 72,
    });
    // now() on the database's clock: allow a little skew either way.
    expect(profile.ageConfirmedAt.getTime()).toBeGreaterThan(before - 60_000);
    expect(profile.ageConfirmedAt.getTime()).toBeLessThan(Date.now() + 60_000);

    const [card] = await db
      .select()
      .from(rateCard)
      .where(eq(rateCard.creatorId, creatorId));
    expect(card.basePriceCents).toBe(DEFAULT_BASE_PRICE_CENTS.cad);
    expect(card.basePriceCents).toBe(15000);
    const options = await db
      .select({
        dimension: rateOption.dimension,
        optionKey: rateOption.optionKey,
        multiplierBps: rateOption.multiplierBps,
        enabled: rateOption.enabled,
        sortOrder: rateOption.sortOrder,
      })
      .from(rateOption)
      .where(eq(rateOption.rateCardId, card.id));
    expect(options).toHaveLength(10);
    expect(byKey(options)).toEqual(byKey(defaultRateOptions()));

    const { row } = await userAndSessions(owner.id);
    expect(row.name).toBe("Maya R.");
    expect(await auditsBy(owner.id)).toEqual([
      {
        action: "creator_profile.created",
        actorType: "creator",
        entityId: creatorId,
        data: { handle },
      },
    ]);
  });

  it.each([
    ["America/Toronto", "America/Toronto"],
    ["Bogus/Zone", "UTC"],
    ["", "UTC"],
  ])("stores the time zone %j as %j", async (given, stored) => {
    const owner = await sessionUser();
    await completeOnboarding(owner, {
      ...validInput(uniqueHandle()),
      timeZone: given,
    });
    const [profile] = await profilesOf(owner.id);
    expect(profile.timeZone).toBe(stored);
  });

  it("refuses ageConfirmed: false before any write (07 D93)", async () => {
    const owner = await sessionUser();
    await expect(
      completeOnboarding(owner, {
        ...validInput(uniqueHandle()),
        ageConfirmed: false as unknown as true,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await profilesOf(owner.id)).toEqual([]);
    expect(await auditsBy(owner.id)).toEqual([]);
  });

  it.each(["admin", "cliplease"])("refuses the reserved %s", async (handle) => {
    const owner = await sessionUser();
    const attempt = completeOnboarding(owner, validInput(handle));
    await expect(attempt).rejects.toBeInstanceOf(OnboardingError);
    await expect(attempt).rejects.toMatchObject({ code: "handle_reserved" });
    expect(await profilesOf(owner.id)).toEqual([]);
  });

  it("refuses a taken handle, and the availability check offers up to 3 free, valid alternatives", async () => {
    const handle = uniqueHandle();
    await completeOnboarding(await sessionUser(), validInput(handle));
    const firstChoice = (await checkHandleAvailability(handle)).suggestions[0];
    // Taking the first suggestion shows the list skips taken candidates.
    await insertCreator({ handle: firstChoice });

    const second = await sessionUser();
    await expect(
      completeOnboarding(second, validInput(handle)),
    ).rejects.toMatchObject({ code: "handle_taken" });
    expect(await profilesOf(second.id)).toEqual([]);
    // The rolled-back transaction leaves user.name alone.
    expect((await userAndSessions(second.id)).row.name).toBe("");

    const availability = await checkHandleAvailability(`@${handle}`);
    expect(availability).toMatchObject({ handle, state: "taken" });
    expect(availability.suggestions.length).toBeGreaterThan(0);
    expect(availability.suggestions.length).toBeLessThanOrEqual(3);
    expect(availability.suggestions).not.toContain(firstChoice);
    for (const suggestion of availability.suggestions) {
      expect(HANDLE_RE.test(suggestion)).toBe(true);
      expect(handleProblem(suggestion)).toBeNull();
      expect(
        await db
          .select({ id: creatorProfile.id })
          .from(creatorProfile)
          .where(eq(creatorProfile.handle, suggestion)),
      ).toEqual([]);
    }
  });

  it("lets exactly one of two users claiming the same handle at once win", async () => {
    const handle = uniqueHandle();
    const [a, b] = [await sessionUser(), await sessionUser()];
    const results = await Promise.allSettled([
      completeOnboarding(a, validInput(handle)),
      completeOnboarding(b, validInput(handle)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [lost] = results.filter((r) => r.status === "rejected");
    expect(lost?.reason).toMatchObject({ code: "handle_taken" });
    const owners = await db
      .select({ userId: creatorProfile.userId })
      .from(creatorProfile)
      .where(eq(creatorProfile.handle, handle));
    expect(owners).toHaveLength(1);
  });

  it("refuses the same user twice with already_onboarded, in turn or at once", async () => {
    const owner = await sessionUser();
    await completeOnboarding(owner, validInput(uniqueHandle()));
    await expect(
      completeOnboarding(owner, validInput(uniqueHandle())),
    ).rejects.toMatchObject({ code: "already_onboarded" });

    const racer = await sessionUser();
    const results = await Promise.allSettled([
      completeOnboarding(racer, validInput(uniqueHandle())),
      completeOnboarding(racer, validInput(uniqueHandle())),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [lost] = results.filter((r) => r.status === "rejected");
    expect(lost?.reason).toMatchObject({ code: "already_onboarded" });
    expect(await profilesOf(racer.id)).toHaveLength(1);
  });
});

describe("the profile step's action", () => {
  it.each([
    ["absent", undefined],
    ["not on", "true"],
  ])(
    "without the tick (%s) returns the 18+ field error and writes nothing (J1.7)",
    async (_, tick) => {
      const owner = await signedIn();
      const before = await userAndSessions(owner.id);
      const fields: Record<string, string> = {
        displayName: "Maya R.",
        handle: uniqueHandle(),
        timeZone: "America/Toronto",
      };
      if (tick !== undefined) fields.ageConfirmed = tick;

      const result = await completeOnboardingAction(null, profileForm(fields));
      expect(AGE_ERROR).toBe("You must be 18 or older to sell on ClipLease.");
      expect(result).toEqual({
        ok: false,
        error: {
          code: "invalid_input",
          message: AGE_ERROR,
          fields: { ageConfirmed: [AGE_ERROR] },
        },
      });
      expect(await profilesOf(owner.id)).toEqual([]);
      expect(await auditsBy(owner.id)).toEqual([]);
      // The user row and its session are untouched, and the session still works.
      expect(await userAndSessions(owner.id)).toEqual(before);
      expect((await requireUser()).id).toBe(owner.id);
    },
  );

  it("normalizes the handle, saves the step and redirects to the connect step", async () => {
    const owner = await signedIn();
    const handle = uniqueHandle();
    await expect(
      completeOnboardingAction(
        null,
        profileForm({
          displayName: "Maya R.",
          handle: ` @${handle.toUpperCase()} `,
          ageConfirmed: "on",
          timeZone: "Europe/Paris",
        }),
      ),
    ).rejects.toMatchObject(redirectTo("/onboarding?step=connect"));
    const [profile] = await profilesOf(owner.id);
    expect(profile).toMatchObject({ handle, timeZone: "Europe/Paris" });
  });

  it("answers a reserved or a just-taken handle with its field error, and a second onboarding with /dashboard", async () => {
    const owner = await signedIn();
    const form = (handle: string) =>
      profileForm({ displayName: "Maya R.", handle, ageConfirmed: "on" });

    expect(await completeOnboardingAction(null, form("admin"))).toEqual({
      ok: false,
      error: {
        code: "handle_reserved",
        message: HANDLE_COPY.reserved,
        fields: { handle: [HANDLE_COPY.reserved] },
      },
    });

    const taken = uniqueHandle();
    await insertCreator({ handle: taken });
    const { suggestions } = await checkHandleAvailability(taken);
    expect(await completeOnboardingAction(null, form(taken))).toEqual({
      ok: false,
      error: {
        code: "handle_taken",
        message: `@${taken} was just taken`,
        fields: { handle: [`@${taken} was just taken`] },
      },
      suggestions,
    });
    expect(await profilesOf(owner.id)).toEqual([]);

    await expect(
      completeOnboardingAction(null, form(uniqueHandle())),
    ).rejects.toMatchObject(redirectTo("/onboarding?step=connect"));
    await expect(
      completeOnboardingAction(null, form(uniqueHandle())),
    ).rejects.toMatchObject(redirectTo("/dashboard"));
  });
});

describe("updateProfile", () => {
  it("changes only the display name, keeps user.name in step and writes one audit row", async () => {
    const owner = await sessionUser();
    const { creatorId } = await completeOnboarding(
      owner,
      validInput(uniqueHandle()),
    );
    const [before] = await profilesOf(owner.id);
    const actor = { kind: "creator", userId: owner.id, creatorId } as const;

    await updateProfile(actor, { displayName: "  Maya Rivera " });
    const [after] = await profilesOf(owner.id);
    const { displayName: _was, updatedAt: _then, ...unchanged } = before;
    const { displayName, updatedAt: _now, ...rest } = after;
    expect(displayName).toBe("Maya Rivera");
    expect(rest).toEqual(unchanged);
    expect((await userAndSessions(owner.id)).row.name).toBe("Maya Rivera");
    expect((await auditsBy(owner.id)).map((a) => [a.action, a.data])).toEqual([
      ["creator_profile.created", { handle: before.handle }],
      ["creator_profile.updated", { fields: ["displayName"] }],
    ]);

    await expect(
      updateProfile(actor, { displayName: "   " }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("the database agrees", () => {
  it.each(VALID_HANDLES)("accepts the handle %s", async (handle) => {
    await expect(insertCreator({ handle })).resolves.toMatchObject({ handle });
  });

  it.each(INVALID_HANDLES)("refuses the handle %s (%s)", async (handle) => {
    await expectDbError(insertCreator({ handle }), {
      code: PG_ERROR.check,
      constraint: "creator_profile_handle_format",
    });
  });

  it("has no column for a date of birth, an age band or a guardian (07 D93)", async () => {
    const columns = await db.execute<{
      table_name: string;
      column_name: string;
    }>(
      sql`select table_name, column_name from information_schema.columns
          where table_schema = 'public'
            and (column_name ~* '(birth|dob|age_band|ageband|guardian)' or column_name ~* '^age')
          order by table_name, column_name`,
    );
    expect(columns.rows).toEqual([
      { table_name: "creator_profile", column_name: "age_confirmed_at" },
    ]);
  });
});
