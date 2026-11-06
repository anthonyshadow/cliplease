import { LICENSE_PAGE_COPY } from "@/lib/licensing/license-page";
import type {
  LicenseTypeKey,
  LicenseTypeTile,
} from "@/lib/licensing/selection";
import { twoTone } from "./license-details";
import { OptionGroup, OptionTile } from "./option-group";

const COPY = LICENSE_PAGE_COPY;

/**
 * 04 §9.35 "License type. Who else can use it?": Standard and Exclusive as native radios with their deltas, a disabled
 * tile saying why with no delta. The radios post nothing, like Use and Term: LicenseDetails' hidden input does.
 * `termMoved`: the polite line when Exclusive moved the term (owner answer Q-168), empty at load so only a move speaks;
 * the PriceBar announces the total.
 */
export function LicenseTypeGroup({
  tiles,
  exclusive,
  delta,
  onChoose,
  error,
  termMoved,
}: {
  tiles: LicenseTypeTile[];
  exclusive: boolean;
  delta: (key: LicenseTypeKey) => string | null;
  onChoose: (exclusive: boolean) => void;
  error?: string;
  termMoved: string;
}) {
  return (
    <OptionGroup legend={twoTone(COPY.headings.licenseType)} error={error}>
      <div className="flex flex-col gap-3">
        {tiles.map((tile) => {
          const isExclusive = tile.key === "exclusive";
          return (
            <OptionTile
              key={tile.key}
              name="exclusive"
              value={String(isExclusive)}
              title={COPY.licenseType[tile.key].title}
              description={COPY.licenseType[tile.key].description}
              checked={exclusive === isExclusive}
              disabled={!tile.enabled}
              onChange={() => onChoose(isExclusive)}
              reason={
                tile.disabledReason === "availability"
                  ? COPY.exclusiveUnavailable
                  : undefined
              }
              delta={tile.enabled ? delta(tile.key) : null}
            />
          );
        })}
      </div>
      <p data-term-moved aria-live="polite" className="sr-only">
        {termMoved}
      </p>
    </OptionGroup>
  );
}
