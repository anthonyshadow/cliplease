// A license as its record prints it (01 J9, J10; 04 §10.2, §11.4; 05 §4.4, §4.5, §6.10, §9; 07 D98, D113): the words
// /l, the license PDF, /verify and /dashboard/licenses use, and the pure helpers that turn a snapshot into them. Read from
// the snapshot and the two request facts that never change after checkout (owner answer Q-183), never from live postings,
// accounts or the video (07 D71). Client-safe and clock-free: callers pass publicStatus(…, now)'s answer. License dates
// are UTC with formatLicenseDate everywhere here (07 D84), the summary's "until {date}" included.
import { APP_NAME, DRAFT_NOTICE, SUPPORT_EMAIL } from "../app-name";
import type { Currency } from "../domain/values";
import { formatLicenseDate, formatMoney, sentences } from "../format";
import { LICENSE_V1_HEADER } from "../legal/license-v1";
import { fillLicenseV1 } from "../legal/license-v1-summary";
import { currencyLabel } from "../money/currency";
import { postingHostLabel } from "../postings/labels";
import type { PublicPostingDTO, PublicPostings } from "../postings/types";
import { licensePath } from "../urls";
import { BADGE_COPY, type BadgeInput, publicBadge } from "../videos/ownership";
import { DOWNLOAD_COPY, DOWNLOAD_FAILED } from "./download-copy";
import { MY_LICENSES_COPY } from "./my-licenses-copy";
import { type PublicLicenseStatus, publicStatus } from "./public-status";
import { territoryInSentence } from "./selection";
import type { LicenseSnapshotV1 } from "./snapshot";
import { type SummaryInput, termPhrase } from "./summary";

/** A found license's status: publicStatus's answer for a license row (no `upcoming` until P22b, 07 D117). */
export type RecordStatus = Exclude<PublicLicenseStatus, "not_found">;

/** publicStatus for a license that exists, which is never not_found. */
export function recordStatus(
  l: { revokedAt: Date | null; endsAt: Date | null },
  now: Date,
): RecordStatus {
  const status = publicStatus(l, now);
  if (status === "not_found")
    throw new Error("publicStatus: not_found for a license");
  return status;
}

