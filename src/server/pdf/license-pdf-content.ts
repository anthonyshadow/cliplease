import "server-only";
import { APP_NAME } from "@/lib/app-name";
import {
  LICENSE_V1_HEADER,
  LICENSE_V1_LEGAL_VALUES,
  LICENSE_V1_MUSIC_CLAUSE,
  LICENSE_V1_PEOPLE_CLAUSE,
  LICENSE_V1_SCHEDULE_A,
  LICENSE_V1_SECTIONS,
} from "@/lib/legal/license-v1";
import {
  fillLicenseV1,
  LICENSE_V1_DISPLAY_TITLE,
} from "@/lib/legal/license-v1-summary";
import {
  isLegalText,
  type LegalBlock,
  type LegalText,
} from "@/lib/legal/types";
import {
  amountsIn,
  amountsText,
  amountValues,
  endDateText,
  LICENSE_RECORD_COPY,
  licenseDate,
  licenseSummaryInput,
  rightsLabel,
  snapshotBadge,
  snapshotPostings,
} from "@/lib/licensing/license-record";
import { rateOptionOneLiner } from "@/lib/licensing/options";
import type { LicenseSnapshotV1 } from "@/lib/licensing/snapshot";
import { licenseSummary } from "@/lib/licensing/summary";
import {
  BUYER_POSTINGS_COPY,
  type BuyerPostingRow,
  buyerPostingRow,
} from "@/lib/postings/buyer-rows";
import { POSTINGS_COPY } from "@/lib/postings/copy";
import { badgeExplainer, badgeText } from "@/lib/videos/ownership";
import { type FamilyOf, printable } from "./printable";

// Every string the license PDF prints (05 §9; 07 D17, D43, D70, D98, D113; owner answers Q-183, Q-186), apart from its
// layout so it can be checked as text: react-pdf compresses the file. Read from the snapshot and the two request facts
// that never change after checkout (Q-183), never from live rows (07 D71). License v1 is the one source of the words:
// one value per {token} for this license, then its header rows, sections and Schedule A filled with them. Every string
// then goes through printable with the PDF's fonts (known risk 20); the snapshot is never altered.

/** What the PDF reads besides the snapshot: the request's territory code and terms acceptance (Q-183), and its URL. */
export type LicensePdfFacts = {
  territoryCode: string | null;
  acceptedAt: Date;
  /** `{APP_URL}/verify/{code}`, printed as text (07 D17). */
  verifyUrl: string;
};

/** A header value line: text (`muted`: the badge's explainer), or a URL the layout cuts to its column. */
export type PdfLine = { text: string; muted?: boolean } | { url: string };
export type PdfRow = { label: string; lines: PdfLine[] };
export type PdfBlock =
  | { kind: "text"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] };
export type PdfSection = { title: string; blocks: PdfBlock[] };

export type LicensePdfContent = {
  /** The Document's title and author, and its creation date: the issue time, so every render is the same file (01 J9.2). */
  meta: { title: string; author: string; createdAt: Date };
  title: string;
  /** "Issued 15 Oct 2026, 14:32 UTC · Non-exclusive" (05 §9 region 2). */
  issuedLine: string;
  codeLabel: string;
  code: string;
  verifyUrl: string;
  rows: PdfRow[];
  officialRecord: string;
  /** Whether a character printed as "?" (printable): `missingGlyphsNote` then follows `officialRecord`. */
  missingGlyphs: boolean;
  /** LICENSE_RECORD_COPY.pdfMissingGlyphs, naming the verify URL. */
  missingGlyphsNote: string;
  summary: {
    heading: string;
    groups: { title: string; rows: string[] }[];
    /** "…is the legal text, from page 2.": the page the legal text starts on, which the layout knows. */
    footer: (legalPage: number) => string;
  };
  /** From the page after the record: sections 1–22, then Schedule A. */
  legal: PdfSection[];
  footer: { line: string; page: (page: number, pages: number) => string };
};

type HeaderLabel = (typeof LICENSE_V1_HEADER)[number][0];

function headerTemplate(label: HeaderLabel): string {
  const row = LICENSE_V1_HEADER.find(([name]) => name === label);
  if (!row) throw new Error(`License v1: no header row ${label}`);
  return row[1];
}

