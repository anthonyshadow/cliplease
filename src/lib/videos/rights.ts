// The Rights step (01 J5.13–J5.15; 05 §6.5 callouts 36–41; research/license.md §7): its words and the music rule. Pure.
import type { UseKey } from "../domain/values";
import { joinList } from "../format";
import { rateOptionLabel } from "../licensing/options";

/** Music Yes turns these uses off for the video (07 D39, D82); P19d lets the creator turn either back on. */
export const MUSIC_DISABLED_USES = [
  "paid_social",
  "broadcast",
] as const satisfies readonly UseKey[];

/** 01 J5.13's attestation and questions, 05's footnotes; the rest proposed copy (owner answers Q-96, Q-98). */
export const RIGHTS_COPY = {
  ownsRights:
    "I filmed this video myself, or I own all the rights to it, and I have the right to license it.",
  notReupload:
    "It isn't a re-upload of someone else's video, and I haven't given anyone exclusive rights to it.",
  musicQuestion: "Does the video have music or sound you didn't create?",
  musicHelp: "Including songs or sounds added in TikTok, Instagram or YouTube.",
  /** 05's "Paid social ads and TV / broadcast will be off for this video.", named from the uses it turns off. */
  musicFootnote: `${joinList(MUSIC_DISABLED_USES.map(rateOptionLabel), "and")} will be off for this video.`,
  peopleQuestion:
    "Can anyone other than you be recognized in it, by face, voice or name?",
  peopleNotice:
    "Buyers will see: People in this video haven't signed releases. For ads, or anything that suggests they endorse you, get their permission first.",
  answerAll: "Answer all four to continue.",
  yes: "Yes",
  no: "No",
} as const;

/** Why the answers can't change (02 §6.1; owner answer Q-96 a adds a waiting request to a sold license). */
export type RightsLock = "license" | "request";

export const RIGHTS_LOCK_COPY = {
  license: "You can't change these answers after a license is sold.",
  request: "You can't change these answers while a request is waiting.",
} as const satisfies Record<RightsLock, string>;

/** Why the answers can't change: a license sold wins over a request waiting; null when neither (lockFlags' columns). */
export const rightsLockOf = (row: {
  licensed: boolean;
  openRequest: boolean;
}): RightsLock | null =>
  row.licensed ? "license" : row.openRequest ? "request" : null;
