"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import {
  setVideoBasePrice,
  setVideoUseEnabled,
} from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { OptionGroup, OptionTile } from "@/components/license/option-group";
import { RefusalAlert, useRefusal } from "@/components/ui/refusal-alert";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { formatMoney } from "@/lib/format";
import { CURRENCY_DISPLAY } from "@/lib/money/currency";
import { REQUESTS_SETTINGS_COPY } from "@/lib/payouts";
import {
  parseWholeDollars,
  wholeDollarsFieldValue,
} from "@/lib/pricing/multiplier";
import { basePriceCentsSchema } from "@/lib/validation/pricing";
import { MUSIC_USE_FIELD, type MusicUseKey } from "@/lib/videos/rights";
import { VIDEO_PAGE_COPY } from "@/lib/videos/video-page";
import {
  type MusicSwitch,
  musicSwitches,
  VIDEO_PRICE_COPY,
} from "@/lib/videos/video-price";
import type { EffectiveOptions, RateCardDTO } from "@/server/pricing/rate-card";
import { ChoiceDraftForm, useChoiceDraft } from "./choice-draft";
import { usePriceDraft } from "./price-draft";

type Choice = "rate_card" | "video";

/** A base price as the editor shows it: the field's text counts only while "Set a base price for this video" is chosen. */
type Price = { choice: Choice; text: string };

const samePrice = (a: Price, b: Price) =>
  a.choice === b.choice && (a.choice === "rate_card" || a.text === b.text);

/**
 * 04 §9.29 VideoPriceEditor, the Prices of Review and the video page (05 §6.5 callout 47, §6.7 callouts 8 and 11; 07
 * D82): "Use my rate card (CA$150)" or "Set a base price for this video", whose field ("New requests only.") shows while
 * it is chosen. A choice or an amount is a draft (owner answer Q-161): Save and Cancel show while it differs from the
 * stored price, and only Save calls setVideoBasePrice, with the field's whole dollars or null for the rate card (the
 * server checks the bounds again). Enter saves, Escape cancels; closing or reloading the tab asks first. The draft prices
 * the preview under the editor (PriceDraftProvider; owner answer Q-162) with the last amount the field would accept, and
 * stays until the saved price comes back with the page's refresh. A refusal goes under the field (under the choices for
 * the rate card) and takes the focus; once Save and Cancel go away, the checked choice does. Music Yes adds the music
 * Switches.
 */
export function VideoPriceEditor({
  videoId,
  legend,
  options,
  rateCard,
  containsMusic,
}: {
  videoId: string;
  /** The radio group's screen-reader name: REVIEW_COPY.prices or VIDEO_PAGE_COPY.prices. */
  legend: string;
  options: EffectiveOptions;
  rateCard: RateCardDTO;
  containsMusic: boolean | null;
}) {
  const { currency } = options;
  const switches = containsMusic === true ? musicSwitches(options, true) : [];
  const draft = useChoiceDraft({
    stored: {
      choice: options.basePriceSource,
      text: wholeDollarsFieldValue(options.basePriceCents),
    },
    storedValue: options.basePriceCents,
    fieldChoice: "video",
    same: samePrice,
    parse: (value) =>
      basePriceCentsSchema(currency).safeParse(
        parseWholeDollars(value) ?? Number.NaN,
      ),
    toText: wholeDollarsFieldValue,
    radioName: "basePrice",
    // A Switch going away (a refusal's refresh found no music) drops the focus too.
    refocusKey: switches.map((s) => s.key).join(","),
    submit: (_, basePriceCents) =>
      setVideoBasePrice({ videoId, basePriceCents }),
    savedToast: VIDEO_PAGE_COPY.saved,
  });
  const { setBaseCents } = usePriceDraft();

  const draftCents = !draft.dirty
    ? null
    : draft.choice === "rate_card"
      ? rateCard.basePriceCents
      : draft.lastValid;
  useEffect(() => {
    setBaseCents(draftCents);
  }, [draftCents, setBaseCents]);

  const base = formatMoney(rateCard.basePriceCents, currency, {
    wholeDollars: true,
  });
  return (
    <div
      data-video-price-editor
      className="flex min-w-0 flex-col gap-4"
      {...draft.refocus}
    >
      <OptionGroup
        legend={legend}
        hideLegend
        error={draft.showField ? undefined : draft.refusal?.message}
      >
        <div className="grid grid-cols-1 gap-3">
          <OptionTile
            name="basePrice"
            value="rate_card"
            title={
              <span className="tabular-nums">
                {VIDEO_PRICE_COPY.useRateCard(base)}
              </span>
            }
            checked={draft.choice === "rate_card"}
            onChange={() => draft.choose("rate_card")}
            disabled={draft.saving}
          />
          <OptionTile
            name="basePrice"
            value="video"
            title={VIDEO_PRICE_COPY.setOwn}
            checked={draft.choice === "video"}
            onChange={() => draft.choose("video")}
            disabled={draft.saving}
          />
        </div>
      </OptionGroup>
      <ChoiceDraftForm
        draft={draft}
        label={VIDEO_PRICE_COPY.field}
        prefix={CURRENCY_DISPLAY[currency].prefix}
        helper={REQUESTS_SETTINGS_COPY.newRequestsOnly}
      />
      <MusicUseSwitches mode="live" videoId={videoId} switches={switches} />
    </div>
  );
}

