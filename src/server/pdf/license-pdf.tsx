import "server-only";
import {
  Circle,
  Page,
  Path,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import { CLEARED_SEAL_CHECK } from "@/lib/brand";
import { fitWords, textWidth } from "./fit-words";
import { PDF_FONT_STACK, type PdfFace } from "./fonts";
import type {
  LicensePdfContent,
  PdfBlock,
  PdfLine,
  PdfRow,
  PdfSection,
} from "./license-pdf-content";

// The license PDF's pages (05 §9, S26): US Letter, 48 pt margins, the embedded font stack in regular and bold
// (fonts.ts; known risk 20). The record: the title, the issue line and the code with its seal, the verify URL, the
// header rows (Rights from snapshot.exclusive, "Exclusive until …" or "Non-exclusive", 07 D113), the official-record
// sentence (and the missing-glyph note, when a character printed as "?") and the summary, on page 1 unless its postings
// run over; then License v1 and Schedule A from a new page. The draft line and "Page N of M" sit on every page (Q-186).
// Every word comes from licensePdfContent; this file lays them out. No QR code ([H6]). generate.ts wraps the pages in
// the Document.

/** The PDF's colors (05 §9; 04 §3's light `ink`, `ink-2`, `hairline`, `cleared`, `cleared-ink`): no CSS variables here. */
const PDF_COLORS = {
  ink: "#111111",
  /** Labels and the footer: 6.19:1 on white. */
  label: "#616161",
  hairline: "#E5E5E5",
  /** The seal: in grayscale the disc prints about #B2B2B2 and the check keeps 8.91:1 against it. */
  sealDisc: "#1BCB80",
  sealCheck: "#111111",
} as const;

/** 05 §9's type, in points: title 18/600, code 16/600 (`tracking-code`, 0.04 em), body 9.5, labels and footer 8. */
const TYPE = { title: 18, code: 16, body: 9.5, small: 8 } as const;
/** Line height, a multiple of the style's own font size: react-pdf turns it into points where it is declared. */
const LEADING = { text: 1.3, display: 1.2 } as const;
/** LETTER, in points. */
const PAGE = { width: 612, height: 792 } as const;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE.width - 2 * MARGIN;
const LABEL_WIDTH = 84;
const COLUMN_GAP = 12;
const VALUE_WIDTH = CONTENT_WIDTH - LABEL_WIDTH - COLUMN_GAP;
const BULLET = "•";
const BULLET_GAP = 6;
/** A list item's text column, beside its bullet and the gap. */
const listTextWidth = (face: PdfFace) =>
  CONTENT_WIDTH - textWidth(BULLET, TYPE.body, face) - BULLET_GAP;
/** Room for kerning and contextual forms, which fitWords doesn't measure. */
const KERNING_SLACK = 6;
/** 18 mm. */
const SEAL_SIZE = 51;
/** The footer's box (its rule, 6 pt and one 8 pt line) at the bottom margin, and the gap above it. */
const FOOTER_HEIGHT = 18;
const FOOTER_GAP = 10;
/** The summary's last line (one 9.5 pt line) above the footer on the record's last page, and the gap above it. */
const NOTE_HEIGHT = 14;
const NOTE_GAP = 8;
const FOOTER_TOP = PAGE.height - MARGIN - FOOTER_HEIGHT;
const NOTE_TOP = FOOTER_TOP - FOOTER_GAP - NOTE_HEIGHT;

const page = {
  paddingTop: MARGIN,
  paddingHorizontal: MARGIN,
  paddingBottom: PAGE.height - FOOTER_TOP + FOOTER_GAP,
  fontFamily: PDF_FONT_STACK,
  fontSize: TYPE.body,
  lineHeight: LEADING.text,
  color: PDF_COLORS.ink,
};

// Fixed nodes are placed from the top: react-pdf 4.9 puts a fixed node's `bottom` off the page once a page wraps.
const styles = StyleSheet.create({
  page,
  recordPage: { ...page, paddingBottom: PAGE.height - NOTE_TOP + NOTE_GAP },
  top: { flexDirection: "row", justifyContent: "space-between", gap: 16 },
  titleBlock: { flexShrink: 1, gap: 4 },
  title: {
    fontWeight: 700,
    fontSize: TYPE.title,
    lineHeight: LEADING.display,
  },
  codeBlock: { alignItems: "flex-end", gap: 4 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  code: {
    fontWeight: 700,
    fontSize: TYPE.code,
    lineHeight: LEADING.display,
    letterSpacing: TYPE.code * 0.04,
  },
  verifyUrl: { marginTop: 6, textAlign: "right" },
  label: {
    fontSize: TYPE.small,
    lineHeight: LEADING.text,
    color: PDF_COLORS.label,
  },
  rule: {
    marginVertical: 10,
    borderBottomWidth: 0.75,
    borderBottomColor: PDF_COLORS.hairline,
  },
  row: { flexDirection: "row", gap: COLUMN_GAP, marginBottom: 4 },
  rowLabel: { width: LABEL_WIDTH, paddingTop: 1.5 },
  rowValue: { width: VALUE_WIDTH, gap: 1 },
  missingGlyphs: { marginTop: 4 },
  heading: { fontWeight: 700, marginBottom: 6 },
  sectionTitle: {
    fontWeight: 700,
    marginTop: 10,
    marginBottom: 4,
  },
  block: { marginBottom: 4 },
  listItem: { flexDirection: "row", gap: BULLET_GAP, marginBottom: 3 },
  listText: { flex: 1 },
  note: {
    position: "absolute",
    left: MARGIN,
    right: MARGIN,
    top: NOTE_TOP,
    color: PDF_COLORS.label,
  },
  footer: {
    position: "absolute",
    left: MARGIN,
    right: MARGIN,
    top: FOOTER_TOP,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    borderTopWidth: 0.75,
    borderTopColor: PDF_COLORS.hairline,
    fontSize: TYPE.small,
    color: PDF_COLORS.label,
  },
});

/** The cleared seal (04 §10.1, ClearedSeal's geometry): a disc and a check drawn as a path, never a "✓" glyph. */
function Seal() {
  return (
    <Svg width={SEAL_SIZE} height={SEAL_SIZE} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={50} fill={PDF_COLORS.sealDisc} />
      <Path
        d={CLEARED_SEAL_CHECK.d}
        fill="none"
        stroke={PDF_COLORS.sealCheck}
        strokeWidth={CLEARED_SEAL_CHECK.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * `text` for a `width` pt column in the regular `face`: a URL, or any word without a space wider than the column, on
 * lines of its own, cut to the width; react-pdf would otherwise run it off the page (PD-5). Every text that can hold a
 * name, a title or a link goes through it; the others (the bold ones among them) hold template words, the code, dates
 * and option labels only.
 */
const columnText = (
  text: string,
  width: number,
  face: PdfFace,
  size: number = TYPE.body,
) => fitWords(text, width - KERNING_SLACK, size, face);

function Line({ line, face }: { line: PdfLine; face: PdfFace }) {
  if ("url" in line) {
    return <Text>{columnText(line.url, VALUE_WIDTH, face)}</Text>;
  }
  const size = line.muted ? TYPE.small : TYPE.body;
  return (
    <Text style={line.muted ? styles.label : undefined}>
      {columnText(line.text, VALUE_WIDTH, face, size)}
    </Text>
  );
}

/** A header row; it may run onto the next page (twelve postings with 2,048-character links don't fit on one). */
function Row({ row, face }: { row: PdfRow; face: PdfFace }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, styles.rowLabel]}>{row.label}</Text>
      <View style={styles.rowValue}>
        {row.lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a printed document; its lines never reorder and may repeat.
          <Line key={index} line={line} face={face} />
        ))}
      </View>
    </View>
  );
}

