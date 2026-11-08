import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MyLicensePage from "../../src/app/(buyer)/licenses/[licenseId]/page";
import {
  GET as myOriginalGET,
  HEAD as myOriginalHEAD,
} from "../../src/app/api/my/licenses/[licenseId]/original/route";
import {
  GET as myPdfGET,
  HEAD as myPdfHEAD,
} from "../../src/app/api/my/licenses/[licenseId]/pdf/route";
import { db, pool } from "../../src/db/client";
import { creatorProfile, video } from "../../src/db/schema";
import type { DownloadKind } from "../../src/lib/domain/values";
import { LicenseSnapshotV1Schema } from "../../src/lib/licensing/snapshot";
import { DAY_MS } from "../../src/lib/time";
import { myLicenseDownloadPath, myLicensePath } from "../../src/lib/urls";
import { normalizeEmail } from "../../src/lib/validation/email";
import {
  getSessionUser,
  resolveSignInLanding,
  type SessionUser,
} from "../../src/server/auth/session";
import {
  type BuyerLicenseRow,
  getBuyerLicense,
  listBuyerLicenses,
} from "../../src/server/buyers/queries";
import { env } from "../../src/server/env";
import { declineLicenseRequest } from "../../src/server/licensing/requests";
import { localDriver } from "../../src/server/storage/index";
import { revealBuyerToken } from "../../src/server/tokens/buyer-token";
import { NOT_FOUND, redirectTo } from "../helpers/actions";
import { flushAfter } from "../helpers/after";
import {
  approvingCreatorWithVideo,
  PAID_SOCIAL_YEAR_WORLDWIDE,
  waitingRequest,
} from "../helpers/approval-fixtures";
import {
  mockNextHeaders,
  newCreatorEmail,
  signInWithOtp,
  userByEmail,
} from "../helpers/auth";
import {
  allDownloads,
  disposition,
  downloadsOf,
  EXCLUSIVE_ROW,
  endOf,
  exclusiveOwner,
  expectBounced,
  expectNotFound,
  expectPrivate,
  expire,
  type Issued,
  issue,
  KINDS,
  originalSample,
  removeOriginalsAfterAll,
  revoke,
  tapped,
  tapRequest,
  uploadOwner,
} from "../helpers/delivery";
import { insertCreator, randomHex, requestRow } from "../helpers/factories";
import { AFTER_FAILED, captureLogEvents, recordStderr } from "../helpers/logs";
import {
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";
import { getSigned } from "../helpers/uploads";

// My licenses (P20b; 02 §4.2, §5.14, §9.5, §9.9; 03 §7.6, §7.11; 07 D47, D126; owner answers Q-185, Q-192): a buyer's
// licenses found by the signed-in email, never the buyer key; where sign-in lands; the detail page's 404 for an id that
// isn't theirs; and the two session download routes, called with `new Request()` and the params as Next passes them,
// with sessions from signInWithOtp behind the mocked next/headers. Licenses are issued as delivery.test.ts issues them
// (tests/helpers/delivery.ts). The buyer's typed email reaching the stored lowercase form through createLicenseRequest
// is start-checkout.test.ts's ("saves the demo request as the server priced it…": `  Ana.Buyer@Studio.COM ` →
// `ana.buyer@studio.com`), and the CHECK holding every row to it is constraints.test.ts's "buyer emails (0004)". The
// database is reset once per file, so every buyer here has a run-unique address.

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() runs at once: license-approved and the creator transfer, which issue() waits for.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("../helpers/after")).runAfter,
}));

vi.mock("next/headers", () => import("../helpers/next-headers"));

// The PDF route's render: the real one unless a test makes it fail (Q-185's unexpected error).
const render = vi.hoisted(() => ({ failure: null as Error | null }));
vi.mock("@/server/pdf/generate", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/pdf/generate")>();
  return {
    ...real,
    renderLicensePdf: (...args: Parameters<typeof real.renderLicensePdf>) =>
      render.failure
        ? Promise.reject(render.failure)
        : real.renderLicensePdf(...args),
  };
});

// The buyer key's opener, watched: license-approved's composer opens it at issue, the session routes never do (02 §9.5).
vi.mock("@/server/tokens/buyer-token", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/server/tokens/buyer-token")>();
  return { ...real, revealBuyerToken: vi.fn(real.revealBuyerToken) };
});
const reveal = vi.mocked(revealBuyerToken);

