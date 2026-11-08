// Issued licenses and the buyer's download taps, for the delivery [int] tests (P20; P20b's buyer-licenses reuses them):
// a creator's published video with its original in local storage at the key the license copies (DB13), a request on it
// approved through approveLicenseRequest, the expiry and revocation no prompt before P21 can make (forced on the
// license row), the Request a tap sends, the download_event rows it leaves and the headers every download answer
// carries. A file that uses them calls removeOriginalsAfterAll() at its top level and keeps its own mocks: the
// payments registry on the scripted double (scripted-suite.ts) and next/server's after() → runAfter (after.ts), which
// issue() waits for.
import { asc, count, eq, sql } from "drizzle-orm";
import { afterAll, expect } from "vitest";
import { GET as originalGET } from "../../src/app/api/licenses/[token]/original/route";
import { GET as pdfGET } from "../../src/app/api/licenses/[token]/pdf/route";
import { db } from "../../src/db/client";
import { downloadEvent, license } from "../../src/db/schema";
import type {
  CreatorProfile,
  License,
  LicenseRequest,
  NewLicenseRequest,
  Video,
} from "../../src/db/schema/types";
import type { DownloadKind } from "../../src/lib/domain/values";
import { LicenseSnapshotV1Schema } from "../../src/lib/licensing/snapshot";
import { DAY_MS } from "../../src/lib/time";
import { licenseDownloadPath } from "../../src/lib/urls";
import type { Actor } from "../../src/server/auth/actor";
import { env } from "../../src/server/env";
import { localDriver } from "../../src/server/storage/index";
import { flushAfter } from "./after";
import {
  approvingCreatorWithVideo,
  PAID_SOCIAL_YEAR_WORLDWIDE,
  waitingRequest,
} from "./approval-fixtures";
import { requestRow } from "./factories";
import { approve, offeringVideo } from "./request-flow";
import { onlyLicense } from "./request-outcomes";
import { type Bytes, fixture, trackTestStorage } from "./uploads";

// --- Licenses ------------------------------------------------------------------------------------------------------------

export type Owner = { creator: CreatorProfile; actor: Actor; live: Video };
export type Issued = {
  token: string;
  request: LicenseRequest;
  license: License;
};

/** The exclusive request at ×3.00: CA$4,725.00 + CA$472.50 = CA$5,197.50, 1 year. */
export const EXCLUSIVE_ROW = {
  exclusive: true,
  exclusiveMultiplierBps: 30000,
  licensePriceCents: 472500,
  platformFeeCents: 47250,
  amountTotalCents: 519750,
} as const satisfies Partial<NewLicenseRequest>;

/** Admin-only words a public record must never carry (03: revoked_note "never public"). */
export const REVOKED_NOTE =
  "Admin note: lost dispute ch_lost_7781 on pi_hidden_7781";

/** The originals this file stored, one folder per creator. */
const disk = trackTestStorage();

/** For the file's top level: removes the originals its tests stored once they are done (the dev server shares the folder). */
export function removeOriginalsAfterAll(): void {
  afterAll(() => disk.clean());
}

let sample: Bytes | undefined;

/** The fixture MP4 every original is, read once. */
export async function originalSample(): Promise<Bytes> {
  sample ??= await fixture("sample.mp4");
  return sample;
}

/** `owner`'s video with its original on disk: the fixture MP4 at the key the license copies (DB13). */
export async function withOriginal<T extends Owner>(owner: T): Promise<T> {
  disk.creator(owner.creator.id);
  const key = owner.live.originalObjectKey;
  if (!key) throw new Error("withOriginal: no original key");
  await localDriver().putSmall(key, await originalSample(), "video/mp4");
  return owner;
}

/** A creator who can approve and their published upload (self-attested, no postings). */
export const uploadOwner = async () =>
  withOriginal(await approvingCreatorWithVideo());

/** A creator who offers exclusive licenses at ×3.00 and their published upload. */
export const exclusiveOwner = async () => withOriginal(await offeringVideo());

/**
 * A request waiting on `owner`'s video (the J4.7 quote, Worldwide, `overrides` on top), approved by its creator: the
 * buyer's key, the request as approved and its one license, once the after() work (email, transfer) is done.
 */
export async function issue(
  owner: Owner,
  overrides: Partial<NewLicenseRequest> = {},
): Promise<Issued> {
  const { row, token } = await waitingRequest(owner.live, {
    ...PAID_SOCIAL_YEAR_WORLDWIDE,
    ...overrides,
  });
  await approve(row.id, owner.actor);
  await flushAfter();
  return {
    token,
    request: await requestRow(row.id),
    license: await onlyLicense(row.id),
  };
}

