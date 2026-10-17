// {APP_NAME} Video License v1 (research/license.md §2–§4, 07 D113, D142). DRAFT: a lawyer reviews it before real money
// (OQ-28). Pure: no React, no env. Frozen once the first license is issued; any change after that is a new version (v2).
//
// Token values (P20 fills them per license; /legal/license/v1 uses LICENSE_V1_NEUTRAL_VALUES):
// - templates never add "@" or quotes: {creator_handle} carries its "@" ("@mayar", like 07 D43's verified username),
//   {video_title} and {credit_line} carry their quotes;
// - amounts are formatMoney(cents, currency) results, and {currency_label} is currencyLabel(currency) (07 D94, D98);
// - {music_clause} / {people_clause} are LICENSE_V1_MUSIC_CLAUSE / LICENSE_V1_PEOPLE_CLAUSE, or "" when the flag is false.
import {
  APP_NAME,
  GOVERNING_LAW,
  LEGAL_ENTITY_NAME,
  SUPPORT_EMAIL,
  VENUE,
} from "../app-name";
import { formatPostDate } from "../format";
import type { LegalSection } from "./types";

export const LICENSE_V1_VERSION = "v1";
export const LICENSE_V1_UPDATED = "2026-10-15";
/** "15 Oct 2026": the UTC day, so the date never shifts with the machine's time zone. */
export const LICENSE_V1_UPDATED_LABEL = formatPostDate(
  new Date(`${LICENSE_V1_UPDATED}T00:00:00Z`),
);

export const LICENSE_V1_TITLE = "{app_name} Video License v1";

export const LICENSE_V1_MUSIC_CLAUSE =
  "The Video contains music the Licensor does not own. This license does not cover the music. The Licensee must mute or replace it, or license it separately.";
export const LICENSE_V1_PEOPLE_CLAUSE =
  "People other than the Licensor can be identified in the Video. The Licensor has not provided releases from them. The Licensee must get any consent the law requires, especially for advertising or anything that suggests endorsement. For a minor, that means consent from a parent or guardian.";

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
          text: "{use_one_liner} in {territory_label}, {term_phrase}.",
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

/**
 * Header rows (license.md §4.2 with 07 D98 and D113). Per license only: PDF page 1 and /l (P20). The QR is [H6].
 * {rights_label} is "Non-exclusive" or "Exclusive until {end_date}", from snapshot.exclusive.
 */
export const LICENSE_V1_HEADER = [
  ["License code", "{license_code}"],
  ["Issued", "{issued_at} · {rights_label}"],
  [
    "Licensor",
    "{creator_display_name} ({creator_handle} on {app_name}) — {ownership_label}",
  ],
  ["Licensee", "{licensee_name}"],
  ["Video", "{video_title} — {source_url}"],
  ["Use", "{use_label}"],
  ["Term", "{term_label}: {start_date} to {end_date}"],
  ["Territory", "{territory_label}{territory_detail}"],
  [
    "Paid",
    "License fee {license_fee} + service fee {service_fee} = {total_paid}. Amounts in {currency_label}.",
  ],
  ["Excluded", "{music_clause} {people_clause}"],
  [
    "Official record",
    "{verify_url}. If this document and that page differ, the page is correct.",
  ],
] as const;

