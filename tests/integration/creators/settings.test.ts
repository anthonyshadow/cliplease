import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveDisplayName,
  updateCreatorSettings,
  updateTimeZoneFromDevice,
} from "../../../src/app/(dashboard)/dashboard/settings/actions";
import { db } from "../../../src/db/client";
import { auditEvent, creatorProfile, user } from "../../../src/db/schema";
import type { PayoutsStatus } from "../../../src/lib/domain/values";
import { REQUESTS_SETTINGS_COPY } from "../../../src/lib/payouts";
import { GENERIC_ERROR_MESSAGE } from "../../../src/lib/result";
import { MINUTE_MS } from "../../../src/lib/time";
import { DISPLAY_NAME_COPY } from "../../../src/lib/validation/display-name";
import { requireUser } from "../../../src/server/auth/session";
import {
  CreatorSettingsError,
  completeOnboarding,
  updateCreatorSettings as saveSettings,
  updateTimeZone,
} from "../../../src/server/creators/profile";
import { paymentsDriver } from "../../../src/server/payments/registry";
import { formOf, redirectTo } from "../../helpers/actions";
import {
  mockNextHeaders,
  newCreatorEmail,
  signInWithOtp,
} from "../../helpers/auth";
import { randomHex, uniqueTestHandle } from "../../helpers/factories";
import { captureLogEvents } from "../../helpers/logs";