removeOriginalsAfterAll();
beforeEach(() => {
  installScriptedPayments();
  render.failure = null;
  mockNextHeaders(null);
  recordStderr(AFTER_FAILED);
});
afterEach(finishScriptedTest);

// --- Buyers --------------------------------------------------------------------------------------------------------------

/** A run-unique buyer: the address as typed at checkout (spaces, mixed case) and as stored (normalizeEmail). */
function newBuyer(name = "Ana.Buyer") {
  const typed = `  ${name}+${randomHex(4)}@Studio.COM `;
  return { typed, email: normalizeEmail(typed) };
}

/** Signs `email` in (creating the user on first use) and makes it the session the next headers() call sees. */
async function signIn(email: string): Promise<SessionUser> {
  mockNextHeaders(await signInWithOtp(email));
  const user = await getSessionUser();
  if (!user) throw new Error("sign-in made no session");
  return user;
}

/** The detail page's props as Next passes them. */
const pageProps = (licenseId: string) => ({
  params: Promise.resolve({ licenseId }),
  searchParams: Promise.resolve({}),
});

/** `l`'s My licenses row as the snapshot and the columns give it. */
function rowOf(l: Issued["license"], status: BuyerLicenseRow["status"]) {
  const snapshot = LicenseSnapshotV1Schema.parse(l.snapshot);
  return {
    licenseId: l.id,
    videoId: l.videoId,
    code: l.code,
    videoTitle: snapshot.video.title,
    creatorHandle: snapshot.creator.handle,
    status,
    exclusive: l.exclusive,
    startsAt: l.startsAt.toISOString(),
    endsAt: l.endsAt?.toISOString() ?? null,
    renewal: null,
  } satisfies BuyerLicenseRow;
}

/** A request still awaiting approval and a declined one for `buyerEmail`, each on its own creator's video. */
async function waitingAndDeclined(buyerEmail: string) {
  const asked = { ...PAID_SOCIAL_YEAR_WORLDWIDE, buyerEmail };
  const waiting = await waitingRequest(
    (await approvingCreatorWithVideo()).live,
    asked,
  );
  const declinedOwner = await approvingCreatorWithVideo();
  const declined = await waitingRequest(declinedOwner.live, asked);
  expect(
    await declineLicenseRequest(declined.row.id, declinedOwner.actor),
  ).toEqual({ ok: true });
  await flushAfter();
  return { waiting, declined };
}

/**
 * Ana's purchases before she has an account (07 D126): a 30-day standard license, then a 1-year exclusive one (P19g's
 * path, on a video of its own: a running standard license would keep it non_exclusive_only), plus a request still
 * awaiting approval and a declined one, each on its own creator's video; and Bo's license on a fourth.
 */
async function anaBoughtBeforeSignUp() {
  const ana = newBuyer();
  const bo = newBuyer("Bo");
  const standard = await issue(await uploadOwner(), {
    buyerEmail: ana.email,
    termKey: "d30",
  });
  const exclusive = await issue(await exclusiveOwner(), {
    ...EXCLUSIVE_ROW,
    buyerEmail: ana.email,
  });
  const theirs = await issue(await uploadOwner(), { buyerEmail: bo.email });
  const { waiting, declined } = await waitingAndDeclined(ana.email);
  expect((await requestRow(waiting.row.id)).status).toBe("awaiting_approval");
  expect((await requestRow(declined.row.id)).status).toBe("declined");
  return { ana, bo, standard, exclusive, theirs };
}

/** Forgets the key openings so far: the issue's license-approved composer opened it, so the watch is live. */
function forgetKeyOpenings(): void {
  expect(reveal).toHaveBeenCalled();
  reveal.mockClear();
}

/** Ana signed in with her one valid standard license (its original on disk), the issue's key openings forgotten. */
async function anaWithLicense() {
  const ana = newBuyer();
  const issued = await issue(await uploadOwner(), { buyerEmail: ana.email });
  const user = await signIn(ana.email.toUpperCase());
  forgetKeyOpenings();
  return { ana, issued, user };
}

// --- The session routes --------------------------------------------------------------------------------------------------

const MY_ROUTES = { original: myOriginalGET, pdf: myPdfGET } as const;

/** The signed-in buyer's tap on a My licenses download: a GET through the route's handler with the params Next passes. */
function myDownload(licenseId: string, kind: DownloadKind): Promise<Response> {
  return MY_ROUTES[kind](tapRequest(myLicenseDownloadPath(licenseId, kind)), {
    params: Promise.resolve({ licenseId }),
  });
}