/** "everything in organic, plus …": the use's definition as §4 reads it after "{use_label}: ". */
function definitionOfUse(s: LicenseSnapshotV1): string {
  const sentence = rateOptionOneLiner(s.scope.useKey).replace(/\.$/, "");
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

/**
 * {source_url}, in the Video row and inside §2's parentheses: where the links are (05 §9 region 4) when a posting shows
 * one, else research/license.md §4.1's "Uploaded file (no linked post)", postings with hidden links included. Never a
 * URL in running text, which couldn't wrap (PD-5).
 */
const sourceText = (s: LicenseSnapshotV1) =>
  s.postings.some((p) => p.url !== null)
    ? `links under “${BUYER_POSTINGS_COPY.title}”`
    : `${LICENSE_RECORD_COPY.uploadedFile} (no linked post)`;

/**
 * One value per License v1 token for this license (license-v1.ts's header comment), `ownershipLabel` being the lg
 * badge's line 1. {rights_label} names the kind in the Issued row (05 §9 region 2); the Rights row carries the end
 * ("Exclusive until …" or "Non-exclusive", 07 D113).
 */
function licenseValues(
  s: LicenseSnapshotV1,
  facts: LicensePdfFacts,
  ownershipLabel: string,
): Record<string, string> {
  const { rights } = LICENSE_RECORD_COPY;
  const detail = s.scope.territoryDetail;
  return {
    ...LICENSE_V1_LEGAL_VALUES,
    license_code: s.code,
    issued_at: licenseDate(s.issuedAt),
    rights_label: s.exclusive ? rights.exclusive : rights.nonExclusive,
    creator_display_name: s.creator.displayName,
    creator_handle: `@${s.creator.handle}`,
    ownership_label: ownershipLabel,
    licensee_name: s.licensee.name,
    accepted_at: licenseDate(facts.acceptedAt),
    video_title: `“${s.video.title}”`,
    source_url: sourceText(s),
    use_label: s.scope.useLabel,
    use_definition: definitionOfUse(s),
    term_label: s.scope.termLabel,
    start_date: licenseDate(s.startsAt),
    end_date: endDateText(s.endsAt),
    territory_label: s.scope.territoryLabel,
    territory_detail: detail ? ` — ${detail}` : "",
    credit_line: `“${s.creditLine}”`,
    ...amountValues(s.amounts),
    music_clause: s.exclusions.music ? LICENSE_V1_MUSIC_CLAUSE : "",
    people_clause: s.exclusions.people ? LICENSE_V1_PEOPLE_CLAUSE : "",
    verify_url: facts.verifyUrl,
  };
}

const PILL = {
  verified: POSTINGS_COPY.verified,
  not_verified: POSTINGS_COPY.notVerified,
} as const;

function postingName(row: BuyerPostingRow, label: string): string {
  if (row.kind === "also")
    return `${BUYER_POSTINGS_COPY.alsoPostedOn} ${label}`;
  return row.handle ? `${row.handle} on ${label}` : label;
}

/**
 * "Where it was posted" as text (05 §9 region 8; 07 D70, D71): PostingList's rows in the snapshot's order, each link
 * printed as its stored URL on lines of its own, never the "↗" link text.
 */
function postingLines(s: LicenseSnapshotV1): PdfLine[] {
  return snapshotPostings(s).postings.flatMap((posting): PdfLine[] => {
    const row = buyerPostingRow(posting);
    const name = postingName(row, posting.label);
    const text = row.pill ? `${name} · ${PILL[row.pill]}` : name;
    return row.link ? [{ text }, { url: row.link.href }] : [{ text }];
  });
}

/**
 * The label column (05 §9 regions 4, 8–10): the header's rows, Rights after Territory, then the postings. "Renewal of
 * {code}" (region 11) comes with renewal terms (P22e).
 */
function headerRows(
  s: LicenseSnapshotV1,
  value: (label: HeaderLabel) => string,
  licensor: PdfLine[],
): PdfRow[] {
  const row = (label: HeaderLabel): PdfRow => ({
    label,
    lines: [{ text: value(label) }],
  });
  const postings = postingLines(s);
  return [
    { label: "Licensor", lines: licensor },
    row("Licensee"),
    row("Video"),
    row("Use"),
    row("Term"),
    row("Territory"),
    {
      label: LICENSE_RECORD_COPY.rights.label,
      lines: [{ text: rightsLabel(s) }],
    },
    // The Paid row's two sentences, the currency line on its own (05 §9 region 9; 07 D98).
    {
      label: "Paid",
      lines: [
        { text: amountsText(s.amounts) },
        { text: amountsIn(s.amounts.currency) },
      ],
    },
    // Neither clause: "—" (05 §9 region 4), never a blank row.
    {
      label: "Excluded",
      lines: [{ text: value("Excluded").trim() || "—" }],
    },
    ...(postings.length > 0
      ? [{ label: BUYER_POSTINGS_COPY.title, lines: postings }]
      : []),
  ];
}

const plainText = (text: LegalText) =>
  typeof text === "string"
    ? text
    : text
        .map((part) => (typeof part === "string" ? part : part.label))
        .join("");

/** A legal block as printed; a list drops the items that fill to nothing (§10 without music or people, PD-M1). */
function pdfBlock(block: LegalBlock, fill: (text: string) => string): PdfBlock {
  if (isLegalText(block)) return { kind: "text", text: fill(plainText(block)) };
  if ("heading" in block) return { kind: "heading", text: fill(block.heading) };
  return {
    kind: "list",
    items: block.list
      .map((item) => fill(plainText(item)))
      .filter((item) => item.trim() !== ""),
  };
}

/** The words before printable, without the note it may call for. */
type RecordWords = Omit<
  LicensePdfContent,
  "missingGlyphs" | "missingGlyphsNote"
>;

function recordWords(
  s: LicenseSnapshotV1,
  facts: LicensePdfFacts,
): RecordWords {
  const badge = snapshotBadge(s, "lg");
  const { line1, line2, line3 } = badgeText(badge);
  const values = licenseValues(s, facts, line1);
  const fill = (text: string) => fillLicenseV1(text, values);
  const value = (label: HeaderLabel) => fill(headerTemplate(label));
  // 07 D43, D70 (05 §9 region 4): the lg badge's lines, then its explainer; no other licensor line (07 D93).
  const licensor: PdfLine[] = [
    { text: value("Licensor") },
    ...[line2, line3].flatMap((text) => (text ? [{ text }] : [])),
    ...badgeExplainer(badge).map((text) => ({ text, muted: true })),
  ];
  const summary = licenseSummary(licenseSummaryInput(s, facts.territoryCode));
  return {
    meta: {
      title: `${LICENSE_V1_DISPLAY_TITLE} · ${s.code}`,
      author: APP_NAME,
      createdAt: new Date(s.issuedAt),
    },
    title: LICENSE_V1_DISPLAY_TITLE,
    issuedLine: `Issued ${value("Issued")}`,
    codeLabel: "License code" satisfies HeaderLabel,
    code: s.code,
    verifyUrl: facts.verifyUrl,
    rows: headerRows(s, value, licensor),
    officialRecord: `Official record: ${value("Official record")}`,
    summary: {
      heading: summary.heading,
      groups: summary.groups.map((group) => ({
        title: group.title,
        rows: group.rows.map((row) => `${row.label} — ${row.text}`),
      })),
      // 05 §9 region 6: the legal text follows in this file, so the footer names its page rather than the web link.
      footer: (legalPage) =>
        `${summary.footer.note} ${summary.footer.link.text}, from page ${legalPage}.`,
    },
    legal: [...LICENSE_V1_SECTIONS, LICENSE_V1_SCHEDULE_A].map((section) => ({
      title: fill(section.title),
      blocks: section.blocks.map((block) => pdfBlock(block, fill)),
    })),
    footer: {
      line: LICENSE_RECORD_COPY.pdfFooter,
      page: LICENSE_RECORD_COPY.pageOf,
    },
  };
}

/**
 * `words` as printable prints them with `familyOf`'s fonts, and the note when a character printed as "?". The metadata
 * isn't drawn with a font. The two page-number templates are filled at render, after the note is decided: they add
 * digits to template words only, so they never print a "?".
 */
function printedWords(
  words: RecordWords,
  familyOf: FamilyOf,
): LicensePdfContent {
  let missingGlyphs = false;
  const print = (text: string) => {
    const printed = printable(text, familyOf);
    missingGlyphs ||= printed.missing;
    return printed.text;
  };
  const printLater = (text: string) => printable(text, familyOf).text;
  const line = (l: PdfLine): PdfLine =>
    "url" in l ? { url: print(l.url) } : { ...l, text: print(l.text) };
  const block = (b: PdfBlock): PdfBlock =>
    b.kind === "list"
      ? { kind: "list", items: b.items.map(print) }
      : { ...b, text: print(b.text) };
  const printed: RecordWords = {
    meta: words.meta,
    title: print(words.title),
    issuedLine: print(words.issuedLine),
    codeLabel: print(words.codeLabel),
    code: print(words.code),
    verifyUrl: print(words.verifyUrl),
    rows: words.rows.map((row) => ({
      label: print(row.label),
      lines: row.lines.map(line),
    })),
    officialRecord: print(words.officialRecord),
    summary: {
      heading: print(words.summary.heading),
      groups: words.summary.groups.map((group) => ({
        title: print(group.title),
        rows: group.rows.map(print),
      })),
      footer: (legalPage) => printLater(words.summary.footer(legalPage)),
    },
    legal: words.legal.map((section) => ({
      title: print(section.title),
      blocks: section.blocks.map(block),
    })),
    footer: {
      line: print(words.footer.line),
      page: (page, pages) => printLater(words.footer.page(page, pages)),
    },
  };
  const note = print(LICENSE_RECORD_COPY.pdfMissingGlyphs(words.verifyUrl));
  return { ...printed, missingGlyphs, missingGlyphsNote: note };
}

/**
 * The license PDF's words for `s` (05 §9), as it prints them with `familyOf`'s fonts (the regular stack's). Throws when
 * a template token has no value (fillLicenseV1).
 */
export const licensePdfContent = (
  s: LicenseSnapshotV1,
  facts: LicensePdfFacts,
  familyOf: FamilyOf,
): LicensePdfContent => printedWords(recordWords(s, facts), familyOf);