/** The record's words (owner answers Q-184–Q-186; 04 §10.2, §11.4; 05 §4.4, §4.5, §6.10, §9; research/license.md §6.4). */
export const LICENSE_RECORD_COPY = {
  status: { valid: "Valid", expired: "Expired", revoked: "Revoked" },
  /** 07 D113: the Rights row and the PDF's issue line. */
  rights: {
    label: "Rights",
    nonExclusive: "Non-exclusive",
    exclusive: "Exclusive",
    exclusiveUntil: (endDate: string) => `Exclusive until ${endDate}`,
  },
  noEndDate: "No end date",
  /** A video with no postings: /verify's "Where it was posted" and the PDF's Video row (05 §4.5 callout 5, §9). */
  uploadedFile: "Uploaded file",
  /** Q-186: the PDF footer on every page, then "Page N of M". */
  pdfFooter: `${APP_NAME} · ${DRAFT_NOTICE}`,
  pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
  /** The PDF's line after its official-record line when a character no font of it has printed as "?" (known risk 20). */
  pdfMissingGlyphs: (verifyUrl: string) =>
    `Some characters can't be shown in this PDF. The official record at ${verifyUrl} shows them exactly.`,
  /** /l (S04; 04 §10.2, §11.4; owner answers Q-185, Q-186). */
  buyer: {
    ...DOWNLOAD_COPY,
    /** 07 D100: the moment word; the root template adds " · ClipLease". */
    title: (videoTitle: string) => `Cleared: ${videoTitle}`,
    headline: { lead: "Cleared.", rest: "Yours to post." },
    approvedLine: (handle: string, date: string) =>
      `@${handle} approved your request · ${date}`,
    facts: {
      license: "License",
      status: "Status",
      use: "Use",
      term: "Term",
      territory: "Territory",
      licensedTo: "Licensed to",
      paid: "Paid",
    },
    credit: "Credit when you post",
    whatYouCanDo: "What you can do",
    verifyLead: "Anyone can check this license:",
    verifyLink: "Verify link",
    /** What each Copy pill copies: its name reads "Copy {name}". */
    copyNames: { code: "license code", credit: "credit line" },
    /** `date` is formatPostDate(starts_at), the capture day as 04 §10.2 draws it. */
    receipt: (total: string, date: string, maskedEmail: string) =>
      sentences(
        `Paid ${total} on ${date}.`,
        `Receipt sent to ${maskedEmail}.`,
        "Questions? Reply to the license email.",
      ),
    revokedOn: (date: string) => `Revoked on ${date}.`,
    /** Q-186; P21b adds the refund line. */
    revoked: `This license no longer allows any use of this video. Questions? ${SUPPORT_EMAIL}`,
  },
  /** /verify (S05; research/license.md §6.4 with CL- codes, 07 D101, D113; owner answers Q-184, Q-186). */
  verify: {
    heading: {
      valid: "Valid license",
      expired: "Expired",
      revoked: "Revoked",
    },
    /** 05 §4.5's own rows; Licensed to, Use, Term, Territory and Rights are /l's. */
    facts: {
      licensedBy: "Licensed by",
      ownership: "Ownership",
      video: "Video",
      starts: "Starts",
      ends: "Ends",
      issued: "Issued",
      terms: "Terms",
    },
    notFoundHeading: "No license found",
    active: (licensee: string, use: string, territory: string, until: string) =>
      `This license is active. ${licensee} may use this video for ${use} in ${territory} ${until}.`,
    activeExclusive: (
      licensee: string,
      use: string,
      territory: string,
      endDate: string,
    ) =>
      `This license is active and exclusive. ${licensee} may use this video for ${use} in ${territory} until ${endDate}, and no one else may license it until then.`,
    ended: (endDate: string) =>
      `This license ended on ${endDate}. It no longer allows any use of this video.`,
    revoked: (date: string) =>
      `This license was revoked on ${date} and no longer allows any use of this video. Questions? ${SUPPORT_EMAIL}`,
    /** Only for a canonical code (LICENSE_CODE_PATTERN); never raw input (Q-184). */
    notFound: (code: string) =>
      `We couldn't find a license with the code ${code}.`,
    malformed: "That doesn't look like a license code.",
    notFoundHelp: `License codes look like CL-XXXX-XXXX and are printed on the license PDF. If someone showed you this code as proof of permission, ask them for the PDF or write to ${SUPPORT_EMAIL}.`,
    music: { label: "Music", value: "not included" },
    people: { label: "People", value: "no releases" },
  },
  /** /dashboard/licenses (S22; owner answer Q-186). */
  dashboard: {
    title: "Licenses",
    heading: { lead: "Licenses.", rest: "Everything you've sold." },
    empty: { lead: "Licenses.", rest: "None yet." },
    emptyBody: "They appear here the moment you approve a request.",
    /** The list's headers, also the stacked rows' labels below lg (04 §9.31). */
    columns: {
      code: "Code",
      licensedTo: "Licensed to",
      video: "Video",
      scope: "Scope",
      issued: "Issued",
      youGot: "You got",
      status: "Status",
      downloads: "Downloads",
      publicRecord: "Public record",
    },
    viewPublicRecord: "View public record",
  },
  /** /licenses and /licenses/[licenseId] (S24, S25; P20b): a leaf module, for the client files that print it. */
  myLicenses: MY_LICENSES_COPY,
} as const;

const COPY = LICENSE_RECORD_COPY;

export const licenseDate = (at: Date | string) =>
  formatLicenseDate(new Date(at));

/** The status pill (04 §9.9; prompt Task 5): Valid filled, Expired neutral, Revoked danger. */
export function licenseStatusPill(status: RecordStatus): {
  label: string;
  tone: "cleared" | "neutral" | "danger";
} {
  const tone = {
    valid: "cleared",
    expired: "neutral",
    revoked: "danger",
  } as const;
  return { label: COPY.status[status], tone: tone[status] };
}

/** 07 D113: "Exclusive until 20 Nov 2027, 15:00 UTC" or "Non-exclusive". An exclusive license always ends (I35). */
export function rightsLabel(
  s: Pick<LicenseSnapshotV1, "exclusive" | "endsAt">,
): string {
  if (!s.exclusive) return COPY.rights.nonExclusive;
  if (!s.endsAt) throw new Error("rightsLabel: an exclusive license ends");
  return COPY.rights.exclusiveUntil(licenseDate(s.endsAt));
}

/** The Territory fact: "Worldwide" · "One country — United States", as License v1's Territory row has it. */
export const territoryText = ({
  territoryLabel,
  territoryDetail,
}: Pick<LicenseSnapshotV1["scope"], "territoryLabel" | "territoryDetail">) =>
  territoryDetail ? `${territoryLabel} — ${territoryDetail}` : territoryLabel;

/** The end as a fact or a PDF token: "15 Oct 2027, 14:32 UTC", or "No end date" for Perpetual (research/license.md §4). */
export const endDateText = (endsAt: string | null) =>
  endsAt ? licenseDate(endsAt) : COPY.noEndDate;

