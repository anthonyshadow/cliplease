import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEAD as originalHEAD } from "../../src/app/api/licenses/[token]/original/route";
import { HEAD as pdfHEAD } from "../../src/app/api/licenses/[token]/pdf/route";
import { db } from "../../src/db/client";
import {
  creatorProfile,
  license,
  socialAccount,
  video,
  videoPosting,
} from "../../src/db/schema";
import type { License, NewLicenseRequest } from "../../src/db/schema/types";
import { SUPPORT_EMAIL } from "../../src/lib/app-name";
import type { DownloadKind } from "../../src/lib/domain/values";
import { formatLicenseDate } from "../../src/lib/format";
import { publicStatus } from "../../src/lib/licensing/public-status";
import { licensePath, verifyPath } from "../../src/lib/urls";
import { env } from "../../src/server/env";
import { listCreatorLicenses } from "../../src/server/licensing/licenses";
import {
  getPublicLicenseView,
  type PublicLicenseView,
  type VerifyLookup,
} from "../../src/server/licensing/verify";
import { disconnectSocialAccount } from "../../src/server/social/disconnect";
import { localDriver } from "../../src/server/storage/index";
import { findLicenseForBuyer } from "../../src/server/tokens/buyer-token";
import {
  approvableVideo,
  approvingCreator,
  PAID_SOCIAL_YEAR_WORLDWIDE,
  waitingRequest,
} from "../helpers/approval-fixtures";
import {
  allDownloads,
  BUYER_UA,
  disposition,
  download,
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
  type Owner,
  originalSample,
  REVOKED_NOTE,
  removeOriginalsAfterAll,
  revoke,
  tapped,
  uploadOwner,
  withOriginal,
} from "../helpers/delivery";
import { publishVideo } from "../helpers/factories";
import { AFTER_FAILED, captureLogEvents, recordStderr } from "../helpers/logs";
import { pageBody, pdfPages, squash } from "../helpers/pdf-text";
import { readyLibraryVideo } from "../helpers/ready-videos";
import {
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";
import { getSigned } from "../helpers/uploads";

// Delivery (P20; 02 §4.2, §9.5; 01 J9, J10; 07 D16, D17, D47, D61, D71, D101, D113; owner answers Q-183–Q-188): the
// buyer's two download routes, called with `new Request()` and the params as Next passes them; the public record
// getPublicLicenseView builds for /verify; the creator's /dashboard/licenses list; and the license PDF's text, read back
// out of the route's bytes. Every license is issued through approveLicenseRequest on the scripted double (the fake's
// answers), its original the fixture MP4 in local storage at the key the license copies (DB13). Expiry and revocation
// are forced on the license row, as no prompt before P21 can make them (tests/helpers/delivery.ts, shared with
// buyer-licenses.test.ts).

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

// Codes a test hands out first (one with a 0 and a 1, SK-01); the real generator after that.
const codes = vi.hoisted(() => ({ next: [] as string[] }));
vi.mock("@/server/codes/license-code", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/server/codes/license-code")>();
  return {
    ...real,
    generateLicenseCode: () => codes.next.shift() ?? real.generateLicenseCode(),
  };
});

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

removeOriginalsAfterAll();
beforeEach(() => {
  installScriptedPayments();
  codes.next = [];
  render.failure = null;
  recordStderr(AFTER_FAILED);
});
afterEach(finishScriptedTest);

// --- Licenses ------------------------------------------------------------------------------------------------------------

/** A one-country license in the United States (the summary's "in the United States", Q-115 a). */
const UNITED_STATES = {
  territoryKey: "country",
  territoryCode: "US",
} as const satisfies Partial<NewLicenseRequest>;

/** A terms acceptance at a fixed time before the approval, so the PDF's {accepted_at} can't be the start date (Q-183). */
const ACCEPTED_AT = new Date("2026-10-31T09:10:00.000Z");

/** A creator who can approve and their published Library video: a verified Demo posting (07 D43). */
async function libraryOwner(): Promise<Owner> {
  const { creator, actor } = await approvingCreator();
  const live = await publishVideo(await readyLibraryVideo(creator.id));
  return withOriginal({ creator, actor, live });
}

async function licenseRow(id: string): Promise<License> {
  const [row] = await db.select().from(license).where(eq(license.id, id));
  if (!row) throw new Error("no license");
  return row;
}

