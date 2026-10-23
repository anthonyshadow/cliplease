import {
  connectErrorBanner,
  connectedProvider,
} from "@/components/connections/connect-messages";
import { StripConnectParams } from "@/components/connections/strip-connect-params";
import { READING_COLUMN, TWO_COLUMN } from "@/components/layout/gutter";
import { Banner } from "@/components/ui/banner";
import { Stepper } from "@/components/ui/stepper";
import { POSTINGS_COPY } from "@/lib/postings/copy";
import type { PostingsStepMode } from "@/lib/postings/form";
import { cn } from "@/lib/utils";
import { provenanceLine } from "@/lib/videos/source-page";
import {
  VIDEO_STEP_LABELS,
  VIDEO_STEPS,
  videoHref,
  videoStepHref,
} from "@/lib/videos/steps";
import type { Actor } from "@/server/auth/actor";
import { listPostingAccountStates } from "@/server/library/queries";
import { listVideoPostings } from "@/server/postings/queries";
import { enabledPlatforms, mockEnabled } from "@/server/social/registry";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { BackLink } from "./back-link";
import { postingAccounts } from "./posting-picker-state";
import { PostingsForm } from "./postings-form";
import { PostingsReadOnly } from "./postings-read-only";
import { VideoSummary } from "./video-summary";

type SearchParam = string | string[] | undefined;

/**
 * Step 2 · Where posted, `/dashboard/videos/<id>?step=postings` (S17b; 04 §9.33; 05 §6.5; 07 D65–D70, D146, D156; owner
 * answers Q-73–Q-81), for a Library video and a plain upload alike.
 *
 * Editable (`draft`, `unpublished`): "‹ Back" (a draft's File step at every tier, Q-80 a; an unpublished video's page)
 * with no visible heading (the title is the sr-only h1), a draft's Stepper ("Step 2 of 4 · Where posted" below md),
 * then the video summary and the step. Below md one centered max-w-reading column without the summary (05's Mobile
 * frame); on md the summary above the step in that column; from lg two columns in max-w-app (TWO_COLUMN), Back and the
 * Stepper over both, the summary left, the step right. The step is the client PostingsForm, given the saved postings,
 * whether Demo links count (mock enabled), and per provider only whether it is enabled and which accounts are connected
 * or all need a reconnect (listPostingAccountStates, read alongside the postings: never avatars, names or tokens). A
 * connect that came back here shows its ?error= line in a Banner, and ?connected= checks that platform's links again
 * (Q-74 a); StripConnectParams drops both from the address (it renders first, so its timeout runs before the form's).
 *
 * Read-only (`published`, 05 frame 35): Back to the video's page, the title for readers, "Where was it posted?" and
 * PostingsReadOnly; the accounts aren't read.
 */
export async function PostingsStep({
  actor,
  video,
  mode,
  connected,
  connectError,
}: {
  actor: Actor;
  video: CreatorVideoDTO;
  mode: PostingsStepMode;
  /** The page's ?connected= and ?error= (07 D37). */
  connected: SearchParam;
  connectError: SearchParam;
}) {
  if (mode === "read_only") {
    const postings = await listVideoPostings(actor, video.id);
    return (
      <div className={READING_COLUMN}>
        <BackLink href={videoHref(video.id)}>Back</BackLink>
        <h1 className="sr-only">{video.title}</h1>
        <h2 className="text-title-2 text-ink">{POSTINGS_COPY.title}</h2>
        <PostingsReadOnly postings={postings} />
      </div>
    );
  }
  const [postings, accountStates] = await Promise.all([
    listVideoPostings(actor, video.id),
    listPostingAccountStates(actor),
  ]);
  const draft = video.status === "draft";
  const post = video.sourcePost;
  const errorBanner = connectErrorBanner(connectError);
  return (
    <div className={TWO_COLUMN.page}>
      <StripConnectParams />
      <div className={cn(TWO_COLUMN.span, "flex flex-col gap-6")}>
        <BackLink
          href={draft ? videoStepHref(video.id, "file") : videoHref(video.id)}
        >
          Back
        </BackLink>
        <h1 className="sr-only">{video.title}</h1>
        {draft ? (
          <Stepper
            steps={VIDEO_STEP_LABELS}
            current={VIDEO_STEPS.indexOf("postings")}
          />
        ) : null}
      </div>
      <VideoSummary
        className={TWO_COLUMN.side}
        video={video}
        provenance={
          post ? provenanceLine({ ...post, name: post.verifiedUsername }) : null
        }
      />
      <div
        data-postings-step
        className={cn(TWO_COLUMN.main, "flex flex-col gap-6")}
      >
        {errorBanner ? (
          <Banner tone={errorBanner.tone}>{errorBanner.message}</Banner>
        ) : null}
        <PostingsForm
          video={{
            id: video.id,
            durationMs: video.durationMs,
            posterSrc: video.posterSrc,
            width: video.width,
            height: video.height,
            sameVideoConfirmed: video.sameVideoConfirmed,
          }}
          postings={postings}
          notPostedSaved={
            video.source === "upload" &&
            video.postingsConfirmedAt !== null &&
            postings.length === 0
          }
          allowMock={mockEnabled()}
          accounts={postingAccounts(enabledPlatforms(), accountStates)}
          connected={connectedProvider(connected)}
        />
      </div>
    </div>
  );
}