// Settings (05 §6.11, 07 D20, D84): the display-name and time-zone actions and updateTimeZone. Outside a request
// revalidatePath has no store to clear, so it is a spy here. P19c: Requests → Save and updateCreatorSettings, the
// approval window and auto-approve for new requests (07 D81; owner answer Q-153), on the fake payments driver.
vi.mock("next/headers", () => import("../../helpers/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  mockNextHeaders(null);
  vi.mocked(revalidatePath).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
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

/**
 * The creator's stored auto-approve, and a connected account whose payouts read `payoutsStatus` `age` minutes ago (0 is
 * fresh: no new reading; over 10 is due one).
 */
async function storedSettings(
  creatorId: string,
  {
    payoutsStatus,
    age = 0,
    autoApprove = false,
  }: { payoutsStatus: PayoutsStatus; age?: number; autoApprove?: boolean },
) {
  await db
    .update(creatorProfile)
    .set({
      stripeAccountId: `acct_fake_${randomHex(6)}`,
      payoutsStatus,
      payoutsStatusSyncedAt: new Date(Date.now() - age * MINUTE_MS),
      autoApprove,
    })
    .where(eq(creatorProfile.id, creatorId));
}

/** What Requests → Save posts: the chosen tile's hours and the Switch's hidden input. */
const requestsForm = (approvalWindowHours: string, autoApprove: "on" | "off") =>
  formOf({ approvalWindowHours, autoApprove });

const SAVED = { ok: true, data: undefined };

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

describe("Requests → Save (07 D81; owner answer Q-153)", () => {
  it("saves the window and auto-approve with payouts active, in one audit, and refreshes Settings", async () => {
    const { creatorId } = await signedInCreator();
    await storedSettings(creatorId, { payoutsStatus: "active" });

    expect(await updateCreatorSettings(null, requestsForm("48", "on"))).toEqual(
      SAVED,
    );
    expect(await profile(creatorId)).toMatchObject({
      approvalWindowHours: 48,
      autoApprove: true,
    });
    expect(await updates(creatorId)).toEqual([
      {
        fields: ["approvalWindowHours", "autoApprove"],
        approvalWindowHours: 48,
        autoApprove: true,
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/settings");
  });

  it("refuses a window that isn't one of the four, writing nothing", async () => {
    const { creatorId } = await signedInCreator();
    const before = await profile(creatorId);

    for (const hours of ["36", "", "abc"]) {
      expect(
        await updateCreatorSettings(null, requestsForm(hours, "on")),
      ).toEqual({
        ok: false,
        error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
      });
    }
    expect(await profile(creatorId)).toEqual(before);
    expect(await updates(creatorId)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("saves auto-approve off when the form leaves it out", async () => {
    const { creatorId } = await signedInCreator();

    expect(
      await updateCreatorSettings(null, formOf({ approvalWindowHours: "120" })),
    ).toEqual(SAVED);
    expect(await profile(creatorId)).toMatchObject({
      approvalWindowHours: 120,
      autoApprove: false,
    });
    expect(await updates(creatorId)).toEqual([
      {
        fields: ["approvalWindowHours", "autoApprove"],
        approvalWindowHours: 120,
        autoApprove: false,
      },
    ]);
  });

  it.each(["pending", "restricted"] as const)(
    "refuses turning auto-approve on while payouts are %s, writing nothing",
    async (payoutsStatus) => {
      const { creatorId } = await signedInCreator();
      await storedSettings(creatorId, { payoutsStatus });
      const before = await profile(creatorId);

      expect(
        await updateCreatorSettings(null, requestsForm("24", "on")),
      ).toEqual({
        ok: false,
        error: {
          code: "payouts_not_active",
          message: REQUESTS_SETTINGS_COPY.autoApproveLocked,
        },
      });
      expect(await profile(creatorId)).toEqual(before);
      expect(await updates(creatorId)).toEqual([]);
      // The refusal may have stored a new payouts reading, so the page is read again.
      expect(revalidatePath).toHaveBeenCalledExactlyOnceWith(
        "/dashboard/settings",
      );
    },
  );

  it("keeps auto-approve on, or turns it off, whatever the payouts status: only turning it on needs payouts active", async () => {
    const { creatorId } = await signedInCreator();
    await storedSettings(creatorId, {
      payoutsStatus: "pending",
      autoApprove: true,
    });

    expect(await updateCreatorSettings(null, requestsForm("24", "on"))).toEqual(
      SAVED,
    );
    expect(await profile(creatorId)).toMatchObject({
      approvalWindowHours: 24,
      autoApprove: true,
    });
    expect(
      await updateCreatorSettings(null, requestsForm("24", "off")),
    ).toEqual(SAVED);
    expect((await profile(creatorId)).autoApprove).toBe(false);
  });

  it("refuses turning auto-approve on when the payouts reading fails, with the generic message and one warn line", async () => {
    const { creatorId } = await signedInCreator();
    // A stale 'active' is never trusted: turning auto-approve on reads it again.
    await storedSettings(creatorId, { payoutsStatus: "active", age: 11 });
    const before = await profile(creatorId);
    const fetchStatus = vi
      .spyOn(paymentsDriver("cad"), "fetchPayoutsStatus")
      .mockRejectedValue(new Error("x"));
    const logged = captureLogEvents("creator_settings.payouts_read_failed");

    const result = await updateCreatorSettings(null, requestsForm("48", "on"));
    const { events } = logged();
    expect(result).toEqual({
      ok: false,
      error: { code: "payouts_read_failed", message: GENERIC_ERROR_MESSAGE },
    });
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      {
        ts: expect.any(String),
        level: "warn",
        event: "creator_settings.payouts_read_failed",
        creatorId,
        error: "Error",
      },
    ]);
    expect(await profile(creatorId)).toEqual(before);
    expect(await updates(creatorId)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("never asks Stripe for a save that keeps auto-approve on, turns it off or changes only the window", async () => {
    const { creatorId } = await signedInCreator();
    await storedSettings(creatorId, {
      payoutsStatus: "active",
      age: 11,
      autoApprove: true,
    });
    const fetchStatus = vi.spyOn(paymentsDriver("cad"), "fetchPayoutsStatus");

    for (const form of [
      requestsForm("48", "on"),
      requestsForm("72", "off"),
      requestsForm("120", "off"),
    ]) {
      expect(await updateCreatorSettings(null, form)).toEqual(SAVED);
    }
    expect(await profile(creatorId)).toMatchObject({
      approvalWindowHours: 120,
      autoApprove: false,
    });
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it("sends a signed-out caller to sign-in before any write", async () => {
    await expect(
      updateCreatorSettings(null, requestsForm("48", "on")),
    ).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fdashboard%2Fsettings"),
    );
  });
});

describe("updateCreatorSettings (07 D81)", () => {
  it("refuses a window that isn't one of the four with invalid_input, writing nothing", async () => {
    const { owner, creatorId } = await signedInCreator();
    const actor = { kind: "creator", userId: owner.id, creatorId } as const;
    const before = await profile(creatorId);

    const refused = await saveSettings(actor, {
      approvalWindowHours: 36,
      autoApprove: false,
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CreatorSettingsError);
    expect(refused).toMatchObject({ code: "invalid_input" });
    expect(await profile(creatorId)).toEqual(before);
    expect(await updates(creatorId)).toEqual([]);
  });
});
