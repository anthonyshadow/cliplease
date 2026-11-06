import type { LicenseAvailabilityState } from "../domain/values";

// Whether a video can be licensed right now (07 §9.2, D110; 02 §5.7): the one function that decides it, from the facts
// the server reads, and the words that say so. Pure, for the server and the browser.

/** What is running or waiting on a video. Renewal reservations stay null until P22g. */
export type AvailabilityFacts = {
  runningExclusiveUntil: Date | null;
  runningNonExclusive: boolean;
  pendingExclusive: boolean;
  pendingNonExclusive: boolean;
  reservationUntil: Date | null;
  reservationPlanId: string | null;
};

export type LicenseAvailability = {
  state: LicenseAvailabilityState;
  canRequestNonExclusive: boolean;
  canRequestExclusive: boolean;
  until: Date | null;
  reservationPlanId: string | null;
};

export type AvailabilityRefusal =
  | "video_reserved"
  | "licensed_exclusively"
  | "exclusive_unavailable";

function availabilityState(f: AvailabilityFacts): LicenseAvailabilityState {
  if (f.reservationUntil) return "renewal_reserved";
  if (f.runningExclusiveUntil) return "exclusive_active";
  if (f.pendingExclusive) return "reserved";
  return f.runningNonExclusive || f.pendingNonExclusive
    ? "non_exclusive_only"
    : "open";
}

/**
 * The precedence is renewal_reserved, exclusive_active, reserved, non_exclusive_only, open (07 D110). `until` and
 * `reservationPlanId` belong to the state that set them and are null otherwise. `exclusiveOffered` never changes the
 * state: it only decides whether an open video can be requested exclusively.
 */
export function deriveAvailability(
  f: AvailabilityFacts,
  exclusiveOffered: boolean,
): LicenseAvailability {
  const state = availabilityState(f);
  return {
    state,
    canRequestNonExclusive: state === "open" || state === "non_exclusive_only",
    canRequestExclusive: state === "open" && exclusiveOffered,
    until:
      state === "renewal_reserved"
        ? f.reservationUntil
        : state === "exclusive_active"
          ? f.runningExclusiveUntil
          : null,
    reservationPlanId:
      state === "renewal_reserved" ? f.reservationPlanId : null,
  };
}

/** Why a new request of this kind is refused (02 §5.7; 07 D110), or null when it may go on. */
export function availabilityRefusal(
  a: Pick<LicenseAvailability, "state" | "canRequestExclusive">,
  exclusive: boolean,
): AvailabilityRefusal | null {
  if (a.state === "reserved" || a.state === "renewal_reserved") {
    return "video_reserved";
  }
  if (a.state === "exclusive_active") return "licensed_exclusively";
  return exclusive && !a.canRequestExclusive ? "exclusive_unavailable" : null;
}

/** What a card or a page prints: no plan id and no `canRequest*`; `until` as ISO. */
export type AvailabilityDisplay = {
  state: LicenseAvailabilityState;
  until: string | null;
};
export type PublicVideoAvailability = AvailabilityDisplay;
export type CreatorVideoAvailability = AvailabilityDisplay & {
  licenseeName: string | null;
};
export type VideoPageAvailability = CreatorVideoAvailability & {
  perpetualRunning: boolean;
};

export function availabilityDisplayOf(
  a: Pick<LicenseAvailability, "state" | "until">,
): AvailabilityDisplay {
  return { state: a.state, until: a.until?.toISOString() ?? null };
}

/** What the facts display: neither the state nor its end depends on the offer. */
export function availabilityDisplayFromFacts(
  f: AvailabilityFacts,
): AvailabilityDisplay {
  return availabilityDisplayOf(deriveAvailability(f, false));
}

export const AVAILABILITY_COPY = {
  /** 04 §11.2: the license page's notice; `date` is formatPostDate's. P22g adds renewal_reserved's link. */
  notice: {
    reservedTitle: "This video is reserved for an exclusive license request.",
    reservedBody: "Check back in a few days.",
    exclusiveActive: (date: string) =>
      `This video is licensed exclusively until ${date}.`,
    renewalReserved: (date: string) =>
      `This video is reserved for its current licensee until ${date}.`,
  },
  /** 07 D110: the line on a creator's cards and video page, and the public grid's. */
  line: {
    requestWaiting: "Exclusive request waiting",
    licensedTo: (name: string, date: string) =>
      `Licensed exclusively to ${name} until ${date}`,
    reservedFor: (name: string, date: string) =>
      `Reserved for ${name} until ${date}`,
    licensedUntil: (date: string) => `Licensed exclusively until ${date}`,
    reserved: "Reserved",
    /** 04 §11.2 (over 01 and 05's wording): the creator's video page while a perpetual license runs. */
    perpetual:
      "A perpetual license of this video is running, so it can't be licensed exclusively.",
  },
} as const;