/**
 * The music Switches (04 §9.29; 05 §6.5 callout 38, §6.7 callout 11; 07 D82): "Allow Paid social ads anyway" and "Allow
 * TV / broadcast anyway", then "Buyers must mute or replace the music." once, describing each; nothing without a Switch.
 * `live` (Review, the video page): each saves on toggle. `form` (the Rights step): each posts "on" or "off" through its
 * hidden field (MUSIC_USE_FIELD) with the step's Continue.
 */
export function MusicUseSwitches(
  props:
    | { mode: "live"; videoId: string; switches: readonly MusicSwitch[] }
    | {
        mode: "form";
        switches: readonly MusicSwitch[];
        onCheckedChange: (key: MusicUseKey, on: boolean) => void;
      },
) {
  const helperId = useId();
  if (props.switches.length === 0) return null;
  return (
    <div data-music-switches className="flex flex-col gap-1">
      {props.switches.map((s) =>
        props.mode === "live" ? (
          <LiveMusicSwitch
            key={s.key}
            videoId={props.videoId}
            useKey={s.key}
            stored={s.on}
            describedBy={helperId}
          />
        ) : (
          <Fragment key={s.key}>
            <Switch
              label={VIDEO_PRICE_COPY.allowAnyway(s.key)}
              checked={s.on}
              onCheckedChange={(on) => props.onCheckedChange(s.key, on)}
              aria-describedby={helperId}
            />
            <input
              type="hidden"
              name={MUSIC_USE_FIELD[s.key]}
              value={s.on ? "on" : "off"}
            />
          </Fragment>
        ),
      )}
      <p id={helperId} className="text-footnote text-ink-2">
        {VIDEO_PRICE_COPY.musicHelper}
      </p>
    </div>
  );
}

/**
 * One live music Switch (05 §6.7 Interaction): on or off at once, locked (aria-disabled) while setVideoUseEnabled runs,
 * then "Saved."; a refusal turns it back, says why under it (announced: the focus is already on the Switch) and keeps the
 * focus on it. It follows `stored` only when that changes, never because a save finished: the saved value stays until
 * the page's refresh brings it.
 */
function LiveMusicSwitch({
  videoId,
  useKey,
  stored,
  describedBy,
}: {
  videoId: string;
  useKey: MusicUseKey;
  stored: boolean;
  describedBy: string;
}) {
  const [on, setOn] = useState(stored);
  const [seen, setSeen] = useState(stored);
  // Numbered, so a second refusal is announced again.
  const [refusal, refuse, clearRefusal] = useRefusal();
  const [pending, run] = usePendingAction();
  const ref = useRef<HTMLButtonElement>(null);
  // A refresh that lands mid-save applies once the save is over.
  if (stored !== seen && !pending) {
    setSeen(stored);
    setOn(stored);
  }

  async function toggle(next: boolean) {
    const was = on;
    setOn(next);
    clearRefusal();
    const result = await run(() =>
      setVideoUseEnabled({ videoId, useKey, enabled: next }),
    );
    if (result === null) return;
    if (result.ok) {
      toast(VIDEO_PAGE_COPY.saved);
      return;
    }
    setOn(was);
    refuse(result.error.message);
    ref.current?.focus();
  }

  return (
    <>
      <Switch
        ref={ref}
        label={VIDEO_PRICE_COPY.allowAnyway(useKey)}
        checked={on}
        onCheckedChange={toggle}
        aria-disabled={pending || undefined}
        aria-describedby={describedBy}
        error={refusal?.message}
      />
      <RefusalAlert refusal={refusal} />
    </>
  );
}