/**
 * The Term fact (04 §10.2): "1 year · 15 Oct 2026, 14:32 UTC to 15 Oct 2027, 14:32 UTC"; Perpetual "Perpetual · From 15
 * Oct 2026, 14:32 UTC · No end date" (04 §11.11's "From {start} · No end date").
 */
export function termText(
  s: Pick<LicenseSnapshotV1, "scope" | "startsAt" | "endsAt">,
): string {
  const start = licenseDate(s.startsAt);
  return s.endsAt
    ? `${s.scope.termLabel} · ${start} to ${licenseDate(s.endsAt)}`
    : `${s.scope.termLabel} · From ${start} · ${COPY.noEndDate}`;
}

// License v1's Paid row is the one source of the amounts' words (07 D98): its first sentence is the breakdown, its
// second the currency line, which 05 §9 prints on a line of its own.
const PAID_SENTENCES = /^(.+)\. (.+\.)$/;

function paidRow(): { breakdown: string; currencyLine: string } {
  const row = LICENSE_V1_HEADER.find(([label]) => label === "Paid");
  const parts = row && PAID_SENTENCES.exec(row[1]);
  if (!parts) throw new Error("License v1: the Paid row changed shape");
  return { breakdown: parts[1], currencyLine: parts[2] };
}

/** License v1's amount tokens for a snapshot's amounts (07 D94, D98): the Paid row's and the legal sections'. */
export function amountValues(amounts: LicenseSnapshotV1["amounts"]) {
  const money = (cents: number) => formatMoney(cents, amounts.currency);
  return {
    license_fee: money(amounts.licensePriceCents),
    service_fee: money(amounts.platformFeeCents),
    total_paid: money(amounts.amountTotalCents),
    currency_label: currencyLabel(amounts.currency),
  };
}

/** "License fee CA$1,575.00 + service fee CA$157.50 = CA$1,732.50", each amount in the snapshot's currency (07 D94). */
export function amountsText(amounts: LicenseSnapshotV1["amounts"]): string {
  return fillLicenseV1(paidRow().breakdown, amountValues(amounts));
}

/** "Amounts in Canadian dollars (CAD)." (07 D98): /l, the PDF and license-approved. */
export const amountsIn = (currency: Currency) =>
  fillLicenseV1(paidRow().currencyLine, {
    currency_label: currencyLabel(currency),
  });

/**
 * What follows the territory on an issued license: "until 15 Oct 2027, 14:32 UTC", or Perpetual's "with no end date"
 * (summary.ts's).
 */
const recordTermPhrase = (s: Pick<LicenseSnapshotV1, "scope" | "endsAt">) =>
  s.endsAt ? `until ${licenseDate(s.endsAt)}` : termPhrase(s.scope.termKey);

/**
 * licenseSummary's input for an issued license (01 §4.7; 07 D113): the snapshot's scope, flags and credit line, the
 * request's territory code (the "in the United States" sentence, Q-115 a, Q-183), and "until {end}" in place of the
 * page's "for 1 year from approval" (Perpetual keeps "with no end date").
 */
export function licenseSummaryInput(
  s: LicenseSnapshotV1,
  territoryCode: string | null,
): SummaryInput {
  return {
    useKey: s.scope.useKey,
    termKey: s.scope.termKey,
    territoryKey: s.scope.territoryKey,
    territoryCode,
    handle: s.creator.handle,
    creditLine: s.creditLine,
    containsMusic: s.exclusions.music,
    identifiablePeople: s.exclusions.people,
    termPhrase: recordTermPhrase(s),
    exclusive: s.exclusive,
  };
}

type SnapshotPosting = LicenseSnapshotV1["postings"][number];

/**
 * A snapshot posting as PostingList takes it (PROGRESS P18 follow-up): the record keeps neither a hidden link nor a
 * removal nor a disconnect, so `hasLink` is `url !== null` (a hidden link reads "Also posted on {Platform}"), `removed`
 * and `noLongerLinked` are false.
 */
function toPublicPosting(p: SnapshotPosting): PublicPostingDTO {
  return {
    platform: p.platform,
    label: p.label,
    verified: p.verified,
    verifiedUsername: p.verified ? p.verifiedUsername : null,
    linkedAt: p.verified ? p.linkedAt : null,
    noLongerLinked: false,
    url: p.url,
    hostLabel: postingHostLabel(p.platform, p.url),
    removed: false,
    hasLink: p.url !== null,
  };
}