/** The summary's groups (01 §4.7, 05 §9 region 6); its last line is the record page's note. */
function Summary({
  summary,
  face,
}: {
  summary: LicensePdfContent["summary"];
  face: PdfFace;
}) {
  return (
    <View>
      <Text style={styles.heading}>{summary.heading}</Text>
      {summary.groups.map((group) => (
        <View key={group.title} style={styles.row} wrap={false}>
          <Text style={[styles.label, styles.rowLabel]}>{group.title}</Text>
          <View style={styles.rowValue}>
            {group.rows.map((text) => (
              <Text key={text}>{columnText(text, VALUE_WIDTH, face)}</Text>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function Block({ block, face }: { block: PdfBlock; face: PdfFace }) {
  if (block.kind === "heading") {
    return <Text style={styles.sectionTitle}>{block.text}</Text>;
  }
  if (block.kind === "text") {
    return (
      <Text style={styles.block}>
        {columnText(block.text, CONTENT_WIDTH, face)}
      </Text>
    );
  }
  return (
    <View style={styles.block}>
      {block.items.map((item) => (
        <View key={item} style={styles.listItem}>
          <Text>{BULLET}</Text>
          <Text style={styles.listText}>
            {columnText(item, listTextWidth(face), face)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const blockKey = (block: PdfBlock) =>
  block.kind === "list" ? block.items.join("\n") : block.text;

/**
 * A section's title and blocks, each run of headings kept on one page with the block after it: no page ends on a
 * heading (react-pdf 4.9's `minPresenceAhead` doesn't move one).
 */
function LegalSection({
  section,
  face,
}: {
  section: PdfSection;
  face: PdfFace;
}) {
  const groups: PdfBlock[][] = [];
  let pending: PdfBlock[] = [{ kind: "heading", text: section.title }];
  for (const block of section.blocks) {
    pending.push(block);
    if (block.kind !== "heading") {
      groups.push(pending);
      pending = [];
    }
  }
  if (pending.length > 0) groups.push(pending);
  return groups.map((group) => (
    <View key={blockKey(group[0])} wrap={group.length === 1}>
      {group.map((block) => (
        <Block key={blockKey(block)} block={block} face={face} />
      ))}
    </View>
  ));
}

/** The draft line and "Page N of M" on every page (Q-186). */
function PageFooter({ footer }: { footer: LicensePdfContent["footer"] }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{footer.line}</Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          footer.page(pageNumber, totalPages)
        }
      />
    </View>
  );
}

/**
 * The record's page (page 1, or more when its postings run over), then the legal text's pages (05 §9). `face` is the
 * regular stack, loaded (pdfFonts), that the columns are cut by.
 */
export function LicensePdf({
  content: c,
  face,
}: {
  content: LicensePdfContent;
  face: PdfFace;
}) {
  return (
    <>
      <Page size="LETTER" style={styles.recordPage}>
        <View style={styles.top}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{c.title}</Text>
            <Text>{c.issuedLine}</Text>
          </View>
          <View style={styles.codeBlock}>
            <Text style={styles.label}>{c.codeLabel}</Text>
            <View style={styles.codeRow}>
              <Seal />
              <Text style={styles.code}>{c.code}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.verifyUrl}>
          {columnText(c.verifyUrl, CONTENT_WIDTH, face)}
        </Text>
        <View style={styles.rule} />
        {c.rows.map((row) => (
          <Row key={row.label} row={row} face={face} />
        ))}
        <Text>{columnText(c.officialRecord, CONTENT_WIDTH, face)}</Text>
        {c.missingGlyphs && (
          <Text style={styles.missingGlyphs}>
            {columnText(c.missingGlyphsNote, CONTENT_WIDTH, face)}
          </Text>
        )}
        <View style={styles.rule} />
        <Summary summary={c.summary} face={face} />
        {/* On the record's last page only, naming the page the legal text starts on (05 §9 region 6). */}
        <Text
          style={styles.note}
          fixed
          render={({ subPageNumber, subPageTotalPages }) =>
            subPageNumber === subPageTotalPages
              ? c.summary.footer(subPageTotalPages + 1)
              : null
          }
        />
        <PageFooter footer={c.footer} />
      </Page>
      <Page size="LETTER" style={styles.page}>
        {c.legal.map((section) => (
          <LegalSection key={section.title} section={section} face={face} />
        ))}
        <PageFooter footer={c.footer} />
      </Page>
    </>
  );
}