/** The license's end: the test fails on a perpetual one. */
export const endOf = (l: Pick<License, "endsAt">): Date => {
  if (!l.endsAt) throw new Error("the license has no end");
  return l.endsAt;
};

/**
 * Ends `l` yesterday, as a 30-day term that started 31 days ago (license_dates: ends_at > starts_at), its snapshot's
 * dates with it so the record's words agree with its columns.
 */
export async function expire(l: License): Promise<void> {
  const endsAt = new Date(Date.now() - DAY_MS);
  const startsAt = new Date(endsAt.getTime() - 30 * DAY_MS);
  const snapshot = LicenseSnapshotV1Schema.parse(l.snapshot);
  await db
    .update(license)
    .set({
      startsAt,
      endsAt,
      snapshot: {
        ...snapshot,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    })
    .where(eq(license.id, l.id));
}

/** Revokes `licenseId` a minute ago on the database's clock (the list's SQL reads that clock), with a reason and a note. */
export async function revoke(licenseId: string): Promise<Date> {
  const [row] = await db
    .update(license)
    .set({
      revokedAt: sql`now() - interval '1 minute'`,
      revokedReason: "payment_reversed",
      revokedNote: REVOKED_NOTE,
    })
    .where(eq(license.id, licenseId))
    .returning({ revokedAt: license.revokedAt });
  if (!row?.revokedAt) throw new Error("revoke: unknown license");
  return row.revokedAt;
}

// --- The download taps ---------------------------------------------------------------------------------------------------

const FORWARDED_FOR = "203.0.113.7, 10.0.0.1";
export const BUYER_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 delivery-test";
export const KINDS: readonly DownloadKind[] = ["original", "pdf"];

/** The GET a buyer's tap on the app's `path` sends: a proxy's x-forwarded-for and an iPhone's user agent, `headers` on top. */
export const tapRequest = (
  path: string,
  headers: Record<string, string> = {},
): Request =>
  new Request(new URL(path, env.APP_URL), {
    headers: {
      "x-forwarded-for": FORWARDED_FOR,
      "user-agent": BUYER_UA,
      ...headers,
    },
  });

const TOKEN_ROUTES = { original: originalGET, pdf: pdfGET } as const;

/** The buyer's tap on a buyer-link download (/api/licenses/[token]/…): a GET through the route's handler with the params Next passes. */
export function download(
  token: string,
  kind: DownloadKind,
  headers: Record<string, string> = {},
): Promise<Response> {
  return TOKEN_ROUTES[kind](
    tapRequest(licenseDownloadPath(token, kind), headers),
    { params: Promise.resolve({ token }) },
  );
}

/** The license's download_event rows, oldest first, the address as host(inet) prints it. */
export const downloadsOf = (licenseId: string) =>
  db
    .select({
      kind: downloadEvent.kind,
      ip: sql<string | null>`host(${downloadEvent.ip})`,
      userAgent: downloadEvent.userAgent,
    })
    .from(downloadEvent)
    .where(eq(downloadEvent.licenseId, licenseId))
    .orderBy(asc(downloadEvent.createdAt));

/** Every download_event row in the database. */
export async function allDownloads(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(downloadEvent);
  return row?.n ?? 0;
}

/** One tap's row, from the request's own headers (07 D47): the first x-forwarded-for hop and the user agent. */
export const tapped = (kind: DownloadKind) => ({
  kind,
  ip: "203.0.113.7",
  userAgent: BUYER_UA,
});

/** Every download answer is uncached and sends no referrer (07 D61). */
export function expectPrivate(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

export function expectNotFound(response: Response): void {
  expect(response.status).toBe(404);
  expectPrivate(response);
}

/** The 303 back to the app's `pathname` with ?download=failed, on the app's origin (Q-185). */
export function expectBounced(response: Response, pathname: string): void {
  expect(response.status).toBe(303);
  expectPrivate(response);
  const location = new URL(response.headers.get("location") ?? "");
  expect(location.origin).toBe(new URL(env.APP_URL).origin);
  expect(location.pathname).toBe(pathname);
  expect(location.search).toBe("?download=failed");
}

/** `name`'s Content-Disposition, an ASCII name in both forms. */
export const disposition = (kind: "attachment" | "inline", name: string) =>
  `${kind}; filename="${name}"; filename*=UTF-8''${name}`;
