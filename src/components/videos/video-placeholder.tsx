import { READING_COLUMN } from "@/components/layout/gutter";
import { BackLink } from "./back-link";

/** A video past its draft until P14a builds its page: the title, back to Videos. */
export function VideoPlaceholder({ title }: { title: string }) {
  return (
    <div className={READING_COLUMN}>
      <BackLink href="/dashboard/videos">Videos</BackLink>
      <h1 className="text-title-1 text-ink">{title}</h1>
    </div>
  );
}