// --- The PDF's text ------------------------------------------------------------------------------------------------------

/** Every page's text without white space or the footer a text running onto the next page is drawn around. */
const pdfText = (pdf: Buffer) => pdfPages(pdf).map(pageBody);

async function pdfOf(token: string): Promise<string[]> {
  const response = await download(token, "pdf");
  expect(response.status).toBe(200);
  return pdfText(Buffer.from(await response.arrayBuffer()));
}

// --- The public record ---------------------------------------------------------------------------------------------------

/** The record getPublicLicenseView found, failing the test on a redirect or not_found. */
function recordOf(lookup: VerifyLookup): PublicLicenseView {
  if ("redirectTo" in lookup || lookup.status === "not_found") {
    throw new Error(`no record: ${JSON.stringify(lookup)}`);
  }
  return lookup;
}

/** The view's fields: an allow-list (research/license.md §6.3; VE-9), so a field the snapshot gains stays private. */
const VIEW_KEYS = [
  "badge",
  "code",
  "creator",
  "endsAt",
  "exclusions",
  "exclusive",
  "issuedAt",
  "licenseeName",
  "postings",
  "revokedAt",
  "scope",
  "sentence",
  "startsAt",
  "status",
  "termsVersion",
  "video",
];

/** Nothing private in the record (07 D47, D94): no buyer contact, key, money, Stripe id, storage key or admin words. */
function expectNothingPrivate(
  lookup: VerifyLookup,
  issued: Issued,
  extra: readonly string[] = [],
): void {
  const json = JSON.stringify(lookup);
  for (const secret of [
    issued.request.buyerEmail,
    issued.request.contactName,
    issued.token,
    "amount",
    "currency",
    "CA$",
    "pi_",
    "ch_",
    "cs_",
    "originals/",
    ...extra,
  ]) {
    expect(json).not.toContain(secret);
  }
}

describe("GET /api/licenses/[token]/original (02 §4.2, §9.5; 07 D16, D61; Q-185)", () => {
  it("sends a valid license's original: a 302 to a signed local URL for the license's key, uncached, no referrer, one row", async () => {
    const { token, license: issued } = await issue(await uploadOwner());

    const response = await download(token, "original");
    expect(response.status).toBe(302);
    expectPrivate(response);
    const location = response.headers.get("location") ?? "";
    const signed = new URL(location);
    expect(signed.origin).toBe(new URL(env.APP_URL).origin);
    // The license's own copy of the key (DB13), signed for a short time; never the buyer's key.
    expect(decodeURIComponent(signed.pathname)).toBe(
      `/api/dev/storage/${issued.originalObjectKey}`,
    );
    expect(location).not.toContain(token);
    expect(await downloadsOf(issued.id)).toEqual([tapped("original")]);

    // The signed URL serves the fixture as an attachment named for the code.
    const file = await getSigned(location);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toBe(
      disposition("attachment", `ClipLease-${issued.code}-original.mp4`),
    );
    expect(
      Buffer.from(await file.arrayBuffer()).equals(
        Buffer.from(await originalSample()),
      ),
    ).toBe(true);
  });

  it("logs one row per tap with what inet and its CHECK take: a zone id's address null, a long user agent cut to 512", async () => {
    const { token, license: issued } = await issue(await uploadOwner());
    const longAgent = `Mozilla/5.0 ${"x".repeat(600)}`;

    const first = await download(token, "original", {
      "x-forwarded-for": "fe80::1%lo0, 10.0.0.1",
      "user-agent": longAgent,
    });
    expect(first.status).toBe(302);
    const second = await download(token, "original", {
      "x-forwarded-for": "2001:db8::7",
    });
    expect(second.status).toBe(302);
    const third = await download(token, "original", { "user-agent": "" });
    expect(third.status).toBe(302);

    expect(await downloadsOf(issued.id)).toEqual([
      { kind: "original", ip: null, userAgent: longAgent.slice(0, 512) },
      { kind: "original", ip: "2001:db8::7", userAgent: BUYER_UA },
      { kind: "original", ip: "203.0.113.7", userAgent: null },
    ]);
  });
});

