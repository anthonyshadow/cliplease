import { inflateSync } from "node:zlib";

// A rendered license PDF's text read back out of the file (05 §9). react-pdf draws with embedded fonts (src/server/pdf/
// fonts.ts) in Identity-H, so a drawn string is glyph ids: each font's /ToUnicode CMap turns them back into text, and
// its /W array gives their widths. pdfkit compresses each stream, writes direct /Length values and one operator a line,
// so where each run of text sits is read by replaying the graphics state line by line. Right-to-left text comes out as
// it is drawn, left to right: "محمد" reads "دمحم".

type PdfObject = { dict: string; stream: Buffer | null };

/** Every indirect object of pdfkit's output: its dictionary, and its stream inflated. */
function pdfObjects(pdf: Buffer): Map<number, PdfObject> {
  const file = pdf.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const header = /(\d+) 0 obj\s*/g;
  for (let found = header.exec(file); found; found = header.exec(file)) {
    const from = header.lastIndex;
    const endAt = file.indexOf("endobj", from);
    const streamAt = file.indexOf("stream", from);
    if (streamAt === -1 || streamAt > endAt) {
      objects.set(Number(found[1]), {
        dict: file.slice(from, endAt),
        stream: null,
      });
      header.lastIndex = endAt;
      continue;
    }
    const dict = file.slice(from, streamAt);
    const length = Number(/\/Length (\d+)/.exec(dict)?.[1]);
    const start =
      streamAt + "stream".length + (file[streamAt + 6] === "\r" ? 2 : 1);
    const bytes = Buffer.from(file.slice(start, start + length), "latin1");
    objects.set(Number(found[1]), {
      dict,
      stream: dict.includes("/FlateDecode") ? inflateSync(bytes) : bytes,
    });
    header.lastIndex = start + length;
  }
  return objects;
}

function object(objects: Map<number, PdfObject>, id: number): PdfObject {
  const found = objects.get(id);
  if (!found) throw new Error(`pdf-text: no object ${id}`);
  return found;
}

/** The object number `key` refers to in `dict` ("/Key 12 0 R"). */
function ref(dict: string, key: string): number {
  const found = new RegExp(`/${key} \\[?(\\d+) 0 R`).exec(dict);
  if (!found) throw new Error(`pdf-text: no /${key} in ${dict}`);
  return Number(found[1]);
}

/** UTF-16BE hex ("0041", "d83c dfac") as text. */
const utf16 = (hex: string) =>
  Buffer.from(hex.replace(/\s/g, ""), "hex").swap16().toString("utf16le");

/** A ToUnicode CMap's glyph ids and their text: its bfchar entries, and its bfrange ones in either form. */
function toUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const [, body] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, text] of body.matchAll(
      /<([0-9a-f]+)>\s*<([0-9a-f\s]*)>/gi,
    )) {
      map.set(Number.parseInt(code, 16), utf16(text));
    }
  }
  for (const [, body] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, low, high, first, list] of body.matchAll(
      /<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(?:<([0-9a-f\s]*)>|\[([^\]]*)\])/gi,
    )) {
      const from = Number.parseInt(low, 16);
      const to = Number.parseInt(high, 16);
      if (list !== undefined) {
        [...list.matchAll(/<([0-9a-f\s]*)>/gi)].forEach(([, text], i) => {
          map.set(from + i, utf16(text));
        });
        continue;
      }
      // One destination, its last code unit counting up through the range.
      const base = utf16(first);
      for (let code = from; code <= to; code += 1) {
        const last = base.charCodeAt(base.length - 1) + code - from;
        map.set(code, base.slice(0, -1) + String.fromCharCode(last));
      }
    }
  }
  return map;
}

/** An embedded font as the content streams use it: its name without the subset tag, its glyphs' text and widths. */
type DrawnFont = {
  name: string;
  text: Map<number, string>;
  /** Advance widths by glyph id, in 1000ths of an em (its /W array, from glyph 0). */
  widths: number[];
};

function drawnFont(objects: Map<number, PdfObject>, id: number): DrawnFont {
  const { dict } = object(objects, id);
  const name = /\/BaseFont \/(?:[A-Z]{6}\+)?(\S+)/.exec(dict)?.[1] ?? "";
  if (!dict.includes("/ToUnicode")) {
    throw new Error(`pdf-text: ${name}, a standard font, drew text`);
  }
  const cmap = object(objects, ref(dict, "ToUnicode")).stream;
  const descendant = object(objects, ref(dict, "DescendantFonts")).dict;
  const widths = /\/W \[0 \[([^\]]*)\]/.exec(descendant)?.[1] ?? "";
  return {
    name,
    text: toUnicode(cmap?.toString("latin1") ?? ""),
    widths: widths.trim().split(/\s+/).map(Number),
  };
}

/**
 * Each page's content stream and its fonts by resource name ("F3"), in the page tree's order. A font is read when a
 * run draws with it: a line break selects react-pdf's Helvetica fallback (no font has U+000A) and draws nothing.
 */
