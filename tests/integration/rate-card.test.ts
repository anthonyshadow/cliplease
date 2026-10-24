import { and, asc, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveRateCard as saveRateCardAction } from "../../src/app/(dashboard)/dashboard/pricing/actions";
import { db } from "../../src/db/client";
import { rateCard, rateOption } from "../../src/db/schema";
import type { RateOptionKey } from "../../src/lib/domain/values";
import { defaultRateOptions } from "../../src/lib/pricing/presets";
import {
  defaultRateCardInput,
  type RateCardInput,
} from "../../src/lib/validation/pricing";
import { requireUser } from "../../src/server/auth/session";
import { completeOnboarding } from "../../src/server/creators/profile";
import {
  getRateCard,
  InvalidRateCardError,
  saveRateCard,
} from "../../src/server/pricing/rate-card";
import { redirectTo } from "../helpers/actions";
import {
  creatorActor,
  mockNextHeaders,
  newCreatorEmail,
  signInWithOtp,
} from "../helpers/auth";
import { uniqueTestHandle } from "../helpers/factories";

// The rate card (J4.1, J4.6, J4.9; 02 §5.5, §6.1) against the test database: onboarding's defaults, the save round
// trip, crafted input the shared schema refuses, and the action's requireCreator. Outside a request refresh() has no
// router to refresh, so it is a spy here.
vi.mock("next/headers", () => import("../helpers/next-headers"));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

beforeEach(() => {
  mockNextHeaders(null);
  vi.mocked(refresh).mockClear();
});

/** A signed-in creator through onboarding, which writes the J4.1 card (tests/helpers' signedInCreator has no card). */
async function onboardedCreator() {
  mockNextHeaders(await signInWithOtp(newCreatorEmail()));
  const owner = await requireUser();
  const { creatorId } = await completeOnboarding(owner, {
    displayName: "Maya R.",
    handle: uniqueTestHandle(),
    ageConfirmed: true,
    timeZone: "America/Toronto",
  });
  return { creatorId, actor: creatorActor({ userId: owner.id, creatorId }) };
}

const defaults = () => defaultRateCardInput("cad");

function withOption(
  input: RateCardInput,
  key: RateOptionKey,
  change: Partial<RateCardInput["options"][number]>,
): RateCardInput {
  return {
    ...input,
    options: input.options.map((o) =>
      o.key === key ? { ...o, ...change } : o,
    ),
  };
}

/** Every stored value of the card, updated_at included, so "nothing changed" means nothing was written. */
async function stored(creatorId: string) {
  const [card] = await db
    .select()
    .from(rateCard)
    .where(eq(rateCard.creatorId, creatorId));
  const options = await db
    .select()
    .from(rateOption)
    .where(eq(rateOption.rateCardId, card.id))
    .orderBy(asc(rateOption.optionKey));
  return { card, options };
}

describe("getRateCard", () => {
  it("J4.1: onboarding writes CA$150 and the presets, all on, read in the creator's currency", async () => {
    const { creatorId } = await onboardedCreator();
    expect(await getRateCard(creatorId)).toEqual({
      currency: "cad",
      basePriceCents: 15000,
      options: defaultRateOptions().map((o) => ({
        dimension: o.dimension,
        key: o.optionKey,
        enabled: true,
        multiplierBps: o.multiplierBps,
        sortOrder: o.sortOrder,
      })),
    });
  });
});