describe("GET /api/licenses/[token]/pdf (02 §5.10; 07 D17; Q-183)", () => {
  it("sends the license PDF inline as ClipLease-<code>-license.pdf, uncached, no referrer, one row", async () => {
    const { token, license: issued } = await issue(await uploadOwner());

    const response = await download(token, "pdf");
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe(
      disposition("inline", `ClipLease-${issued.code}-license.pdf`),
    );
    const pdf = Buffer.from(await response.arrayBuffer());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1024);
    expect(await downloadsOf(issued.id)).toEqual([tapped("pdf")]);
  });

  it("prints the code, the verify URL, the rights row, the amounts, the acceptance time and the territory from the request (Q-183)", async () => {
    const { token, license: issued } = await issue(await uploadOwner(), {
      ...UNITED_STATES,
      termsAcceptedAt: ACCEPTED_AT,
    });
    const end = formatLicenseDate(endOf(issued));
    const [page1 = "", ...legal] = await pdfOf(token);
    const all = [page1, ...legal].join("");

    expect(page1).toContain(issued.code);
    expect(page1).toContain(
      squash(new URL(verifyPath(issued.code), env.APP_URL).href),
    );
    expect(page1).toContain(
      squash(`Issued ${formatLicenseDate(issued.createdAt)} · Non-exclusive`),
    );
    expect(page1).toContain(squash("Rights Non-exclusive"));
    expect(page1).toContain(
      squash("License fee CA$1,575.00 + service fee CA$157.50 = CA$1,732.50"),
    );
    expect(page1).toContain(squash("Amounts in Canadian dollars (CAD)."));
    // The territory: the Territory row's label and detail, and the summary's sentence from territory_code.
    expect(page1).toContain(squash("Territory One country — United States"));
    expect(page1).toContain(squash(`in the United States, until ${end}.`));
    // License v1 §1's {accepted_at}: terms_accepted_at, not the start (Q-183).
    expect(all).toContain(
      squash("It was accepted at checkout on 31 Oct 2026, 09:10 UTC."),
    );
    expect(all).not.toContain("{");
  });

  it("prints an exclusive license's end in the Rights row and its kind on the issue line (07 D113)", async () => {
    const { token, license: issued } = await issue(
      await exclusiveOwner(),
      EXCLUSIVE_ROW,
    );
    expect(issued.exclusive).toBe(true);
    const [page1 = ""] = await pdfOf(token);

    expect(page1).toContain(
      squash(`Issued ${formatLicenseDate(issued.createdAt)} · Exclusive`),
    );
    expect(page1).toContain(
      squash(`Rights Exclusive until ${formatLicenseDate(endOf(issued))}`),
    );
    expect(page1).toContain(
      squash("License fee CA$4,725.00 + service fee CA$472.50 = CA$5,197.50"),
    );
  });
});