/** A session route's 404: the download one, never indexed (P20b). */
function expectMyNotFound(response: Response): void {
  expectNotFound(response);
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
}

/** How many statements `read` sends through the pool. */
async function statementsOf(read: () => Promise<unknown>) {
  const query = vi.spyOn(pool, "query");
  await read();
  const sent = query.mock.calls.length;
  query.mockRestore();
  return sent;
}

describe("listBuyerLicenses: bought before sign-up (03 §7.11; 07 D126; Q-192)", () => {
  it("finds Ana's two licenses once she signs in with any casing: newest first, snapshot words, ISO dates, no amount", async () => {
    const { ana, bo, standard, exclusive, theirs } =
      await anaBoughtBeforeSignUp();
    // Renamed after the sale: a row reads the title the license recorded, never the live one (07 D71).
    for (const { license } of [standard, exclusive]) {
      await db
        .update(video)
        .set({ title: "Renamed video" })
        .where(eq(video.id, license.videoId));
    }
    expect(await userByEmail(ana.email)).toBeUndefined();

    const user = await signIn(ana.email.toUpperCase());
    expect(user.email).toBe(ana.email);
    const account = await userByEmail(ana.email);
    expect(account).toMatchObject({ emailVerified: true, role: "creator" });
    expect(
      await db
        .select()
        .from(creatorProfile)
        .where(eq(creatorProfile.userId, user.id)),
    ).toEqual([]);

    const rows = await listBuyerLicenses(user);
    expect(rows).toEqual([
      rowOf(exclusive.license, "valid"),
      rowOf(standard.license, "valid"),
    ]);
    expect(rows.map((row) => row.exclusive)).toEqual([true, false]);
    expect(rows[0]).toMatchObject({ videoTitle: "Test video" });
    expect(
      (await getBuyerLicense(user, standard.license.id))?.license.snapshot,
    ).toMatchObject({ video: { title: "Test video" } });
    const term = (l: Issued["license"]) =>
      endOf(l).getTime() - l.startsAt.getTime();
    expect(term(standard.license)).toBe(30 * DAY_MS);
    // No amount on a row (owner answer Q-192), and nothing of Bo's.
    const json = JSON.stringify(rows);
    for (const hidden of [
      "amount",
      "currency",
      "CA$",
      theirs.license.code,
      bo.email,
    ]) {
      expect(json).not.toContain(hidden);
    }

    // The query side normalizes too: the address as typed finds the same rows.
    expect(await listBuyerLicenses({ email: ana.typed })).toEqual(rows);
    expect(await listBuyerLicenses({ email: bo.typed })).toEqual([
      rowOf(theirs.license, "valid"),
    ]);
    expect(await resolveSignInLanding(user)).toBe("/licenses");
  });
});

describe("Statuses (publicStatus at the read; P20's mapping)", () => {
  it("reads an ended license as expired and a revoked one as revoked, on the list and the detail", async () => {
    const ana = newBuyer();
    const owner = await uploadOwner();
    const ended = await issue(owner, { buyerEmail: ana.email });
    const revoked = await issue(owner, { buyerEmail: ana.email });
    await expire(ended.license);
    await revoke(revoked.license.id);
    const user = { email: ana.email };

    expect(
      (await listBuyerLicenses(user)).map(({ licenseId, status }) => ({
        licenseId,
        status,
      })),
    ).toEqual([
      { licenseId: revoked.license.id, status: "revoked" },
      { licenseId: ended.license.id, status: "expired" },
    ]);
    expect(await getBuyerLicense(user, ended.license.id)).toMatchObject({
      status: "expired",
    });
    expect(await getBuyerLicense(user, revoked.license.id)).toMatchObject({
      status: "revoked",
    });
  });
});

describe("resolveSignInLanding (02 §5.1; 07 D126)", () => {
  it("lands a new user, and a buyer whose requests were never approved, on /onboarding", async () => {
    expect(await resolveSignInLanding(await signIn(newBuyer("Cy").email))).toBe(
      "/onboarding",
    );

    const dee = newBuyer("Dee");
    await waitingAndDeclined(dee.email);
    expect(await resolveSignInLanding(await signIn(dee.email))).toBe(
      "/onboarding",
    );
  });

  it("lands a creator on /dashboard even when they bought a license too", async () => {
    const email = newCreatorEmail();
    const user = await signIn(email);
    await insertCreator({ userId: user.id });
    await issue(await uploadOwner(), { buyerEmail: email });
    expect(await resolveSignInLanding(user)).toBe("/dashboard");
  });
});