/** Sections 1–20 (license.md §4.3, DRAFT) and the 07 D113 / D142 sections 21–22. */
export const LICENSE_V1_SECTIONS: readonly LegalSection[] = [
  {
    id: "agreement",
    title: "1. Agreement",
    blocks: [
      // §1's renewal sentence: owner choice Q3 (a), 2026-10-17; OQ-28 lawyer list.
      'This license is between {creator_display_name} ("Licensor") and {licensee_name} ("Licensee"). It was accepted at checkout on {accepted_at}. It took effect when payment was captured on {start_date}, after the Licensor approved. A renewal term takes effect on its start date; it needs no new approval.',
    ],
  },
  {
    id: "definitions",
    title: "2. Definitions",
    blocks: [
      '"Video" means the audiovisual work {video_title} ({source_url}) as delivered in the "Licensed File", including its still frames. "Licensed Use", "Term" and "Territory" mean the options shown on the license, as defined in Schedule A.',
    ],
  },
  {
    id: "grant",
    title: "3. Grant",
    blocks: [
      // "(or, when the license summary says Exclusive, an exclusive)": owner choice Q3 (a), wording from 01 §4.6.
      "In return for payment, the Licensor grants the Licensee a non-exclusive (or, when the license summary says Exclusive, an exclusive), non-transferable, non-sublicensable license to copy, edit (section 8), publicly display and distribute the Video for the Licensed Use, in the Territory, during the Term. Any right not expressly granted stays with the Licensor.",
    ],
  },
  {
    id: "licensed-use",
    title: "4. Licensed Use",
    blocks: [
      'The Licensed Use is {use_label}: {use_definition}. Everything listed as "not included" for that use in Schedule A is excluded.',
    ],
  },
  {
    id: "term",
    title: "5. Term",
    blocks: [
      "The Term runs from {start_date} to {end_date} ({term_label}). Within 7 days after it ends, the Licensee removes posts, stops ads, makes no new broadcasts or streams, and deletes working copies. One archival copy may be kept for legal records only. For Perpetual there is no end date, but section 14 still applies.",
    ],
  },
  {
    id: "territory",
    title: "6. Territory",
    blocks: [
      "{territory_label}{territory_detail}. Territory is where the use is aimed (Schedule A). People outside it seeing a lawful use by chance is not a breach.",
    ],
  },
  {
    id: "ownership",
    // Title and the exception: owner choice Q3 (a), 2026-10-17; OQ-28 lawyer list.
    title: "7. Ownership and exclusivity",
    blocks: [
      'The Licensor keeps all rights, including copyright. The Licensor may keep posting the Video and may license it to others, except as section 21 ("Exclusive licenses") says. The Licensee gets no ownership and no right to stop anyone else\'s use.',
    ],
  },
  {
    id: "credit-and-edits",
    title: "8. Credit and edits",
    blocks: [
      "Credit as {credit_line} where Schedule A (credit) requires it. Edits are allowed as listed in Schedule A (permitted edits) and must not change what the Video shows or means.",
    ],
  },
  {
    id: "prohibited-uses",
    title: "9. Prohibited uses",
    blocks: [
      "The Licensee must not make any use listed in Schedule A (prohibited uses). These include resale or sublicensing, Content ID claims, AI/ML training or synthetic edits, misleading or defamatory contexts, and political ads.",
    ],
  },
  {
    id: "excluded-content",
    title: "10. Excluded third-party content",
    blocks: [
      {
        list: [
          "{music_clause}",
          "{people_clause}",
          "The Licensor consents to the use of their own appearance and voice in the Video for the Licensed Use. This does not allow anyone to state or imply that the Licensor endorses anything.",
        ],
      },
    ],
  },
  {
    id: "licensor-promises",
    title: "11. Licensor's promises",
    blocks: [
      // Last sentence: 07 D43's explainer replaces license.md's research cross-reference.
      "The Licensor promises that (a) they filmed the Video or own or control the rights needed to grant this license, except as excluded in section 10; (b) they have not given anyone exclusive rights that conflict with it; and (c) as far as they know, the Video, as delivered, does not infringe anyone's rights. Ownership statement: {ownership_label}. When that statement says Verified, it confirms who controls the account that posted the Video, not who filmed it.",
    ],
  },
  {
    id: "licensee-promises",
    title: "12. Licensee's promises",
    blocks: [
      "The Licensee will use the Video only within this license and follow each platform's rules and advertising-disclosure laws. When buying for a client, the Licensee names that client as the licensee. The Licensee shares the Licensed File only with contractors working for it, who may use it only for the Licensee.",
    ],
  },
  {
    id: "payment",
    title: "13. Payment",
    blocks: [
      // ACCOUNTANT: confirm "Prices exclude taxes." (license.md Q10; OQ-36: no tax line in the prototype).
      "The Licensee paid {total_paid} through {app_name}. {app_name} collects the license fee ({license_fee}) as the Licensor's limited payment-collection agent, so payment to {app_name} settles what the Licensee owes. The service fee ({service_fee}) is {app_name}'s own fee. Prices exclude taxes.",
    ],
  },
  {
    id: "revocation",
    title: "14. Revocation, termination and refunds",
    blocks: [
      {
        list: [
          "14.1 The Licensor cannot cancel a valid license at will.",
          // 14.2's refund follows 07 D86 (OQ-13): every admin revoke refunds in full, except a reversed payment.
          "14.2 Licensee breach: {app_name} may terminate on notice if a breach isn't fixed within 5 business days. Termination is immediate for prohibited uses. The Licensee gets a full refund of {total_paid}.",
          "14.3 Rights problem: if {app_name} reasonably decides the Licensor lacked the rights (for example a credible claim from the real owner, or a court order), it may revoke. The Licensee stops new uses at once and removes existing uses within 5 business days of notice. The Licensee gets a full refund of {total_paid}.",
          // 14.4 follows 07 D46 and OQ-38: a chargeback is flagged for the admin, never an automatic revoke.
          "14.4 Payment reversed (chargeback or refund): {app_name} may revoke the license. No refund is due, because the money already went back.",
          "14.5 Issued in error: revoked, with a full refund.",
          '14.6 From revocation, {verify_url} shows "Revoked". Sections 10–11 and 15–20 survive.',
        ],
      },
    ],
  },
  {
    id: "limits",
    title: "15. Limits of liability",
    blocks: [
      // LAWYER: confirm the cap and the carve-outs.
      "No party is liable for indirect, incidental or consequential losses. Each party's total liability under this license, including {app_name}'s, is capped at {total_paid}. The cap does not apply to fraud or to use outside this license.",
    ],
  },
  {
    id: "indemnities",
    title: "16. Indemnities",
    blocks: [
      // LAWYER: an indemnity from an individual creator may be worth little; consider capping it at {license_fee}.
      "The Licensor covers third-party claims that the Video, as delivered and excluding section 10 items, infringes copyright. The Licensee covers claims arising from its edits, its context, excluded items, or use outside this license.",
    ],
  },
  {
    id: "role",
    title: "17. {app_name}'s role",
    blocks: [
      "{app_name} is not the licensor. It runs the marketplace, collects payment, delivers the file, keeps the official record, and may revoke under section 14. Apart from its own obligations in the {app_name} Terms, it makes no promises about the Video.",
    ],
  },
  {
    id: "verification",
    title: "18. Verification and records",
    blocks: [
      "The official record of this license is at {verify_url}. If this document and that record differ, the record controls. The Licensee agrees that the Licensee name, the scope, the dates and the status are public on that page.",
    ],
  },
  {
    id: "governing-law",
    title: "19. Governing law",
    blocks: [
      // LAWYER: governing law and venue (license.md Q8).
      "{governing_law}. Disputes go to {venue}.",
    ],
  },
  {
    id: "general",
    title: "20. General",
    blocks: [
      "This license and the {app_name} Terms in force at purchase are the entire agreement. If they conflict on usage rights, this license controls. Later license versions don't change this one. The Licensee may not assign it without the Licensor's written consent through {app_name}. If a term is invalid, the rest stands. Notices go through {app_name} to the emails on file.",
    ],
  },
  {
    id: "exclusive-licenses",
    title: "21. Exclusive licenses",
    blocks: [
      // 07 D113, verbatim (DRAFT).
      "If your license summary says Exclusive, the creator won't grant, sell or offer a license of this video to anyone else, for any use or territory, from the start date until the end date of your license and of any renewal term. The creator keeps the copyright and may keep their own existing posts of the video online.",
    ],
  },
  {
    id: "renewal",
    title: "22. Renewal",
    blocks: [
      // 07 D113 as amended by D142, verbatim (DRAFT).
      "An exclusive license can be renewed for another term of the same length (30 days, 6 months or 1 year) at the agreed renewal price, automatically if you turned on auto-renewal, or by you from My licenses. The renewal terms in our Terms of Service apply.",
    ],
  },
];

