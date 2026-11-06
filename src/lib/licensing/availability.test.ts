import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_COPY,
  type AvailabilityFacts,
  availabilityDisplayFromFacts,
  availabilityDisplayOf,
  availabilityRefusal,
  deriveAvailability,
} from "./availability";

const UNTIL = new Date("2027-11-20T15:00:00Z");
const RESERVED_UNTIL = new Date("2027-12-20T15:00:00Z");
const PLAN_ID = "00000000-0000-4000-8000-000000000201";

const NOTHING: AvailabilityFacts = {
  runningExclusiveUntil: null,
  runningNonExclusive: false,
  pendingExclusive: false,
  pendingNonExclusive: false,
  reservationUntil: null,
  reservationPlanId: null,
};

const BOTH = [false, true];
const COMBINATIONS = BOTH.flatMap((reservation) =>
  BOTH.flatMap((runningExclusive) =>
    BOTH.flatMap((runningNonExclusive) =>
      BOTH.flatMap((pendingExclusive) =>
        BOTH.flatMap((pendingNonExclusive) =>
          BOTH.map((offered) => ({
            reservation,
            runningExclusive,
            runningNonExclusive,
            pendingExclusive,
            pendingNonExclusive,
            offered,
          })),
        ),
      ),
    ),
  ),
);

/** The precedence as 07 D110 states it: the first one that holds wins. */
const stateOf = (c: (typeof COMBINATIONS)[number]) =>
  c.reservation
    ? "renewal_reserved"
    : c.runningExclusive
      ? "exclusive_active"
      : c.pendingExclusive
        ? "reserved"
        : c.runningNonExclusive || c.pendingNonExclusive
          ? "non_exclusive_only"
          : "open";

describe("deriveAvailability (07 D110)", () => {
  it("covers every combination of the five facts and the offer", () => {
    expect(COMBINATIONS).toHaveLength(64);
  });

  it.each(COMBINATIONS)(
    "reservation $reservation · running exclusive $runningExclusive · running standard $runningNonExclusive · pending exclusive $pendingExclusive · pending standard $pendingNonExclusive · offered $offered",
    (c) => {
      const state = stateOf(c);
      expect(
        deriveAvailability(
          {
            runningExclusiveUntil: c.runningExclusive ? UNTIL : null,
            runningNonExclusive: c.runningNonExclusive,
            pendingExclusive: c.pendingExclusive,
            pendingNonExclusive: c.pendingNonExclusive,
            reservationUntil: c.reservation ? RESERVED_UNTIL : null,
            reservationPlanId: c.reservation ? PLAN_ID : null,
          },
          c.offered,
        ),
      ).toEqual({
        state,
        canRequestNonExclusive:
          state === "open" || state === "non_exclusive_only",
        canRequestExclusive: state === "open" && c.offered,
        until:
          state === "renewal_reserved"
            ? RESERVED_UNTIL
            : state === "exclusive_active"
              ? UNTIL
              : null,
        reservationPlanId: state === "renewal_reserved" ? PLAN_ID : null,
      });
    },
  );

  it("a running exclusive license ending 20 Nov 2027 is exclusive_active with that until", () => {
    expect(
      deriveAvailability({ ...NOTHING, runningExclusiveUntil: UNTIL }, true),
    ).toEqual({
      state: "exclusive_active",
      canRequestNonExclusive: false,
      canRequestExclusive: false,
      until: UNTIL,
      reservationPlanId: null,
    });
  });

  it.each([
    ["nothing", NOTHING, "open"],
    [
      "a running standard license",
      { ...NOTHING, runningNonExclusive: true },
      "non_exclusive_only",
    ],
    [
      "a pending standard request",
      { ...NOTHING, pendingNonExclusive: true },
      "non_exclusive_only",
    ],
    [
      "a pending exclusive request",
      { ...NOTHING, pendingExclusive: true },
      "reserved",
    ],
    [
      "a running exclusive license",
      { ...NOTHING, runningExclusiveUntil: UNTIL },
      "exclusive_active",
    ],
    [
      "a renewal reservation",
      { ...NOTHING, reservationUntil: RESERVED_UNTIL },
      "renewal_reserved",
    ],
  ] as const)("the offer never changes the state: %s", (_, facts, state) => {
    expect(deriveAvailability(facts, true).state).toBe(state);
    expect(deriveAvailability(facts, false).state).toBe(state);
  });
});