describe("getBuyerLicense and /licenses/[licenseId]: another email's id opens nothing (IDOR; 07 D126)", () => {
  it("gives the buyer their own license with /l's shape and its status", async () => {
    const { issued, user } = await anaWithLicense();
    expect(await getBuyerLicense(user, issued.license.id)).toMatchObject({
      license: {
        id: issued.license.id,
        code: issued.license.code,
        originalObjectKey: issued.license.originalObjectKey,
        revokedAt: null,
      },
      request: {
        id: issued.request.id,
        territoryCode: null,
        amountTotalCents: 173250,
        currency: "cad",
        buyerEmail: issued.request.buyerEmail,
      },
      status: "valid",
    });
    await expect(
      MyLicensePage(pageProps(issued.license.id)),
    ).resolves.toBeDefined();
  });

  it("answers null and the page's 404 for Bo's id, an unknown uuid and a malformed id, the last without a query", async () => {
    const bo = newBuyer("Bo");
    const theirs = await issue(await uploadOwner(), { buyerEmail: bo.email });
    const { user } = await anaWithLicense();

    for (const licenseId of [theirs.license.id, randomUUID(), "not-a-uuid"]) {
      expect(await getBuyerLicense(user, licenseId)).toBeNull();
      await expect(MyLicensePage(pageProps(licenseId))).rejects.toMatchObject(
        NOT_FOUND,
      );
    }
    expect(await statementsOf(() => getBuyerLicense(user, "not-a-uuid"))).toBe(
      0,
    );
    // Bo still opens his own.
    expect(
      await getBuyerLicense({ email: bo.email }, theirs.license.id),
    ).toMatchObject({ status: "valid" });
  });

  it("sends a signed-out visitor to sign-in with the license as next", async () => {
    const licenseId = randomUUID();
    await expect(MyLicensePage(pageProps(licenseId))).rejects.toMatchObject(
      redirectTo(`/sign-in?next=%2Flicenses%2F${licenseId}`),
    );
  });
});