/** Schedule A (license.md §2.1–§2.6 as text; research citations and notes left out; credit per 07 D43). */
export const LICENSE_V1_SCHEDULE_A: LegalSection = {
  id: "schedule-a",
  title: "Schedule A",
  blocks: [
    { heading: "Uses" },
    {
      list: [
        "Organic social repost: post it on your own social media accounts, without paying to promote it. Included: any number of posts, stories, reels, shorts or lives on social accounts owned or run by the Licensee, on any platform. Compilations and commentary posts are fine. Thumbnails taken from the video are fine. Not included: paid boosts or ads; TV; websites, apps and newsletters; accounts of clients, partners or affiliates; giving the file to anyone else.",
        'Paid social ads: everything in organic, plus running it as ads or boosted posts on social platforms from your own ad accounts. Included: ads, boosts and promoted posts bought through a social platform\'s own ad tools (Meta, TikTok, YouTube, Snapchat, Pinterest, X, LinkedIn, Reddit), including wherever those tools place the ad. Not included: TV or radio commercials; streaming-TV, display, programmatic, outdoor or print ads; packaging or merchandise; "partnership" or "Spark"-style ads run through the creator\'s own handle (those need the creator\'s in-app approval); saying or implying the creator or anyone in the video endorses you.',
        "TV / broadcast: everything in organic, plus showing it inside TV programs on air and on your own streaming or catch-up services. Included: use inside programs (news, entertainment, clip shows) on broadcast, cable or satellite. The program may be carried by the networks and streaming services that commission or air it, in the Territory and during the Term. Short promos for that program are included. Not included: TV commercials or any advertising; feature films; licensing the clip on its own to others; uses outside the program.",
      ],
    },
    { heading: "Term" },
    {
      list: [
        "30 days: use it for 30 days from approval, then take it down.",
        "6 months: use it for 6 months from approval, then take it down.",
        "1 year: use it for 1 year from approval, then take it down.",
        "Perpetual: use it with no end date, as long as you keep to the license.",
      ],
    },
    "Months are calendar months; if the day doesn't exist in the end month, the term ends on the last day of that month. Dates are shown with time in UTC.",
    "When the term ends: within 7 days, the Licensee removes posts, stops ads, makes no new broadcasts or streams, and deletes working copies. It may keep one archived copy for legal records only.",
    { heading: "Territory" },
    {
      list: [
        "One country: aim your use at one country you choose. That covers ads targeted there, broadcasts there, and posts from accounts that serve that country's audience.",
        "One region: the same, for one of five regions: North America (US & Canada), Latin America & Caribbean, Europe, Middle East & Africa, or Asia-Pacific.",
        "Worldwide: use it anywhere.",
      ],
    },
    "Territory is where the use is aimed: the audience an ad is targeted to, the market where a program airs, or the main audience of the posting account. People outside the Territory seeing a public post by chance is not a breach. An account whose audience is global should choose Worldwide.",
    "Regions follow the United Nations M49 groupings: North America is Northern America (the US and Canada); Latin America & Caribbean includes Mexico; Europe includes the UK; Middle East & Africa is Africa and Western Asia; Asia-Pacific is the rest of Asia and Oceania.",
    { heading: "Credit" },
    {
      list: [
        "The credit line is printed on the license: the verified account and its platform as shown on the ownership statement (for example: Video: @maya.films on Instagram), or the creator's handle when no posting is verified.",
        "Organic social repost: required, in the caption or on screen. Tag the account where the platform allows it.",
        "TV / broadcast: required where reasonably practicable (on screen or in program credits).",
        "Paid social ads: optional.",
        "The credit must not suggest the creator endorses the Licensee.",
      ],
    },
    { heading: "Permitted edits" },
    "Allowed:",
    {
      list: [
        "crop, reframe or resize, including changing the aspect ratio;",
        "trim, shorten, or cut into shorter clips;",
        "captions, subtitles, translations, on-screen text, commentary or reaction overlays;",
        "the Licensee's logo, bug or watermark, plus intros, outros and end cards;",
        "color, exposure, stabilization, noise reduction, upscaling, and speed changes for pacing;",
        "mute, lower or replace the audio, or add a voiceover that is not presented as coming from people in the video;",
        "include the video in compilations;",
        "use still frames as thumbnails for the licensed use.",
      ],
    },
    "Not allowed: edits that change what the video shows or means, or what people in it say or do. That includes AI face or voice changes, and splicing or combining footage to mislead.",
    { heading: "Prohibited uses (all uses)" },
    {
      list: [
        "Reselling, sublicensing, renting or lending the video; sharing the file on its own; uploading it to stock or footage libraries or marketplaces; minting NFTs.",
        "Using it for anyone other than the Licensee named on the license, such as an agency's other clients or a group's other companies.",
        "Registering it in Content ID, Rights Manager or any fingerprinting system; claiming ownership; or sending takedowns against the creator or other licensees.",
        "Using it to train, fine-tune, test or improve any AI or machine-learning system, or putting it in a dataset; making synthetic versions of anyone in it (face, voice, body); biometric identification.",
        "Misleading context, for example presenting it as a different event, place or date.",
        "Defamatory, hateful, harassing, pornographic, sexualized or unlawful uses, or contexts a reasonable person would find unflattering to anyone shown.",
        "Political or issue ads, or campaign material. Stating or implying that the creator or anyone shown supports a party, candidate or cause. Accurate news coverage under Organic or TV is allowed.",
        "In paid ads: tobacco, nicotine or vaping; cannabis; adult or sexual services; gambling; weapons.",
        "Statements attributed to the creator or people in the video, and anything implying they endorse a product.",
        "Registering a trademark or logo that uses any part of the video.",
      ],
    },
  ],
};