describe("availabilityRefusal (02 §5.7; 07 D110)", () => {
  const RUNNING_STANDARD = { ...NOTHING, runningNonExclusive: true };
  const PENDING_EXCLUSIVE = { ...NOTHING, pendingExclusive: true };
  const RUNNING_EXCLUSIVE = { ...NOTHING, runningExclusiveUntil: UNTIL };
  const RENEWAL = { ...NOTHING, reservationUntil: RESERVED_UNTIL };

  it.each([
    ["open", true, false, null, NOTHING],
    ["open", true, true, null, NOTHING],
    ["open", false, false, null, NOTHING],
    ["open", false, true, "exclusive_unavailable", NOTHING],
    ["non_exclusive_only", true, false, null, RUNNING_STANDARD],
    [
      "non_exclusive_only",
      true,
      true,
      "exclusive_unavailable",
      RUNNING_STANDARD,
    ],
    ["reserved", true, false, "video_reserved", PENDING_EXCLUSIVE],
    ["reserved", true, true, "video_reserved", PENDING_EXCLUSIVE],
    [
      "exclusive_active",
      true,
      false,
      "licensed_exclusively",
      RUNNING_EXCLUSIVE,
    ],
    ["exclusive_active", true, true, "licensed_exclusively", RUNNING_EXCLUSIVE],
    ["renewal_reserved", true, false, "video_reserved", RENEWAL],
    ["renewal_reserved", true, true, "video_reserved", RENEWAL],
  ] as const)(
    "%s, offered %s, exclusive %s → %s",
    (state, offered, exclusive, refusal, facts) => {
      const availability = deriveAvailability(facts, offered);
      expect(availability.state).toBe(state);
      expect(availabilityRefusal(availability, exclusive)).toBe(refusal);
    },
  );
});

describe("availabilityDisplayOf", () => {
  it("keeps the state and the ISO until, and nothing else", () => {
    const display = availabilityDisplayOf(
      deriveAvailability(
        {
          ...NOTHING,
          reservationUntil: RESERVED_UNTIL,
          reservationPlanId: PLAN_ID,
        },
        true,
      ),
    );
    expect(display).toEqual({
      state: "renewal_reserved",
      until: "2027-12-20T15:00:00.000Z",
    });
    expect(display).not.toHaveProperty("reservationPlanId");
  });

  it("has a null until when the state has none", () => {
    expect(availabilityDisplayOf(deriveAvailability(NOTHING, true))).toEqual({
      state: "open",
      until: null,
    });
  });
});

describe("availabilityDisplayFromFacts", () => {
  it.each([true, false])(
    "shows what deriveAvailability says with the offer %s",
    (offered) => {
      const facts = { ...NOTHING, runningExclusiveUntil: UNTIL };
      expect(availabilityDisplayFromFacts(facts)).toEqual(
        availabilityDisplayOf(deriveAvailability(facts, offered)),
      );
      expect(availabilityDisplayFromFacts(facts)).toEqual({
        state: "exclusive_active",
        until: "2027-11-20T15:00:00.000Z",
      });
    },
  );
});

describe("AVAILABILITY_COPY (04 §11.2; 07 D110)", () => {
  it("fills the date and the licensee's name", () => {
    const { notice, line } = AVAILABILITY_COPY;
    expect(notice.exclusiveActive("20 Nov 2027")).toBe(
      "This video is licensed exclusively until 20 Nov 2027.",
    );
    expect(notice.renewalReserved("20 Nov 2027")).toBe(
      "This video is reserved for its current licensee until 20 Nov 2027.",
    );
    expect(line.licensedTo("Northwind", "20 Nov 2027")).toBe(
      "Licensed exclusively to Northwind until 20 Nov 2027",
    );
    expect(line.reservedFor("Northwind", "20 Nov 2027")).toBe(
      "Reserved for Northwind until 20 Nov 2027",
    );
    expect(line.licensedUntil("20 Nov 2027")).toBe(
      "Licensed exclusively until 20 Nov 2027",
    );
  });
});
