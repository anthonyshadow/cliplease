// The license summary of {APP_NAME} Video License v1 (01 §4.7, research/license.md §3) and the token filler, apart from
// the license text so the license page's browser code loads only these (P15). It is not the license. Token values as
// license-v1.ts's header says; {territory_label} names the territory in a heading or list ("United States"),
// {territory} in a sentence ("the United States", owner answer Q-115 a). The license's version and title live here too,
// for the same reason.
import { APP_NAME } from "../app-name";

/** The terms_version a buyer accepts (the license page's form posts it). */
export const LICENSE_V1_VERSION = "v1";

export const LICENSE_V1_TITLE = "{app_name} Video License v1";

export type LicenseSummaryRow = {
  readonly label: string;
  readonly text: string;
  /** Shown only for that kind of license, when auto-renewal is on, or when the video has that flag. */
  readonly when?:
    | "standard"
    | "exclusive"
    | "auto_renew"
    | "contains_music"
    | "identifiable_people";
};
export type LicenseSummaryGroup = {
  readonly title: string;
  readonly rows: readonly LicenseSummaryRow[];
};

export type LicenseSummary = {
  readonly heading: string;
  readonly groups: readonly LicenseSummaryGroup[];
  readonly footer: string;
};

/** The license summary (license.md §3). It is not the license. */
export const LICENSE_V1_SUMMARY: LicenseSummary = {
  heading: "License summary · {use_label} · {term_label} · {territory_label}",
  groups: [
    {
      title: "You can",
      rows: [
        {
          label: "Use it",
          text: "{use_one_liner} in {territory}, {term_phrase}.",
        },
        {
          label: "Edit it",
          text: "Crop, trim, caption, translate, add your logo, mute or replace the audio. Keep what it shows and means.",
        },
        {
          label: "Brief your team",
          text: "Editors and agencies working for you may handle the file, only for your use.",
        },
      ],
    },
    {
      // The exclusive variant (07 D113, the Renewal row as amended by D142).
      title: "You get",
      rows: [
        {
          label: "Exclusivity",
          text: "{creator_handle} won't license this video to anyone else, for any use or place, {exclusive_phrase}.",
          when: "exclusive",
        },
        {
          label: "Renewal",
          text: "Renews {renewal_interval} for {renewal_total} unless you turn it off. A higher price needs your OK.",
          when: "auto_renew",
        },
      ],
    },
    {
      title: "You must",
      rows: [
        {
          label: "Credit",
          text: "{credit_line} in the caption or on screen (organic and TV).",
        },
        {
          label: "Stop at the end",
          text: "When the term ends, take it down and stop running it. (Perpetual: no end date.)",
        },
      ],
    },
    {
      title: "You can't",
      rows: [
        {
          label: "Pass it on",
          text: "No reselling, sublicensing, or use for clients or companies not named on the license.",
        },
        {
          label: "Misuse it",
          text: "No misleading or defamatory context, political ads, AI training, deepfakes or Content ID claims.",
        },
      ],
    },
    {
      title: "Not included",
      rows: [
        {
          label: "Exclusivity",
          text: "{creator_handle} can license this video to others.",
          when: "standard",
        },
        {
          label: "Music",
          text: "The music isn't licensed. Mute it, replace it, or license it yourself.",
          when: "contains_music",
        },
        {
          label: "People",
          text: "People in the video haven't signed releases. Get their consent for ads or endorsements.",
          when: "identifiable_people",
        },
      ],
    },
  ],
  footer:
    "This summary is not the license. The {app_name} Video License v1 is the legal text: /legal/license/v1",
};

const TOKEN = /\{([a-z_]+)\}/g;

/** The {token} names in `text`, in order of appearance. */
export function licenseV1Tokens(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((match) => match[1]);
}

/**
 * Replaces every {token} in `text`. Throws when a token has no value, so a page or a PDF can never print
 * "{licensee_name}". An empty string is a valid value (an absent music or people clause).
 */
export function fillLicenseV1(
  text: string,
  values: Readonly<Record<string, string | undefined>>,
): string {
  // Own properties only: a token such as {constructor} must not resolve through Object.prototype.
  const ownValue = (token: string) =>
    Object.hasOwn(values, token) ? values[token] : undefined;
  const missing = licenseV1Tokens(text).filter(
    (token) => ownValue(token) === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `License v1: no value for ${[...new Set(missing)].map((t) => `{${t}}`).join(", ")}`,
    );
  }
  return text.replace(TOKEN, (_, token: string) => ownValue(token) ?? "");
}

/** "ClipLease Video License v1": the title as pages, links and metadata show it. */
export const LICENSE_V1_DISPLAY_TITLE = fillLicenseV1(LICENSE_V1_TITLE, {
  app_name: APP_NAME,
});
