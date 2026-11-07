import { verifyFooter } from "@/lib/licensing/license-record";

/**
 * The footer on every /verify answer, the not-found view included (research/license.md §6.4; 01 J10.5; 07 D43, D70):
 * the official-record sentences naming `domain`, then the badge explainer and the Verified / Not verified sentence.
 */
export function RecordFooter({ domain }: { domain: string }) {
  return (
    <footer className="flex flex-col gap-2 self-stretch border-t border-hairline pt-6 text-footnote text-ink-2">
      {verifyFooter(domain).map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </footer>
  );
}
