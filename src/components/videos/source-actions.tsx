"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { createVideoFromPost } from "@/app/(dashboard)/dashboard/videos/new/actions";
import { ConnectLink } from "@/components/connections/connect-link";
import { connectStartHref } from "@/components/connections/connect-messages";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { useFormAction } from "@/components/ui/use-form-action";
import { useRefocusOnSwap } from "@/components/ui/use-refocus-on-swap";
import type { SocialProviderId } from "@/lib/domain/values";
import {
  SOURCE_PAGE_COPY,
  type SourceActionsView,
  type SourcePageState,
  sourceActionsView,
} from "@/lib/videos/source-page";

// Where focus goes when the pressed control is gone (an error that drops the primary), in order of preference.
const FOCUS_ORDER = [
  '[data-variant="primary"]',
  '[data-variant="secondary"]',
  "[data-focus-row]",
];

const swapKey = (view: SourceActionsView) =>
  [
    view.preview?.kind,
    view.notPublic !== null,
    view.banner?.message,
    view.primary?.kind,
  ].join("|");

/**
 * The Source page's bottom (05 §6.5 callouts 6–7 and States; 07 D39): "Buyers will see:" with `badge` (rendered by the
 * page from the linked account), and Make licensable, a form post of createVideoFromPost that reads "Verifying…" while
 * the live check runs. The post's state and the press's refusal pick what shows (sourceActionsView); each refusal is
 * announced once, and focus that was on a primary the refusal removed moves to what replaced it.
 */
export function SourceActions({
  postId,
  platform,
  state,
  badge,
}: {
  postId: string;
  platform: SocialProviderId;
  state: SourcePageState;
  /** The VerifiedOwnerBadge preview, or null when the account gives no name to show. */
  badge: ReactNode;
}) {
  const {
    state: result,
    pending,
    resultKey,
    formProps,
  } = useFormAction(createVideoFromPost, null);
  const view = sourceActionsView({
    state,
    refusal: result?.error.code ?? null,
    platform,
    postId,
  });
  const refocus = useRefocusOnSwap<HTMLDivElement>(swapKey(view), FOCUS_ORDER);
  const { preview, notPublic, banner, primary } = view;

  return (
    <div {...refocus} className="flex flex-col gap-6">
      {preview?.kind === "badge" && badge ? (
        <div className="flex flex-col gap-2">
          <p className="text-footnote text-ink-2">
            {SOURCE_PAGE_COPY.buyersWillSee}
          </p>
          {badge}
        </div>
      ) : null}
      {preview?.kind === "reconnect" ? (
        <p className="flex items-start gap-2 text-callout text-ink">
          <TriangleAlert
            aria-hidden
            size={20}
            className="shrink-0 text-awaiting-text"
          />
          {preview.line}
        </p>
      ) : null}
      {notPublic ? (
        <div className="flex flex-col gap-3">
          <p className="text-callout text-ink">{notPublic.line}</p>
          <Button asChild variant="secondary" className={PRIMARY_WIDTH}>
            <Link href={notPublic.upload.href}>{notPublic.upload.label}</Link>
          </Button>
        </div>
      ) : null}
      {banner ? (
        <div tabIndex={-1} data-focus-row className="rounded-md">
          <Banner
            tone={banner.tone}
            live={!banner.fromAction}
            action={
              banner.link ? (
                <Button asChild variant="link" size="sm">
                  <Link href={banner.link.href}>{banner.link.label}</Link>
                </Button>
              ) : undefined
            }
          >
            {banner.message}
          </Banner>
        </div>
      ) : null}
      {primary?.kind === "make_licensable" ? (
        <form {...formProps} className="flex flex-col">
          <input type="hidden" name="socialPostId" value={postId} />
          <Button
            type="submit"
            loading={pending}
            loadingLabel={SOURCE_PAGE_COPY.verifying}
            className={PRIMARY_WIDTH}
          >
            {SOURCE_PAGE_COPY.makeLicensable}
          </Button>
        </form>
      ) : null}
      {primary?.kind === "reconnect" ? (
        // P08's Connect link: a full navigation to the start route, "Connecting…" once pressed (owner answer Q-19).
        <ConnectLink
          href={connectStartHref(platform, primary.returnTo)}
          label={primary.label}
          variant="primary"
          size="lg"
          className={PRIMARY_WIDTH}
        />
      ) : null}
      {primary?.kind === "open_video" ? (
        <Button asChild className={PRIMARY_WIDTH}>
          <Link href={primary.href}>{primary.label}</Link>
        </Button>
      ) : null}
      {result !== null ? (
        <p key={resultKey} role="alert" className="sr-only">
          {result.error.message}
        </p>
      ) : null}
    </div>
  );
}
