import { Info, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  BADGE_COPY,
  type BadgeInput,
  badgeExplainer,
  badgeText,
} from "@/lib/videos/ownership";

/**
 * 04 §9.19: who controls the video, read from its primary verified posting (07 D43, D70, D89), or from a linked account
 * before anything is saved (the Source page's preview). lg: a 20 px `ShieldCheck`, line 1 `callout` semibold, line 2
 * `footnote` `ink-2`, then "What does this mean?" opening the explainer Sheet (a bottom sheet below md, a dialog from
 * md, 07 D149). sm (cards, rows): a 16 px `ShieldCheck` and one `footnote` line, no link. Self-attested is weaker on
 * purpose: `UserRound` and `ink-2` throughout, its link at lg only too (05 §6.8 draws the sm cards without one). The icon
 * never stands alone, and the badge never sits over a thumbnail or poster.
 */
export function VerifiedOwnerBadge(props: BadgeInput) {
  const { line1, line2, line3 } = badgeText(props);
  const lg = props.size === "lg";
  const verified = props.ownership === "verified_owner";
  const Icon = verified ? ShieldCheck : UserRound;
  return (
    <div className="flex items-start gap-2">
      <Icon
        aria-hidden
        size={lg ? 20 : 16}
        strokeWidth={lg ? undefined : 2}
        className={cn(
          "shrink-0",
          verified ? "text-ink" : "text-ink-2",
          // The 16 px icon centered on the 18 px footnote line.
          !lg && "mt-px",
        )}
      />
      <div className="flex min-w-0 flex-col">
        <p
          className={cn(
            lg ? "text-callout" : "text-footnote",
            verified ? "text-ink" : "text-ink-2",
            verified && lg && "font-semibold",
          )}
        >
          {line1}
        </p>
        {line2 ? <p className="text-footnote text-ink-2">{line2}</p> : null}
        {line3 ? <p className="text-footnote text-ink-2">{line3}</p> : null}
        {lg ? <BadgeExplainer paragraphs={badgeExplainer(props)} /> : null}
      </div>
    </div>
  );
}

/** "What does this mean?" with its 16 px `Info`, and the Sheet titled "What “Verified” means." (04 §11.2). */
function BadgeExplainer({ paragraphs }: { paragraphs: string[] }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="link" size="sm" className="self-start">
          <Info aria-hidden size={16} strokeWidth={2} className="shrink-0" />
          {BADGE_COPY.explainerLink}
        </Button>
      </SheetTrigger>
      <SheetContent title={BADGE_COPY.sheetTitle}>
        <div className="flex flex-col gap-3">
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