/** The posting ownership was read from: the snapshot doesn't mark it, so it is matched by platform, handle and link. */
function isOwnershipPosting(
  ownership: LicenseSnapshotV1["ownership"],
  p: SnapshotPosting,
): boolean {
  return (
    ownership.kind === "verified_owner" &&
    p.verified &&
    p.platform === ownership.provider &&
    p.verifiedUsername === ownership.providerUsername &&
    p.url === ownership.sourcePermalink
  );
}

/** The record's "Where it was posted" (07 D70, D71): its postings in their stored order, and the ownership's posting. */
export function snapshotPostings(
  s: Pick<LicenseSnapshotV1, "ownership" | "postings">,
): PublicPostings {
  const postings = s.postings.map(toPublicPosting);
  const index = s.postings.findIndex((p) => isOwnershipPosting(s.ownership, p));
  return { primary: index === -1 ? null : postings[index], postings };
}

/**
 * The record's ownership badge (04 §9.19; 07 D43, D70, D89) through the buyers' own builder: the ownership's posting
 * (Demo reads "(demo account)"), the other verified platforms for lg's line 3; self-attested with the D70 sentence when
 * a posting isn't verified.
 */
export const snapshotBadge = (
  s: Pick<LicenseSnapshotV1, "ownership" | "postings">,
  size: BadgeInput["size"],
): BadgeInput => publicBadge(snapshotPostings(s), size);

/** What /verify's status sentence reads besides the snapshot: the license row's revoked_at and the request's code. */
export type VerifyFacts = {
  territoryCode: string | null;
  revokedAt: Date | string | null;
};

/**
 * /verify's status sentence (research/license.md §6.4; 07 D113; owner answers Q-115 a, Q-186): the territory as a
 * sentence names it ("in the United States", "in any country"), from the request's code. No reason for a revoked
 * license. Its heading is COPY.verify.heading[status].
 */
export function verifySentence(
  s: Pick<LicenseSnapshotV1, "licensee" | "scope" | "endsAt" | "exclusive">,
  status: RecordStatus,
  facts: VerifyFacts,
): string {
  const end = endDateText(s.endsAt);
  if (status === "expired") return COPY.verify.ended(end);
  if (status === "revoked") {
    if (!facts.revokedAt) throw new Error("verifySentence: no revoked_at");
    return COPY.verify.revoked(licenseDate(facts.revokedAt));
  }
  const name = s.licensee.name;
  const use = s.scope.useLabel;
  const territory = territoryInSentence(
    s.scope.territoryKey,
    facts.territoryCode,
  );
  if (s.exclusive && s.endsAt) {
    return COPY.verify.activeExclusive(name, use, territory, end);
  }
  return COPY.verify.active(name, use, territory, recordTermPhrase(s));
}

/** /verify's `<title>` (Q-186): "Valid license: CL-7K3M-9QXA" · "Expired: …" · "Revoked: …". */
export const verifyTitle = (status: RecordStatus, code: string) =>
  `${COPY.verify.heading[status]}: ${code}`;

/** /verify's exclusion rows, only when flagged (Q-186). */
export function exclusionRows(
  exclusions: LicenseSnapshotV1["exclusions"],
): { label: string; value: string }[] {
  return [
    ...(exclusions.music ? [COPY.verify.music] : []),
    ...(exclusions.people ? [COPY.verify.people] : []),
  ];
}

/**
 * /verify's footer on every status, the not-found view included (research/license.md §6.4's first four sentences; 01
 * J10.5, 07 D43, D70): the record sentences with `domain` (APP_URL's host), then the badge explainer and D70's sentence.
 */
export const verifyFooter = (domain: string) => [
  `${APP_NAME} keeps the official record of every license. If anything here differs from a PDF you were shown, this page is correct. Check that your address bar shows ${domain}. This page never shows prices or contact details.`,
  BADGE_COPY.verifiedExplainer,
  BADGE_COPY.postingsExplainer,
];

/** "Downloaded 2 times" · "Downloaded 1 time" · nothing at 0 (Q-186). */
export function downloadsText(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? "Downloaded 1 time" : `Downloaded ${count} times`;
}

export { DOWNLOAD_FAILED };

/** `/l/{token}?download=failed`: where a download route sends the buyer when it fails unexpectedly (Q-185). Never logged. */
export const downloadFailedPath = (token: string) =>
  `${licensePath(token)}?${DOWNLOAD_FAILED.param}=${DOWNLOAD_FAILED.value}`;

/** True when a download page's query carries `?download=failed`, the flag downloadFailedPath writes (Q-185). */
export const isDownloadFailed = (
  query: Record<string, string | string[] | undefined>,
): boolean => query[DOWNLOAD_FAILED.param] === DOWNLOAD_FAILED.value;