describe("Download gates: HEAD, expiry, revocation and keys that open nothing (Q-185)", () => {
  it("answers HEAD with 405 on both routes and writes no row", async () => {
    const { license: issued } = await issue(await uploadOwner());
    const before = await allDownloads();
    for (const head of [originalHEAD, pdfHEAD]) {
      const response = head();
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expectPrivate(response);
    }
    expect(await allDownloads()).toBe(before);
    expect(await downloadsOf(issued.id)).toEqual([]);
  });

  it("keeps an expired license's PDF but not its original", async () => {
    const { token, license: issued } = await issue(await uploadOwner());
    await expire(issued);

    expectNotFound(await download(token, "original"));
    expect(await downloadsOf(issued.id)).toEqual([]);
    const pdf = await download(token, "pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(await downloadsOf(issued.id)).toEqual([tapped("pdf")]);
  });

  it("answers 404 on both for a revoked license, with no row", async () => {
    const { token, license: issued } = await issue(await uploadOwner());
    await revoke(issued.id);

    for (const kind of KINDS) expectNotFound(await download(token, kind));
    expect(await downloadsOf(issued.id)).toEqual([]);
  });

  it("opens the approved request's license only: an unknown, a malformed or a waiting request's key gets 404 and no row", async () => {
    const owner = await uploadOwner();
    const issued = await issue(owner, {
      ...UNITED_STATES,
      termsAcceptedAt: ACCEPTED_AT,
    });
    expect(await findLicenseForBuyer(issued.token)).toMatchObject({
      license: { id: issued.license.id, code: issued.license.code },
      request: {
        id: issued.request.id,
        territoryCode: "US",
        termsAcceptedAt: ACCEPTED_AT,
        amountTotalCents: 173250,
        currency: "cad",
        buyerEmail: issued.request.buyerEmail,
      },
    });

    const { token: waiting } = await waitingRequest(
      owner.live,
      PAID_SOCIAL_YEAR_WORLDWIDE,
    );
    const unknown = randomBytes(32).toString("base64url");
    const malformed = [
      "",
      "short",
      `${issued.token}A`,
      `${issued.token.slice(0, 42)}=`,
      `../${issued.token.slice(3)}`,
    ];
    const before = await allDownloads();
    for (const token of [unknown, waiting, ...malformed]) {
      expect(await findLicenseForBuyer(token)).toBeNull();
      for (const kind of KINDS) expectNotFound(await download(token, kind));
    }
    expect(await allDownloads()).toBe(before);
  });

  it("sends the buyer back to /l?download=failed (303) when storage, the render or the row fails, with no row (Q-185)", async () => {
    const { token, license: issued } = await issue(await uploadOwner());
    const logged = captureLogEvents("license.download_failed");

    vi.spyOn(localDriver(), "presignGet").mockRejectedValueOnce(
      new Error("storage down"),
    );
    expectBounced(await download(token, "original"), licensePath(token));

    render.failure = new Error("render failed");
    expectBounced(await download(token, "pdf"), licensePath(token));
    render.failure = null;

    // The row is written last: a failed insert answers the bounce too.
    vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("database down");
    });
    expectBounced(await download(token, "pdf"), licensePath(token));

    // A broken row (a type no upload has) fails the same way.
    await db
      .update(license)
      .set({ originalMime: "video/x-flv" })
      .where(eq(license.id, issued.id));
    expectBounced(await download(token, "original"), licensePath(token));

    expect(await downloadsOf(issued.id)).toEqual([]);
    const { written, events } = logged();
    const failed = (kind: DownloadKind) =>
      expect.objectContaining({
        level: "error",
        event: "license.download_failed",
        kind,
        error: "Error",
      });
    expect(events).toEqual([
      failed("original"),
      failed("pdf"),
      failed("pdf"),
      failed("original"),
    ]);
    expect(written).not.toContain(token);
    expect(written).not.toContain("originals/");
  });
});

