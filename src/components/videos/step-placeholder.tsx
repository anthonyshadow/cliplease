import { READING_COLUMN } from "@/components/layout/gutter";
import { Stepper } from "@/components/ui/stepper";
import {
  VIDEO_STEP_LABELS,
  VIDEO_STEPS,
  type VideoStep,
  videoStepHref,
} from "@/lib/videos/steps";
import { BackLink } from "./back-link";

/** Rights and Review until P13 builds them: the Stepper and the step's name, in the File step's column. */
export function StepPlaceholder({
  videoId,
  step,
}: {
  videoId: string;
  step: Exclude<VideoStep, "file">;
}) {
  const index = VIDEO_STEPS.indexOf(step);
  return (
    <div className={READING_COLUMN}>
      <BackLink href={videoStepHref(videoId, VIDEO_STEPS[index - 1])}>
        Back
      </BackLink>
      <Stepper steps={VIDEO_STEP_LABELS} current={index} />
      <h1 className="text-title-1 text-ink">{VIDEO_STEP_LABELS[index]}</h1>
    </div>
  );
}

/** A video past its draft until P14a builds its page: the title, back to Videos. */
export function VideoPlaceholder({ title }: { title: string }) {
  return (
    <div className={READING_COLUMN}>
      <BackLink href="/dashboard/videos">Videos</BackLink>
      <h1 className="text-title-1 text-ink">{title}</h1>
    </div>
  );
}
