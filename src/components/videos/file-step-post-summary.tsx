import { TWO_COLUMN } from "@/components/layout/gutter";

/**
 * The Library File step's post summary (05 §6.5 callout 9; owner answers Q-66 a, Q-81 a): the provenance line only. The
 * post's picture beside the cover moved to Where posted with the same-video tick (07 D69), and the cover picker stays
 * whole in the step. The left column from lg, above the step below it (07 D146).
 */
export function PostSummary({
  provenance,
}: {
  /** The provenance line, worded by the server FileStep (FileStepLibrary). */
  provenance: string;
}) {
  return (
    <div data-post-summary className={TWO_COLUMN.side}>
      <p className="text-callout text-ink-2">{provenance}</p>
    </div>
  );
}