describe("GET /api/my/licenses/[licenseId]/original and /pdf (02 §4.2, §9.5; 07 D16, D17, D61; Q-185)", () => {
  it("sends Ana's valid license: the original as a 302 to a signed local URL, the PDF inline, one row each", async () => {
    const { issued, user } = await anaWithLicense();
    const { id, code, originalObjectKey } = issued.license;

    const original = await myDownload(id, "original");
    expect(original.status).toBe(302);
    expectPrivate(original);
    expect(original.headers.get("x-robots-tag")).toBe("noindex");
    const location = original.headers.get("location") ?? "";
    const signed = new URL(location);
    expect(signed.origin).toBe(new URL(env.APP_URL).origin);
    expect(decodeURIComponent(signed.pathname)).toBe(
      `/api/dev/storage/${originalObjectKey}`,
    );
    expect(location).not.toContain(user.email);
    const file = await getSigned(location);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toBe(
      disposition("attachment", `ClipLease-${code}-original.mp4`),
    );
    expect(
      Buffer.from(await file.arrayBuffer()).equals(
        Buffer.from(await originalSample()),
      ),
    ).toBe(true);
    expect(await downloadsOf(id)).toEqual([tapped("original")]);

    const pdf = await myDownload(id, "pdf");
    expect(pdf.status).toBe(200);
    expectPrivate(pdf);
    expect(pdf.headers.get("x-robots-tag")).toBe("noindex");
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pdf.headers.get("content-disposition")).toBe(
      disposition("inline", `ClipLease-${code}-license.pdf`),
    );
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(await downloadsOf(id)).toEqual([tapped("original"), tapped("pdf")]);
    expect(reveal).not.toHaveBeenCalled();
  });

  it("answers 404 with no row on both for Bo's id, an unknown uuid and a malformed id", async () => {
    const bo = newBuyer("Bo");
    const theirs = await issue(await uploadOwner(), { buyerEmail: bo.email });
    await anaWithLicense();

    const before = await allDownloads();
    for (const licenseId of [theirs.license.id, randomUUID(), "not-a-uuid"]) {
      for (const kind of KINDS) {
        expectMyNotFound(await myDownload(licenseId, kind));
      }
    }
    expect(await allDownloads()).toBe(before);
    expect(await downloadsOf(theirs.license.id)).toEqual([]);
    expect(reveal).not.toHaveBeenCalled();
  });

  it("keeps an expired license's PDF but not its original, and answers 404 on both for a revoked one", async () => {
    const { ana, issued: ended, user } = await anaWithLicense();
    const revoked = await issue(await uploadOwner(), {
      buyerEmail: ana.email,
    });
    forgetKeyOpenings();
    await expire(ended.license);
    await revoke(revoked.license.id);
    expect(user.email).toBe(ana.email);

    expectMyNotFound(await myDownload(ended.license.id, "original"));
    const pdf = await myDownload(ended.license.id, "pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(await downloadsOf(ended.license.id)).toEqual([tapped("pdf")]);

    for (const kind of KINDS) {
      expectMyNotFound(await myDownload(revoked.license.id, kind));
    }
    expect(await downloadsOf(revoked.license.id)).toEqual([]);
    expect(reveal).not.toHaveBeenCalled();
  });

  it("sends a signed-out tap to sign-in with the license as next, and answers HEAD with 405, writing no row", async () => {
    const { issued } = await anaWithLicense();
    const { id } = issued.license;
    mockNextHeaders(null);

    for (const kind of KINDS) {
      await expect(myDownload(id, kind)).rejects.toMatchObject(
        redirectTo(`/sign-in?next=${encodeURIComponent(myLicensePath(id))}`),
      );
    }
    for (const head of [myOriginalHEAD, myPdfHEAD]) {
      const response = head();
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expectPrivate(response);
    }
    expect(await downloadsOf(id)).toEqual([]);
    expect(reveal).not.toHaveBeenCalled();
  });

  it("sends the buyer back to /licenses/<id>?download=failed (303) when storage, the render or the row fails, with no row", async () => {
    const { issued, user } = await anaWithLicense();
    const { id } = issued.license;
    const logged = captureLogEvents("license.download_failed");

    vi.spyOn(localDriver(), "presignGet").mockRejectedValueOnce(
      new Error("storage down"),
    );
    expectBounced(await myDownload(id, "original"), myLicensePath(id));

    render.failure = new Error("render failed");
    expectBounced(await myDownload(id, "pdf"), myLicensePath(id));
    render.failure = null;

    vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("database down");
    });
    expectBounced(await myDownload(id, "pdf"), myLicensePath(id));

    expect(await downloadsOf(id)).toEqual([]);
    const { written, events } = logged();
    const failed = (kind: DownloadKind) =>
      expect.objectContaining({
        level: "error",
        event: "license.download_failed",
        kind,
        error: "Error",
      });
    expect(events).toEqual([failed("original"), failed("pdf"), failed("pdf")]);
    expect(written).not.toContain(user.email);
    expect(written).not.toContain("originals/");
    expect(reveal).not.toHaveBeenCalled();
  });
});

describe("A failed buyer query logs without the email (02 §9.9; 07 D47)", () => {
  // A NUL byte in the bound email makes Postgres refuse the statement (22021): a real failed query, whose
  // DrizzleQueryError message would print the email in its params.
  const nulEmail = (email: string) => `${email}\u0000`;
  const reads = [
    ["listBuyerLicenses", "buyers.list_failed", listBuyerLicenses],
    [
      "getBuyerLicense",
      "buyers.license_read_failed",
      (user: SessionUser) => getBuyerLicense(user, randomUUID()),
    ],
    [
      "resolveSignInLanding",
      "auth.sign_in_landing_failed",
      resolveSignInLanding,
    ],
  ] as const;

  it.each(reads)(
    "%s logs %s with the Postgres code only and throws a plain error",
    async (_, event, read) => {
      const { email } = newBuyer();
      const user: SessionUser = {
        id: randomUUID(),
        email: nulEmail(email),
        name: "",
        role: "creator",
      };
      const logs = captureLogEvents(event);
      const error = await read(user).catch((e: unknown) => e);
      const { written, events } = logs();

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(event);
      expect((error as Error).cause).toBeUndefined();
      expect(String(error)).not.toContain(email);
      expect(events).toEqual([
        expect.objectContaining({
          level: "error",
          event,
          error: expect.objectContaining({ pgCode: "22021" }),
        }),
      ]);
      expect(written).not.toContain(email);
    },
  );
});