describe("getPublicLicenseView (research/license.md §6.2–§6.4; 01 J10; 07 D101, D113)", () => {
  it("gives the canonical code's record: the snapshot's allow-list, the sentence naming the request's territory (Q-115 a)", async () => {
    const owner = await uploadOwner();
    const issued = await issue(owner, UNITED_STATES);
    const lookup = await getPublicLicenseView(issued.license.code);
    const view = recordOf(lookup);

    expect(Object.keys(view).sort()).toEqual(VIEW_KEYS);
    expect(view).toMatchObject({
      status: "valid",
      code: issued.license.code,
      sentence: `This license is active. Acme Studio may use this video for Paid social ads in the United States until ${formatLicenseDate(endOf(issued.license))}.`,
      issuedAt: issued.license.createdAt.toISOString(),
      startsAt: issued.license.startsAt.toISOString(),
      endsAt: endOf(issued.license).toISOString(),
      revokedAt: null,
      licenseeName: "Acme Studio",
      creator: { handle: owner.creator.handle, displayName: "Test Creator" },
      badge: { size: "lg", ownership: "self_attested" },
      postings: [],
      video: { title: "Test video" },
      scope: {
        useLabel: "Paid social ads",
        termLabel: "1 year",
        territoryLabel: "One country",
        territoryDetail: "United States",
      },
      exclusions: { music: false, people: false },
      exclusive: false,
      termsVersion: "v1",
    });
    expectNothingPrivate(lookup, issued);
  });

  it("reads Worldwide as 'in any country' (owner answer Q-186)", async () => {
    const issued = await issue(await uploadOwner());
    const view = recordOf(await getPublicLicenseView(issued.license.code));
    expect(view.sentence).toBe(
      `This license is active. Acme Studio may use this video for Paid social ads in any country until ${formatLicenseDate(endOf(issued.license))}.`,
    );
  });

  it("redirects every other spelling of an issued code to the canonical one (07 D101; SK-01)", async () => {
    const code = "CL-10K3-M9QX";
    codes.next = [code];
    const issued = await issue(await uploadOwner());
    expect(issued.license.code).toBe(code);

    for (const typed of [
      "cl-10k3-m9qx",
      "CL10K3M9QX",
      "10K3M9QX",
      " CL-10K3-M9QX ",
      "CL-IOK3-M9QX",
      "cl-lok3-m9qx",
      "CL-1OK3-M9QX",
      "CL-L0K3-M9QX",
    ]) {
      expect(await getPublicLicenseView(typed)).toEqual({
        redirectTo: verifyPath(code),
      });
    }
    expect(recordOf(await getPublicLicenseView(code)).code).toBe(code);
  });

  it("finds nothing for an unknown code, the old CLR- prefix or malformed input, naming only a canonical code (Q-184)", async () => {
    const code = "CL-10K3-M9QY";
    codes.next = [code];
    await issue(await uploadOwner());

    expect(await getPublicLicenseView("CL-0000-0000")).toEqual({
      status: "not_found",
      code: "CL-0000-0000",
    });
    // An unknown code typed another way is put right first, then not found.
    expect(await getPublicLicenseView("cl-oooo-oooo")).toEqual({
      redirectTo: verifyPath("CL-0000-0000"),
    });
    for (const typed of [
      "CLR-10K3-M9QY",
      "CLR-7K3M-9QXA",
      "",
      "hello",
      "CL-10K3-M9Q",
      "CL-10K3-M9QYZ",
      "CL-10K3-M9QU",
      "<script>alert(1)</script>",
    ]) {
      expect(await getPublicLicenseView(typed)).toEqual({
        status: "not_found",
        code: null,
      });
    }
  });

  it("shows no buyer contact, key, money, Stripe id, storage key, or revocation reason or note (07 D47, D94)", async () => {
    const owner = await uploadOwner();
    const valid = await issue(owner);
    expectNothingPrivate(await getPublicLicenseView(valid.license.code), valid);

    const revoked = await issue(owner);
    const revokedAt = await revoke(revoked.license.id);
    const lookup = await getPublicLicenseView(revoked.license.code);
    expect(recordOf(lookup)).toMatchObject({
      status: "revoked",
      revokedAt: revokedAt.toISOString(),
      sentence: `This license was revoked on ${formatLicenseDate(revokedAt)} and no longer allows any use of this video. Questions? ${SUPPORT_EMAIL}`,
    });
    expectNothingPrivate(lookup, revoked, [
      "payment_reversed",
      REVOKED_NOTE,
      "lost dispute",
    ]);
  });

  it("says when an expired license ended", async () => {
    const issued = await issue(await uploadOwner());
    await expire(issued.license);
    const ended = await licenseRow(issued.license.id);
    expect(
      recordOf(await getPublicLicenseView(issued.license.code)),
    ).toMatchObject({
      status: "expired",
      endsAt: endOf(ended).toISOString(),
      sentence: `This license ended on ${formatLicenseDate(endOf(ended))}. It no longer allows any use of this video.`,
    });
  });

  it("reads the snapshot only: renaming the creator and the video, hiding the link, disconnecting the account change nothing (J10.6)", async () => {
    const owner = await libraryOwner();
    const issued = await issue(owner);
    const before = await getPublicLicenseView(issued.license.code);
    const view = recordOf(before);
    expect(view.badge).toMatchObject({
      ownership: "verified_owner",
      provider: "mock",
      noLongerLinked: false,
    });
    expect(view.postings).toHaveLength(1);
    expect(view.video.title).toBe("Test video");

    await db
      .update(creatorProfile)
      .set({ displayName: "Renamed Creator" })
      .where(eq(creatorProfile.id, owner.creator.id));
    await db
      .update(video)
      .set({ title: "Renamed video" })
      .where(eq(video.id, owner.live.id));
    await db
      .update(videoPosting)
      .set({ showLink: false })
      .where(eq(videoPosting.videoId, owner.live.id));
    const accounts = await db
      .select({ id: socialAccount.id })
      .from(socialAccount)
      .where(eq(socialAccount.creatorId, owner.creator.id));
    expect(accounts).toHaveLength(1);
    for (const { id } of accounts) {
      expect(await disconnectSocialAccount(id, owner.actor)).not.toBeNull();
    }

    expect(await getPublicLicenseView(issued.license.code)).toEqual(before);
  });

  it("marks an exclusive license and says so in D113's sentence, still with no amount (07 D113)", async () => {
    const issued = await issue(await exclusiveOwner(), EXCLUSIVE_ROW);
    const lookup = await getPublicLicenseView(issued.license.code);
    expect(recordOf(lookup)).toMatchObject({
      status: "valid",
      exclusive: true,
      sentence: `This license is active and exclusive. Acme Studio may use this video for Paid social ads in any country until ${formatLicenseDate(endOf(issued.license))}, and no one else may license it until then.`,
    });
    expectNothingPrivate(lookup, issued);
  });
});

