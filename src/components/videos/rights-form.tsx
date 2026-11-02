"use client";

import { UsersRound } from "lucide-react";
import { useState } from "react";
import { attestRights } from "@/app/(dashboard)/dashboard/videos/[id]/review-actions";
import { OptionGroup, OptionTile } from "@/components/license/option-group";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { NativeCheckbox } from "@/components/ui/checkbox";
import { Notice } from "@/components/ui/notice";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { useFormAction } from "@/components/ui/use-form-action";
import {
  type MusicUseKey,
  RIGHTS_COPY,
  RIGHTS_LOCK_COPY,
  type RightsLock,
} from "@/lib/videos/rights";
import type { MusicSwitch } from "@/lib/videos/video-price";
import { MusicUseSwitches } from "./video-price-editor";

type Answer = "yes" | "no" | null;

const answerOf = (value: boolean | null): Answer =>
  value === null ? null : value ? "yes" : "no";

const HELPER_ID = "rights-helper";

/** One question's Yes / No tiles, side by side (04 §9.3; owner answer Q-97 a). */
function YesNo({
  legend,
  help,
  name,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  help?: string;
  name: string;
  value: Answer;
  onChange: (answer: "yes" | "no") => void;
  disabled: boolean;
}) {
  return (
    <OptionGroup legend={legend} help={help} disabled={disabled}>
      <div className="grid grid-cols-2 gap-3">
        {(["yes", "no"] as const).map((answer) => (
          <OptionTile
            key={answer}
            name={name}
            value={answer}
            title={RIGHTS_COPY[answer]}
            checked={value === answer}
            onChange={() => onChange(answer)}
          />
        ))}
      </div>
    </OptionGroup>
  );
}

/**
 * Step 3 · Rights (01 J5.13–J5.15; 05 §6.5 callouts 36–41): the two attestations, unchecked on every visit so each
 * Continue is a fresh one (owner answer Q-99 a), and the two questions with no default, prefilled from saved answers.
 * Music Yes adds the music Switches (07 D82; owner answer Q-158: none for a use off on the rate card), prefilled from
 * the stored uses and posted with Continue, and 05's footnote while none is on; people Yes, what buyers will see.
 * Continue stays disabled until all four are answered. With a license sold or a request waiting (`lock`, owner answer
 * Q-96 a) the answers show read-only with the lock line, and no Switches.
 */
export function RightsForm({
  videoId,
  containsMusic,
  identifiablePeople,
  lock,
  musicUses,
}: {
  videoId: string;
  containsMusic: boolean | null;
  identifiablePeople: boolean | null;
  lock: RightsLock | null;
  /** musicSwitches(options, containsMusic): the Switches music Yes shows, each as stored. */
  musicUses: readonly MusicSwitch[];
}) {
  const { state, pending, resultKey, formProps } = useFormAction(
    attestRights,
    null,
  );
  const [ownsRights, setOwnsRights] = useState(false);
  const [notReupload, setNotReupload] = useState(false);
  const [music, setMusic] = useState<Answer>(answerOf(containsMusic));
  const [people, setPeople] = useState<Answer>(answerOf(identifiablePeople));
  const [allowed, setAllowed] = useState<Partial<Record<MusicUseKey, boolean>>>(
    () => Object.fromEntries(musicUses.map((s) => [s.key, s.on])),
  );
  const switches = musicUses.map((s) => ({
    key: s.key,
    on: allowed[s.key] ?? false,
  }));
  const locked = lock !== null;
  const complete =
    ownsRights && notReupload && music !== null && people !== null;

  return (
    <form {...formProps} className="flex flex-col gap-6">
      <input type="hidden" name="videoId" value={videoId} />
      <div className="flex flex-col">
        <NativeCheckbox
          name="ownsRights"
          label={RIGHTS_COPY.ownsRights}
          checked={ownsRights}
          onChange={(event) => setOwnsRights(event.target.checked)}
          disabled={locked}
        />
        <NativeCheckbox
          name="notReupload"
          label={RIGHTS_COPY.notReupload}
          checked={notReupload}
          onChange={(event) => setNotReupload(event.target.checked)}
          disabled={locked}
        />
      </div>
      <div className="flex flex-col gap-3">
        <YesNo
          legend={RIGHTS_COPY.musicQuestion}
          help={RIGHTS_COPY.musicHelp}
          name="containsMusic"
          value={music}
          onChange={setMusic}
          disabled={locked}
        />
        {music === "yes" ? (
          <>
            {switches.some((s) => s.on) ? null : (
              <p className="text-footnote text-ink-2">
                {RIGHTS_COPY.musicFootnote}
              </p>
            )}
            {locked ? null : (
              <MusicUseSwitches
                mode="form"
                switches={switches}
                onCheckedChange={(key, on) =>
                  setAllowed((prev) => ({ ...prev, [key]: on }))
                }
              />
            )}
          </>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        <YesNo
          legend={RIGHTS_COPY.peopleQuestion}
          name="identifiablePeople"
          value={people}
          onChange={setPeople}
          disabled={locked}
        />
        {people === "yes" ? (
          <Notice icon={UsersRound}>{RIGHTS_COPY.peopleNotice}</Notice>
        ) : null}
      </div>
      <p className="text-footnote text-ink-2">
        {RIGHTS_LOCK_COPY[lock ?? "license"]}
      </p>
      {state !== null && !state.ok ? (
        <Banner key={resultKey} tone="error">
          {state.error.message}
        </Banner>
      ) : null}
      {locked ? null : (
        <div className="flex flex-col gap-2">
          <Button
            type="submit"
            disabled={!complete}
            loading={pending}
            loadingLabel="Continuing…"
            aria-describedby={complete ? undefined : HELPER_ID}
            className={PRIMARY_WIDTH}
          >
            Continue
          </Button>
          {complete ? null : (
            <p id={HELPER_ID} className="text-footnote text-ink-2">
              {RIGHTS_COPY.answerAll}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