/** Values for the legal-config tokens. */
export const LICENSE_V1_LEGAL_VALUES = {
  app_name: APP_NAME,
  company_legal_name: LEGAL_ENTITY_NAME,
  governing_law: GOVERNING_LAW,
  venue: VENUE,
  support_email: SUPPORT_EMAIL,
} as const;

/** Neutral words for /legal/license/v1 (license.md §4 (a)): the page shows the text, not a particular license. */
export const LICENSE_V1_NEUTRAL_VALUES: Readonly<Record<string, string>> = {
  ...LICENSE_V1_LEGAL_VALUES,
  creator_display_name: "the creator named on the license",
  creator_handle: "The creator",
  licensee_name: "the buyer named on the license",
  accepted_at: "the date shown on the license",
  start_date: "the start date",
  end_date: "the end date",
  video_title: "named on the license",
  source_url: "source shown on the license",
  use_label: "the use chosen at checkout",
  use_definition: "see its definition in Schedule A",
  use_one_liner: "Use the video for the use chosen at checkout",
  term_label: "the term chosen at checkout",
  term_phrase: "for the term chosen at checkout",
  territory_label: "the territory chosen at checkout",
  territory_detail: "",
  credit_line: "the credit line printed on the license",
  ownership_label: "the statement printed on the license",
  license_fee: "the license fee shown on the license",
  service_fee: "the service fee shown on the license",
  total_paid: "the total shown on the license",
  verify_url: "the license's verification page",
  exclusive_phrase: "until the end date",
  renewal_interval: "at the end of each term",
  renewal_total: "the agreed renewal price",
  music_clause: `When the Video contains music the Licensor does not own: ${LICENSE_V1_MUSIC_CLAUSE}`,
  people_clause: `When people other than the Licensor can be identified in the Video: ${LICENSE_V1_PEOPLE_CLAUSE}`,
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
export const LICENSE_V1_DISPLAY_TITLE = fillLicenseV1(
  LICENSE_V1_TITLE,
  LICENSE_V1_LEGAL_VALUES,
);
