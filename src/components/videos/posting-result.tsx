import { LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { PlatformBadge } from "@/components/platform/platform-badge";
import { StatusPill } from "@/components/ui/status-pill";
import type { PostingPlatform, SocialAccountStatus } from "@/lib/domain/values";
import {
  POSTINGS_COPY,
  type PostingResultCopy,
  sourceRowTitle,
} from "@/lib/postings/copy";
import type { OwnerPostingDTO } from "@/lib/postings/types";

// The posting card's pieces both modes draw: the frame, a row's spacing, the verified source's lead and a saved
// result. Here, in a module without "use client" and without hooks, so the server's read-only cards render them too.

/** A row inside a posting card: 16 px and a hairline between rows (the card's divide-y), none at the card's edges. */
export const POSTING_ROW =
  "flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0";

/**
 * A posting card (04 §9.33): `surface rounded-md p-4`, gap 12, titled by its PlatformBadge (Facebook, X, Snapchat and
 * Other with the Link icon; `otherLabel` names an Other site), then its rows. It is the column's width. `titleId`, when
 * given, names the section by its title.
 */
export function PostingCardFrame({
  platform,
  otherLabel = null,
  titleId,
  children,
}: {
  platform: PostingPlatform;
  otherLabel?: string | null;
  titleId?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-posting-card={platform}
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-3 rounded-md bg-surface p-4"
    >
      <h3 id={titleId} className="min-w-0 text-body font-semibold text-ink">
        <PlatformBadge platform={platform} otherLabel={otherLabel} />
      </h3>
      {children}
    </section>
  );
}

/**
 * A verified Library source row's lead (04 §9.33, 05 callout 22): "{verified_username} on {Platform}" (the name as
 * stored, 07 D43; none without one), then SourceVerifiedLine.
 */
export function SourceVerifiedLead({
  source,
}: {
  source: Pick<OwnerPostingDTO, "verifiedUsername" | "label" | "accountStatus">;
}) {
  return (
    <>
      {source.verifiedUsername === null ? null : (
        <p className="text-callout font-semibold text-ink wrap-anywhere">
          {sourceRowTitle(source.verifiedUsername, source.label)}
        </p>
      )}
      <SourceVerifiedLine accountStatus={source.accountStatus} />
    </>
  );
}

/**
 * A verified Library source row's line: the Verified pill and "· From your Library", plus "· no longer linked" once its
 * account is disconnected (07 D72, Q-70 a keeps it verified).
 */
function SourceVerifiedLine({
  accountStatus,
}: {
  accountStatus: SocialAccountStatus | null;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-footnote text-ink-2">
      <StatusPill dot="solid">{POSTINGS_COPY.verified}</StatusPill>{" "}
      <span>· {POSTINGS_COPY.fromLibrary}</span>
      {accountStatus === "disconnected" ? (
        <>
          {" "}
          <span>· {POSTINGS_COPY.noLongerLinked}</span>
        </>
      ) : null}
    </p>
  );
}

/**
 * A saved posting's result in place (04 §9.33 Link field states, §11.10): Verified (16 px ShieldCheck + the solid
 * pill, then "· on @demo.creator"), Not verified (the hollow pill + the reason), check failed (TriangleAlert in
 * awaiting-text + the line), each with its one action below (a `link` Button or Connect link, passed in). The text
 * wraps (a long channel title never widens the card, 07 D153). `focusable` lets the step move focus here after a check
 * when the result has no action.
 */
export function PostingResult({
  copy,
  action = null,
  focusable = false,
}: {
  copy: PostingResultCopy;
  action?: ReactNode;
  focusable?: boolean;
}) {
  if (copy.tone === "empty") return null;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <p
        data-posting-result={copy.tone}
        tabIndex={focusable ? -1 : undefined}
        className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xs text-footnote text-ink-2 wrap-anywhere"
      >
        <ResultLead copy={copy} />
      </p>
      {action}
    </div>
  );
}

function ResultLead({ copy }: { copy: PostingResultCopy }) {
  if (copy.tone === "verified") {
    // "Verified · on @demo.creator": the pill holds "Verified", the rest follows it (the line's text reads whole).
    const rest = copy.text.slice(POSTINGS_COPY.verified.length).trim();
    return (
      <>
        <ShieldCheck
          aria-hidden
          size={16}
          strokeWidth={2}
          className="shrink-0 text-ink"
        />
        <StatusPill dot="solid">{POSTINGS_COPY.verified}</StatusPill>
        {rest ? <> {rest}</> : null}
      </>
    );
  }
  if (copy.tone === "check_failed") {
    return (
      <>
        <TriangleAlert
          aria-hidden
          size={16}
          strokeWidth={2}
          className="shrink-0 text-awaiting-text"
        />
        <span className="min-w-0 text-ink">{copy.text}</span>
      </>
    );
  }
  return (
    <>
      <StatusPill dot="hollow">{POSTINGS_COPY.notVerified}</StatusPill>{" "}
      <span className="min-w-0">{copy.text}</span>
    </>
  );
}

/** "Checking the link…" (04 §9.33): while Continue or a check runs on the row, in place of its result. */
export function CheckingLine() {
  return (
    <p
      data-checking
      tabIndex={-1}
      className="flex items-center gap-1.5 rounded-xs text-footnote text-ink-2"
    >
      <LoaderCircle
        aria-hidden
        size={16}
        strokeWidth={2}
        className="shrink-0 animate-spin"
      />
      {POSTINGS_COPY.checking}
    </p>
  );
}
