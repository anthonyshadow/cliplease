import Link from "next/link";

const STEPS = [
  ["Connect.", "Your accounts, read-only."],
  ["Pick.", "Any post, one link."],
  ["Approve.", "Paid, with a license."],
] as const;

const LEGAL_LINKS = [
  ["/legal/license/v1", "License"],
  ["/legal/terms", "Terms"],
  ["/legal/privacy", "Privacy"],
] as const;

// Landing (05 §4.7). Static: no 'use cache', no session read.
export default function LandingPage() {
  return (
    <div className="mx-auto flex max-w-reading flex-col gap-12 py-6 lg:gap-20 lg:py-12">
      <section className="flex flex-col gap-6">
        <h1 className="text-display text-ink">
          Your video. <span className="text-ink-2">Your price.</span>
        </h1>
        <p className="text-body text-ink-2">
          Link your Instagram, TikTok and YouTube. Turn any post into a license
          link. Get paid when you tap Approve.
        </p>
        <Link
          href="/sign-in"
          prefetch={false}
          className="inline-flex h-11 w-full items-center justify-center rounded-full border border-transparent bg-action px-5 text-body font-semibold text-action-ink hover:bg-action-hover sm:w-auto sm:self-start"
        >
          Sign in
        </Link>
      </section>

      <ul className="flex flex-col gap-3">
        {STEPS.map(([lead, rest]) => (
          <li key={lead} className="text-title-2 text-ink">
            {lead} <span className="text-ink-2">{rest}</span>
          </li>
        ))}
      </ul>

      <footer className="border-t border-hairline pt-6">
        <nav aria-label="Legal" className="flex items-center gap-2 text-body">
          {LEGAL_LINKS.map(([href, label], index) => (
            <span key={href} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden="true" className="text-ink-2">
                  ·
                </span>
              ) : null}
              <Link href={href} className="hit-44 text-link">
                {label}
              </Link>
            </span>
          ))}
        </nav>
      </footer>
    </div>
  );
}