function pdfPageContents(pdf: Buffer) {
  const objects = pdfObjects(pdf);
  const read = new Map<number, DrawnFont>();
  const fontAt = (id: number) => {
    const font = read.get(id) ?? drawnFont(objects, id);
    read.set(id, font);
    return font;
  };
  const tree = [...objects.values()].find(({ dict }) =>
    dict.includes("/Type /Pages"),
  );
  const kids = /\/Kids \[([^\]]*)\]/.exec(tree?.dict ?? "")?.[1] ?? "";
  return [...kids.matchAll(/(\d+) 0 R/g)].map(([, id]) => {
    const page = object(objects, Number(id)).dict;
    const resources = object(objects, ref(page, "Resources")).dict;
    const names = /\/Font <<([^>]*)>>/.exec(resources)?.[1] ?? "";
    const fonts = new Map(
      [...names.matchAll(/\/(\S+) (\d+) 0 R/g)].map(([, name, font]) => [
        name,
        Number(font),
      ]),
    );
    const font = (name: string) => {
      const fontId = fonts.get(name);
      if (fontId === undefined) throw new Error(`pdf-text: no font ${name}`);
      return fontAt(fontId);
    };
    const content = object(objects, ref(page, "Contents")).stream;
    return { content: content?.toString("latin1") ?? "", font };
  });
}

/** A PDF matrix, [a b c d e f]. */
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` then `n`: what `m cm` makes of the current matrix `n`, and how a text matrix maps into the page. */
const times = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/**
 * A drawn run of text (one TJ): its text; on the page, in points, its left edge, where its last glyph other than a
 * space ends (its glyphs' widths and the TJ's adjustments; a line's last run keeps the space it broke at) and its
 * baseline's height from the bottom; its font's name ("Inter-Regular") and size. No text here is scaled.
 */
export type Run = {
  text: string;
  left: number;
  right: number;
  baseline: number;
  font: string;
  size: number;
};

/** One TJ's operands in `font` at `size`: its text, and where its last glyph other than a space ends, in points. */
function showText(
  operands: string,
  font: DrawnFont,
  size: number,
): { text: string; width: number } {
  let text = "";
  let advance = 0;
  let width = 0;
  for (const [, hex, adjust] of operands.matchAll(
    /<([0-9a-f]*)>|(-?[\d.]+)/gi,
  )) {
    if (adjust !== undefined) {
      advance -= (Number(adjust) / 1000) * size;
      continue;
    }
    for (const [code] of hex.matchAll(/[0-9a-f]{4}/gi)) {
      const glyph = Number.parseInt(code, 16);
      const unicode = font.text.get(glyph);
      const glyphWidth = font.widths[glyph];
      if (unicode === undefined || glyphWidth === undefined) {
        throw new Error(`pdf-text: ${font.name} has no glyph ${glyph}`);
      }
      text += unicode;
      advance += (glyphWidth / 1000) * size;
      if (unicode.trim() !== "") width = advance;
    }
  }
  return { text, width };
}

/** Each page's runs, in drawing order: every page's content stream replayed. */
export function pdfRuns(pdf: Buffer): Run[][] {
  return pdfPageContents(pdf).map(({ content, font: fontNamed }) => {
    const runs: Run[] = [];
    const saved: Matrix[] = [];
    let ctm = IDENTITY;
    let tm = IDENTITY;
    let fontName = "";
    let size = 0;
    for (const line of content.split("\n")) {
      const words = line.trim().split(" ");
      const op = words.at(-1);
      const args = words.slice(0, -1).map(Number) as Matrix;
      if (op === "q") saved.push(ctm);
      else if (op === "Q") ctm = saved.pop() ?? IDENTITY;
      else if (op === "cm") ctm = times(args, ctm);
      else if (op === "Tm") tm = args;
      else if (op === "Tf") {
        fontName = words[0].slice(1);
        size = Number(words[1]);
      } else if (op === "TJ") {
        const font = fontNamed(fontName);
        const { text, width } = showText(line, font, size);
        const [, , , , left, baseline] = times(tm, ctm);
        runs.push({
          text,
          left,
          right: left + width,
          baseline,
          font: font.name,
          size,
        });
      }
    }
    return runs;
  });
}

/** Each page's text, in drawing order. */
export const pdfPages = (pdf: Buffer) =>
  pdfRuns(pdf).map((runs) => runs.map((run) => run.text).join(""));

/** The /BaseFont of every font the file embeds, subset tag included ("BZZZZZ+Inter-Regular"). */
export const embeddedFonts = (pdf: Buffer) =>
  [...pdfObjects(pdf).values()]
    .filter(({ dict }) => dict.includes("/Subtype /Type0"))
    .map(({ dict }) => /\/BaseFont \/(\S+)/.exec(dict)?.[1] ?? "");

/** Line breaks and the spaces at them depend on the layout: compare without white space. */
export const squash = (text: string) => text.replace(/\s+/g, "");

/** A page's text without white space or its footer, which a text running onto the next page is drawn around. */
export const pageBody = (page: string) =>
  squash(page).replace(
    /ClipLease·Draftfortesting\.Notforrealtransactions\.Page\d+of\d+/g,
    "",
  );