describe("listCreatorLicenses (/dashboard/licenses; 03 §7.8 as far as P20's schema goes)", () => {
  it("lists only the creator's own licenses, newest first, with publicStatus's status, both kinds of download and no buyer contact", async () => {
    const owner = await exclusiveOwner();
    const other = await uploadOwner();
    const theirs = await issue(other);

    const valid = await issue(owner);
    const perpetual = await issue(owner, { termKey: "perpetual" });
    const expired = await issue(owner);
    const revoked = await issue(owner);
    const revokedAndExpired = await issue(owner);
    const secondVideo = await withOriginal({
      ...owner,
      live: await approvableVideo(owner.creator.id),
    });
    const exclusive = await issue(secondVideo, EXCLUSIVE_ROW);
    await expire(expired.license);
    await revoke(revoked.license.id);
    await expire(revokedAndExpired.license);
    await revoke(revokedAndExpired.license.id);

    // One original and two PDFs on one license, a PDF on the expired one, a tap on the other creator's.
    for (const [issued, kind] of [
      [valid, "original"],
      [valid, "pdf"],
      [valid, "pdf"],
      [expired, "pdf"],
      [theirs, "original"],
    ] as const) {
      expect((await download(issued.token, kind)).status).toBeLessThan(400);
    }

    const rows = await listCreatorLicenses(owner.creator.id);
    const newestFirst = [
      exclusive,
      revokedAndExpired,
      revoked,
      expired,
      perpetual,
      valid,
    ];
    expect(rows.map((row) => row.id)).toEqual(
      newestFirst.map((issued) => issued.license.id),
    );
    expect(rows.map((row) => row.id)).not.toContain(theirs.license.id);

    const now = new Date();
    for (const row of rows) {
      expect(row.status).toBe(publicStatus(await licenseRow(row.id), now));
    }
    expect(
      rows.map(({ code, status, exclusive: x, downloads }) => ({
        code,
        status,
        exclusive: x,
        downloads,
      })),
    ).toEqual([
      {
        code: exclusive.license.code,
        status: "valid",
        exclusive: true,
        downloads: 0,
      },
      {
        code: revokedAndExpired.license.code,
        status: "revoked",
        exclusive: false,
        downloads: 0,
      },
      {
        code: revoked.license.code,
        status: "revoked",
        exclusive: false,
        downloads: 0,
      },
      {
        code: expired.license.code,
        status: "expired",
        exclusive: false,
        downloads: 1,
      },
      {
        code: perpetual.license.code,
        status: "valid",
        exclusive: false,
        downloads: 0,
      },
      {
        code: valid.license.code,
        status: "valid",
        exclusive: false,
        downloads: 3,
      },
    ]);
    expect(rows.at(-1)).toMatchObject({
      licenseeName: "Acme Studio",
      title: "Test video",
      scope: "Paid social ads · 1 year · Worldwide",
      issuedAt: valid.license.createdAt.toISOString(),
      licensePriceCents: 157500,
      currency: "cad",
      payout: {
        transferStatus: "succeeded",
        transferAmountCents: 157500,
        transferCurrency: "cad",
      },
    });

    const json = JSON.stringify(rows);
    for (const issued of newestFirst) {
      expect(json).not.toContain(issued.request.buyerEmail);
      expect(json).not.toContain(issued.request.contactName);
    }
    expect(
      (await listCreatorLicenses(other.creator.id)).map((row) => row.id),
    ).toEqual([theirs.license.id]);
  });
});