describe("saveRateCard (the domain function)", () => {
  it("saves the base, switches and multipliers, and a second save of the same card changes nothing", async () => {
    const { creatorId, actor } = await onboardedCreator();
    let input = withOption(defaults(), "paid_social", { multiplierBps: 35000 });
    input = withOption(input, "broadcast", { enabled: false });
    input = { ...input, basePriceCents: 20000 };
    await saveRateCard(actor, input);
    const card = await getRateCard(creatorId);
    expect(card.basePriceCents).toBe(20000);
    expect(card.options.find((o) => o.key === "paid_social")).toMatchObject({
      enabled: true,
      multiplierBps: 35000,
    });
    expect(card.options.find((o) => o.key === "broadcast")).toMatchObject({
      enabled: false,
      multiplierBps: 50000,
    });
    await saveRateCard(actor, input);
    expect(await getRateCard(creatorId)).toEqual(card);
  });

  it.each([
    [
      "base 999",
      { basePriceCents: 999 },
      { basePriceCents: "Minimum is CA$10." },
    ],
    [
      "base 1_000_100",
      { basePriceCents: 1_000_100 },
      { basePriceCents: "Maximum is CA$10,000." },
    ],
    [
      "base 15050",
      { basePriceCents: 15050 },
      { basePriceCents: "Use whole dollars." },
    ],
  ])("J4.9: refuses %s and saves nothing", async (_name, change, fields) => {
    const { creatorId, actor } = await onboardedCreator();
    const before = await stored(creatorId);
    const attempt = saveRateCard(actor, { ...defaults(), ...change });
    await expect(attempt).rejects.toBeInstanceOf(InvalidRateCardError);
    await expect(attempt).rejects.toMatchObject({ fields });
    expect(await stored(creatorId)).toEqual(before);
  });

  it.each([
    [9500, "Minimum is ×1.00."],
    [100500, "Maximum is ×10.00."],
    [10250, "Use steps of 0.05."],
  ])(
    "J4.9: refuses a multiplier of %i bps and saves nothing",
    async (bps, message) => {
      const { creatorId, actor } = await onboardedCreator();
      const before = await stored(creatorId);
      const crafted = withOption(defaults(), "paid_social", {
        multiplierBps: bps,
      });
      await expect(saveRateCard(actor, crafted)).rejects.toMatchObject({
        fields: { paid_social: message },
      });
      expect(await stored(creatorId)).toEqual(before);
    },
  );

  it("refuses a group with every option off", async () => {
    const { creatorId, actor } = await onboardedCreator();
    const before = await stored(creatorId);
    const input = {
      ...defaults(),
      options: defaults().options.map((o) =>
        o.dimension === "term" ? { ...o, enabled: false } : o,
      ),
    };
    await expect(saveRateCard(actor, input)).rejects.toMatchObject({
      fields: { term: "Keep at least one term." },
    });
    expect(await stored(creatorId)).toEqual(before);
  });

  it("changes only the actor's own card", async () => {
    const mine = await onboardedCreator();
    const theirs = await onboardedCreator();
    const before = await stored(theirs.creatorId);
    await saveRateCard(mine.actor, { ...defaults(), basePriceCents: 30000 });
    expect((await getRateCard(mine.creatorId)).basePriceCents).toBe(30000);
    expect(await stored(theirs.creatorId)).toEqual(before);
  });

  it("rolls back a card that is missing one of its 10 options", async () => {
    const { creatorId, actor } = await onboardedCreator();
    const { card } = await stored(creatorId);
    await db
      .delete(rateOption)
      .where(
        and(
          eq(rateOption.rateCardId, card.id),
          eq(rateOption.optionKey, "region"),
        ),
      );
    await expect(
      saveRateCard(actor, { ...defaults(), basePriceCents: 30000 }),
    ).rejects.toThrow("doesn't have its 10 options");
    expect((await stored(creatorId)).card.basePriceCents).toBe(15000);
  });
});

describe("saveRateCard (the action)", () => {
  it("sends a signed-out visitor to sign in", async () => {
    await expect(saveRateCardAction(defaults())).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fdashboard%2Fpricing"),
    );
  });

  it("saves the signed-in creator's card and refreshes the page", async () => {
    const { creatorId } = await onboardedCreator();
    const input = withOption(defaults(), "worldwide", { multiplierBps: 20000 });
    expect(await saveRateCardAction(input)).toEqual({
      ok: true,
      data: undefined,
    });
    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(1);
    const card = await getRateCard(creatorId);
    expect(card.options.find((o) => o.key === "worldwide")?.multiplierBps).toBe(
      20000,
    );
  });

  it("returns each field's first error, saves nothing and doesn't refresh", async () => {
    const { creatorId } = await onboardedCreator();
    const before = await stored(creatorId);
    const crafted = {
      ...withOption(defaults(), "m6", { multiplierBps: 100500 }),
      basePriceCents: 999,
    };
    expect(await saveRateCardAction(crafted)).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Minimum is CA$10.",
        fields: {
          basePriceCents: ["Minimum is CA$10."],
          m6: ["Maximum is ×10.00."],
        },
      },
    });
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
    expect(await stored(creatorId)).toEqual(before);
  });

  it("refuses input that isn't a rate card", async () => {
    await onboardedCreator();
    const result = await saveRateCardAction(
      "nonsense" as unknown as RateCardInput,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("invalid_input");
  });
});
