// Structured legal text shared by License v1 and the legal pages. Pure: no React, no env.
export type LegalLink = { readonly href: string; readonly label: string };

/** A paragraph: plain text, or text with inline links. */
export type LegalText = string | readonly (string | LegalLink)[];

export type LegalBlock =
  | LegalText
  | { readonly heading: string }
  | { readonly list: readonly LegalText[] };

export type LegalSection = {
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly LegalBlock[];
};

function mapText(text: LegalText, fn: (s: string) => string): LegalText {
  if (typeof text === "string") return fn(text);
  return text.map((part) =>
    typeof part === "string" ? fn(part) : { ...part, label: fn(part.label) },
  );
}

export function isLegalText(block: LegalBlock): block is LegalText {
  return typeof block === "string" || Array.isArray(block);
}

function mapBlock(block: LegalBlock, fn: (s: string) => string): LegalBlock {
  if (isLegalText(block)) return mapText(block, fn);
  if ("heading" in block) return { heading: fn(block.heading) };
  return { list: block.list.map((t) => mapText(t, fn)) };
}

/** Applies `fn` to every visible string (titles, paragraphs, list items, link labels). */
export function mapSections(
  sections: readonly LegalSection[],
  fn: (s: string) => string,
): LegalSection[] {
  return sections.map((section) => ({
    ...section,
    title: fn(section.title),
    blocks: section.blocks.map((block) => mapBlock(block, fn)),
  }));
}

/** Every visible string of the sections, for tests and checks. */
export function sectionStrings(sections: readonly LegalSection[]): string[] {
  const out: string[] = [];
  mapSections(sections, (s) => {
    out.push(s);
    return s;
  });
  return out;
}
