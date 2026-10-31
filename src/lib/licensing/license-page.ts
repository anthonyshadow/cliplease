// The license page (S01; 05 §4.1): what it gets from the server, plain and client-safe with nothing private (no object
// key, original-file field, admin reason, social id or thumbnail; built by getLicensePageData in
// src/server/videos/public.ts), and its words.
import type { EffectiveOptions } from "../../server/pricing/rate-card";
import { APP_NAME } from "../app-name";
import type { Currency } from "../domain/values";
import { sentences } from "../format";
import { CURRENCY_DISPLAY, currencyLabel } from "../money/currency";
import type { PublicPostings } from "../postings/types";
import type { BadgeInput } from "../videos/ownership";
import { REQUEST_STATUS_COPY } from "./request-status";
import type { Selection } from "./selection";

export type LicensePageDTO = {
  video: {
    id: string;
    slug: string;
    title: string;
    width: number | null;
    height: number | null;
    /** The public poster route (posterSrc): `/api/media/posters/<id>?v=<hash8>`. */
    posterUrl: string;
    containsMusic: boolean;
    identifiablePeople: boolean;
  };
  /**
   * No payouts field: buyers can request and pay before payouts are set up (07 D74). `autoApprove`: auto-approve on and
   * the stored payouts status active (07 D81; owner answer Q-155).
   */
  creator: {
    handle: string;
    displayName: string;
    approvalWindowHours: number;
    autoApprove: boolean;
  };
  /** Every posting buyers may see, verified first, and the badge's primary one (07 D70). */
  postings: PublicPostings;
  /** The lg badge from the primary verified posting, else self-attested (07 D43, D89). */
  badge: BadgeInput;
  /** The video's options in the creator's payout currency (07 D82, D94). */
  options: EffectiveOptions;
  platformFeeBps: number;
  platformFeeMinCents: number;
  /** The first load's choice (01 J7.1). */
  selection: Selection;
};

/** The buyer-facing people notice (04 §11.2); the Rights step shows it to the creator after "Buyers will see:". */
export const PEOPLE_NOTICE =
  "People in this video haven't signed releases. For ads, or anything that suggests they endorse you, get their permission first.";

/** The license page's words (04 §11.2, 01 J6–J7, research/license.md §9.2; 07 D98); each amount formatMoney's. */
export const LICENSE_PAGE_COPY = {
  unavailable: "This video isn't available for licensing right now.",
  seeVideos: (handle: string) => `See @${handle}'s videos`,
  ogDescription: `License this video on ${APP_NAME}.`,
  posterAlt: (title: string) => `Poster for ${title}`,
  /** Two-tone headings: the word, then the question in ink-2 (04 §4.3). */
  headings: {
    use: ["Use.", "How will you post it?"],
    term: ["Term.", "How long will it run?"],
    territory: ["Territory.", "Where will people see it?"],
    details: ["Your details.", "For the license."],
  },
  whatYouGet: {
    title: "What you get.",
    body: "The original video file, no watermark · A license PDF with a code anyone can verify.",
  },
  music: {
    title: "Music not included.",
    body: "This video has music the creator doesn't own. Your license covers the video, not the music. Mute it, replace it, or license it yourself.",
  },
  people: PEOPLE_NOTICE,
  musicDisabled: "Not available: this video has music the creator doesn't own.",
  country: { label: "Country", choose: "Choose a country" },
  region: { label: "Region", choose: "Choose a region" },
  whichCountries: "Which countries?",
  license: (amount: string) => `License ${amount}`,
  serviceFee: (amount: string) => `Service fee ${amount}`,
  total: (total: string) => `Total ${total}`,
  startingCheckout: "Starting checkout…",
  /** 01 J7.10; 05 §4.1 States. */
  pricesChanged: (total: string) =>
    `Prices changed since you opened this page. New total ${total}.`,
  optionGone: "That option isn't available anymore. Choose another.",
  /** 02 §5.7; 07 D31. */
  alreadySubmitted:
    "This request was already sent. Check your email or reload the page.",
  request: (total: string) => `Request license · ${total}`,
  pricesIn: (currency: Currency) => `Prices in ${currencyLabel(currency)}.`,
  holdLead: (handle: string) =>
    `You won't be charged unless @${handle} approves.`,
  holdAmount: (total: string) =>
    `We'll put a hold of ${total} on your card now.`,
  holdDeadline: (handle: string, deadline: string) =>
    `If @${handle} declines or doesn't answer by ${deadline}, the hold is released and you pay nothing.`,
  /** 01 J7.6's auto variant (04 §11.2; 07 D81): the creator's new requests approve automatically. */
  holdAutoLead: "Instant approval.",
  holdAutoBody: (handle: string, total: string) =>
    sentences(
      REQUEST_STATUS_COPY.autoApproves(handle),
      `You'll be charged ${total} now and get the file right away.`,
    ),
  smallPrint: (handle: string) => [
    "Some banks show a hold as a pending charge. It disappears when the hold is released; timing depends on your bank.",
    `Payments are processed by Stripe. You pay ${APP_NAME}, which pays @${handle}.`,
  ],
  currencyFaq: (currency: Currency) =>
    `Your card is charged in ${CURRENCY_DISPLAY[currency].name}. If your card uses another currency, your bank converts it and may add a fee.`,
  licensedTo: "Licensed to",
  licensedToHelp:
    "The person or company that will use the video. This name appears on your license and on its public verification page. Buying for a client? Enter the client's name.",
  yourName: "Your name",
  email: "Email",
  emailHelper: "We'll send the file and license here.",
  intendedUse: "Where will you use it?",
  intendedUseHelper: (handle: string) =>
    `Account, show or campaign. Helps @${handle} say yes.`,
  legalLinks: [
    { label: "License terms", href: "/legal/license/v1" },
    { label: "Terms", href: "/legal/terms" },
    { label: "Privacy", href: "/legal/privacy" },
  ],
} as const;
