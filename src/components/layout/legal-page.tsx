import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  LICENSE_V1_UPDATED_LABEL,
  LICENSE_V1_VERSION,
} from "@/lib/legal/license-v1";
import {
  isLegalText,
  type LegalBlock,
  type LegalLink,
  type LegalSection,
  type LegalText,
} from "@/lib/legal/types";

// The draft legal pages (05 §4.8). P02 swaps the notice for Banner and the links for Button variant="link".
const INLINE_LINK = "text-link underline underline-offset-4";

function textKey(text: LegalText): string {
  if (typeof text === "string") return text;
  return text
    .map((part) => (typeof part === "string" ? part : part.href))
    .join("");
}

/** Stable React keys from content; repeated content gets a counter. */
function keyed<T>(items: readonly T[], keyOf: (item: T) => string) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyOf(item);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { key: count === 0 ? base : `${base}#${count}`, item };
  });
}

function InlineLink({ link }: { link: LegalLink }) {
  if (link.href.startsWith("/")) {
    return (
      <Link href={link.href} className={INLINE_LINK}>
        {link.label}
      </Link>
    );
  }
  return (
    <a href={link.href} className={INLINE_LINK}>
      {link.label}
    </a>
  );
}

function TextView({ text }: { text: LegalText }) {
  if (typeof text === "string") return text;
  return keyed(text, (part) =>
    typeof part === "string" ? part : part.href,
  ).map(({ key, item }) =>
    typeof item === "string" ? (
      <span key={key}>{item}</span>
    ) : (
      <InlineLink key={key} link={item} />
    ),
  );
}

function BlockView({ block }: { block: LegalBlock }) {
  if (isLegalText(block)) {
    return (
      <p>
        <TextView text={block} />
      </p>
    );
  }
  if ("heading" in block) {
    return (
      <h3 className="text-body font-semibold text-ink">{block.heading}</h3>
    );
  }
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5">
      {keyed(block.list, textKey).map(({ key, item }) => (
        <li key={key}>
          <TextView text={item} />
        </li>
      ))}
    </ul>
  );
}

export function DraftNotice() {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-md bg-awaiting-tint px-4 py-3 text-callout text-ink"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-awaiting-text"
      />
      <p>Draft for testing. Not for real transactions.</p>
    </div>
  );
}

function blockKey(block: LegalBlock): string {
  if (isLegalText(block)) return textKey(block);
  if ("heading" in block) return `h:${block.heading}`;
  return `l:${block.list.map(textKey).join("|")}`;
}

export function LegalSectionView({ section }: { section: LegalSection }) {
  return (
    <section
      id={section.id}
      aria-labelledby={`${section.id}-title`}
      className="flex flex-col gap-3"
    >
      <h2 id={`${section.id}-title`} className="text-title-2 text-ink">
        {section.title}
      </h2>
      {keyed(section.blocks, blockKey).map(({ key, item }) => (
        <BlockView key={key} block={item} />
      ))}
    </section>
  );
}

/** Draft notice, title, "Last updated", optional intro, contents, then the sections. */
export function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro?: ReactNode;
  sections: readonly LegalSection[];
}) {
  return (
    <article className="mx-auto flex max-w-reading flex-col gap-8 py-6 text-body text-ink wrap-break-word lg:py-12">
      <DraftNotice />
      <header className="flex flex-col gap-2">
        <h1 className="text-title-1 text-ink">{title}</h1>
        <p className="text-callout text-ink-2">
          {`Last updated ${LICENSE_V1_UPDATED_LABEL} · ${LICENSE_V1_VERSION}`}
        </p>
      </header>
      {intro}
      <nav aria-labelledby="contents-title" className="flex flex-col gap-2">
        <h2 id="contents-title" className="text-title-2 text-ink">
          Contents
        </h2>
        <ul className="flex flex-col">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="inline-flex min-h-11 items-center text-link"
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {sections.map((section) => (
        <LegalSectionView key={section.id} section={section} />
      ))}
    </article>
  );
}
