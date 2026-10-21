import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveDisplayName,
  updateTimeZoneFromDevice,
} from "../../../src/app/(dashboard)/dashboard/settings/actions";
import { db } from "../../../src/db/client";
import { auditEvent, creatorProfile, user } from "../../../src/db/schema";
import { GENERIC_ERROR_MESSAGE } from "../../../src/lib/result";
import { DISPLAY_NAME_COPY } from "../../../src/lib/validation/display-name";
import { requireUser } from "../../../src/server/auth/session";
import {
  completeOnboarding,
  updateTimeZone,
} from "../../../src/server/creators/profile";
import { formOf, redirectTo } from "../../helpers/actions";
import {
  mockNextHeaders,
  newCreatorEmail,
  signInWithOtp,
} from "../../helpers/auth";
import { resetDb } from "../../helpers/db";
import { uniqueTestHandle } from "../../helpers/factories";

// Settings (05 §6.11, 07 D20, D84): the display-name and time-zone actions and updateTimeZone. Outside a request
// revalidatePath has no store to clear, so it is a spy here.
vi.mock("next/headers", () => import("../../helpers/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

afterAll(resetDb);
beforeEach(() => {
  mockNextHeaders(null);
  vi.mocked(revalidatePath).mockClear();
});

/** A signed-in creator (sign-in, then onboarding) for the actions' requireCreator. */
async function signedInCreator() {
  mockNextHeaders(await signInWithOtp(newCreatorEmail()));
  const owner = await requireUser();
  const { creatorId } = await completeOnboarding(owner, {
    displayName: "Maya R.",
    handle: uniqueTestHandle(),
    ageConfirmed: true,
    timeZone: "America/Toronto",
  });
  return { owner, creatorId };
}

async function profile(creatorId: string) {
  const [row] = await db
    .select()
    .from(creatorProfile)
    .where(eq(creatorProfile.id, creatorId));
  return row;
}

async function updates(creatorId: string) {
  const rows = await db
    .select({ data: auditEvent.data })
    .from(auditEvent)
    .where(eq(auditEvent.entityId, creatorId))
    .orderBy(asc(auditEvent.createdAt));
  return rows.map((row) => row.data).filter((data) => "fields" in data);
}

describe("updateTimeZone", () => {
  it("stores a real zone as given and an unknown one as UTC, changing nothing else", async () => {
    const { owner, creatorId } = await signedInCreator();
    const actor = { kind: "creator", userId: owner.id, creatorId } as const;
    const before = await profile(creatorId);

    await updateTimeZone(actor, { timeZone: "Asia/Kolkata" });
    const after = await profile(creatorId);
    expect(after.timeZone).toBe("Asia/Kolkata");
    const { timeZone: _was, updatedAt: _then, ...unchanged } = before;
    const { timeZone: _is, updatedAt: _now, ...rest } = after;
    expect(rest).toEqual(unchanged);

    await updateTimeZone(actor, { timeZone: "Bogus/Zone" });
    expect((await profile(creatorId)).timeZone).toBe("UTC");
    expect(await updates(creatorId)).toEqual([
      { fields: ["timeZone"] },
      { fields: ["timeZone"] },
    ]);
  });
});

describe("Settings actions", () => {
  it("Save refuses an empty name with its field error, then saves a trimmed one and refreshes the dashboard", async () => {
    const { owner, creatorId } = await signedInCreator();

    expect(await saveDisplayName(null, formOf({ displayName: "   " }))).toEqual(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: DISPLAY_NAME_COPY.empty,
          fields: { displayName: [DISPLAY_NAME_COPY.empty] },
        },
      },
    );
    expect(
      await saveDisplayName(null, formOf({ displayName: "a".repeat(61) })),
    ).toMatchObject({ ok: false, error: { message: DISPLAY_NAME_COPY.long } });
    expect((await profile(creatorId)).displayName).toBe("Maya R.");
    expect(revalidatePath).not.toHaveBeenCalled();

    expect(
      await saveDisplayName(null, formOf({ displayName: "  Maya Rivera " })),
    ).toEqual({
      ok: true,
      data: undefined,
    });
    expect((await profile(creatorId)).displayName).toBe("Maya Rivera");
    const [row] = await db.select().from(user).where(eq(user.id, owner.id));
    expect(row.name).toBe("Maya Rivera");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it("Save tidies the name like a title, so hidden characters never reach the database (owner answer Q-43 a)", async () => {
    const { owner, creatorId } = await signedInCreator();

    expect(
      await saveDisplayName(
        null,
        formOf({ displayName: "\u202eMaya\u0000 R.\u200b\nFilms" }),
      ),
    ).toEqual({ ok: true, data: undefined });
    expect((await profile(creatorId)).displayName).toBe("Maya R. Films");
    const [row] = await db.select().from(user).where(eq(user.id, owner.id));
    expect(row.name).toBe("Maya R. Films");

    expect(
      await saveDisplayName(null, formOf({ displayName: "\u200b\u2066 " })),
    ).toMatchObject({
      ok: false,
      error: {
        message: DISPLAY_NAME_COPY.empty,
        fields: { displayName: [DISPLAY_NAME_COPY.empty] },
      },
    });
    expect((await profile(creatorId)).displayName).toBe("Maya R. Films");
  });

  it("Update from this device stores the browser's zone, and one over 64 characters as UTC (07 D84)", async () => {
    const { creatorId } = await signedInCreator();

    expect(
      await updateTimeZoneFromDevice({ timeZone: "Europe/Paris" }),
    ).toEqual({ ok: true, data: undefined });
    expect((await profile(creatorId)).timeZone).toBe("Europe/Paris");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/settings");

    expect(
      await updateTimeZoneFromDevice({ timeZone: "A".repeat(65) }),
    ).toEqual({ ok: true, data: undefined });
    expect((await profile(creatorId)).timeZone).toBe("UTC");
    expect(await updates(creatorId)).toEqual([
      { fields: ["timeZone"] },
      { fields: ["timeZone"] },
    ]);
  });

  it("Update from this device refuses a zone that isn't a string without throwing or writing", async () => {
    const { creatorId } = await signedInCreator();

    expect(
      await updateTimeZoneFromDevice({ timeZone: 42 as unknown as string }),
    ).toEqual({
      ok: false,
      error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
    });
    expect((await profile(creatorId)).timeZone).toBe("America/Toronto");
    expect(await updates(creatorId)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sends a signed-out caller to sign-in before any write", async () => {
    const toSignIn = redirectTo("/sign-in?next=%2Fdashboard%2Fsettings");
    await expect(
      updateTimeZoneFromDevice({ timeZone: "Europe/Paris" }),
    ).rejects.toMatchObject(toSignIn);
    await expect(
      updateTimeZoneFromDevice({ timeZone: 42 as unknown as string }),
    ).rejects.toMatchObject(toSignIn);
    await expect(
      saveDisplayName(null, formOf({ displayName: "Maya" })),
    ).rejects.toMatchObject(toSignIn);
  });
});
