// Terms of Service, DRAFT (research/license.md §8.1 outline; 07 D74, D81, D86, D93, D94, D113, D114, D121, D122,
// D126, D134, D137, D138, D139, D142; docs/08). A lawyer reviews it before real money (OQ-28). No currency is named.
import {
  APP_NAME,
  COPYRIGHT_AGENT,
  COPYRIGHT_EMAIL,
  GOVERNING_LAW,
  LEGAL_ENTITY_NAME,
  SUPPORT_EMAIL,
  VENUE,
} from "@/lib/app-name";
import { LICENSE_V1_DISPLAY_TITLE } from "@/lib/legal/license-v1-summary";
import { type LegalSection, mailtoLink, urlLink } from "@/lib/legal/types";

// The full service agreement (research/stripe-owner-answers.md §2.2).
const STRIPE_CONNECTED_ACCOUNT_AGREEMENT_URL =
  "https://stripe.com/connect-account/legal/full";

export const TERMS_SECTIONS: readonly LegalSection[] = [
  {
    id: "who-we-are",
    title: "1. Who we are",
    blocks: [
      `${APP_NAME} is run by ${LEGAL_ENTITY_NAME}. It is a marketplace: creators publish their videos with prices, and buyers license them for a chosen use, term and territory.`,
      ["Contact: ", mailtoLink(SUPPORT_EMAIL), "."],
    ],
  },
  {
    id: "eligibility",
    title: "2. Eligibility",
    blocks: [
      // 07 D93, verbatim.
      `You must be 18 or older to sell on ${APP_NAME}. Your payout account must be in your own name.`,
      `Buyers must be 18 or older and act for a business or professionally. ${APP_NAME} is not available where it is prohibited.`,
    ],
  },
  {
    id: "accounts",
    title: "3. Accounts and sign-in",
    blocks: [
      "You sign in with a 6-digit code that we email to you. There is no password, so keep access to your email account.",
      "Each creator has one account. Buyers can sign in the same way to see their licenses in My licenses.",
    ],
  },
  {
    id: "social-accounts",
    title: "4. Linking social accounts",
    blocks: [
      [
        "You link an account through the platform's official login. We ask for the minimum read-only access, we never post or act on your account, and we read only the data listed in our ",
        { href: "/legal/privacy", label: "Privacy Policy" },
        ". You can disconnect an account at any time in Connections.",
      ],
      [
        "By connecting YouTube, you agree to be bound by the YouTube Terms of Service (",
        urlLink("https://www.youtube.com/t/terms"),
        ").",
      ],
    ],
  },
  {
    id: "creators",
    title: "5. Creator rules",
    blocks: [
      {
        list: [
          'Before you publish a video, you confirm: "I filmed this video myself, or I own all the rights to it, and I have the right to license it." and "It isn\'t a re-upload of someone else\'s video, and I haven\'t given anyone exclusive rights to it."',
          "You answer the questions about music and about people who can be recognized in the video accurately.",
          "You set your prices on your rate card, and you may set a base price for a single video.",
          "You approve or decline each request within the approval window you choose. A request you don't answer in time expires, and the buyer isn't charged.",
          "If you turn on auto-approve, we approve requests on your behalf as soon as a buyer pays, if your payouts are on and the payment looks safe.",
          "You can publish and sell before you set up payouts, but you must set up payouts to approve a request.",
          "While an exclusive license or a renewal reservation runs on a video, you don't license that video to anyone else.",
          `"Verified" means the post is on an account you linked to ${APP_NAME}. It confirms who controls the account, not who filmed the video. "Not verified" means you added the link, but we couldn't confirm the account is yours.`,
        ],
      },
    ],
  },
  {
    id: "buyers",
    title: "6. Buyer rules and refunds",
    blocks: [
      {
        list: [
          "You choose a use, a term and a territory, and you pay at checkout. Your card is authorized when you pay and charged only when the creator approves.",
          "If the creator declines, or doesn't answer within their approval window, the hold is released and you aren't charged.",
          "Once a request is approved, you get the original file, your license as a PDF and a public verification page.",
          [
            "Your license is the ",
            { href: "/legal/license/v1", label: LICENSE_V1_DISPLAY_TITLE },
            ", and it is part of these terms.",
          ],
        ],
      },
      { heading: "Refunds" },
      {
        list: [
          "Before approval: nothing is charged. A decline, an expiry or a failed payment releases the hold.",
          "After approval: sales are final, except that you get a full refund, service fee included, if we can't deliver a working file and don't fix it within 3 business days of your report, or if we revoke your license.",
          "An admin revoke refunds the buyer in full and takes back the creator's share, except when the payment was already reversed (for example a lost chargeback).",
          "A renewal payment follows the same rule: an admin revoke refunds that term in full.",
          "Refunds go back to the original card. Most banks show them within 5–10 business days.",
        ],
      },
    ],
  },
  {
    id: "auto-renewal",
    title: "7. Exclusive licenses and auto-renewal",
    blocks: [
      [
        "These rules apply to exclusive licenses and their renewals (",
        { href: "/legal/license/v1#renewal", label: "License v1, section 22" },
        ").",
      ],
      {
        list: [
          "An exclusive license lasts at most one year per term: 30 days, 6 months or 1 year.",
          "Auto-renewal is never on by default. It turns on only when you choose it: by ticking the auto-renewal box at checkout or when you renew from My licenses (after you confirm your email with a 6-digit code), or by accepting a higher price after auto-renewal turned off (see below).",
          "Before you turn it on, we show you how often it renews, the renewal price (license plus service fee), the card we will charge and how to cancel. Stripe saves your card to charge renewals.",
          "Every exclusive length can renew. Each renewal is a new term of the same length (30 days, 6 months or 1 year), at the agreed renewal price.",
          // 07 D134's buyer sentence, verbatim.
          "The renewal date is the end of your current term. We charge your card on the renewal date, before your current term ends (at most about a day before).",
          "We email you before each renewal: 30 days, 7 days and 48 hours before (7 days and 48 hours before for a 30-day term). Each reminder shows the renewal date, whether auto-renewal is on, the agreed price, any price change waiting for your answer, and a link to manage auto-renewal.",
          "The renewal price locks 45 days before your term ends, or for the whole term when the term is shorter. A price change proposed after that never changes your upcoming renewal unless you accept a higher price.",
          "The creator can change the renewal price at any time during your license, but not during a renewal reservation. While auto-renewal is on, a higher price is never charged unless you accept it: you have 30 days to accept or decline, we email you right away and remind you, and silence never counts as acceptance. A lower price applies automatically, and we tell you. While auto-renewal is off, the new price is what a manual renewal costs, and you see it before you pay.",
          "Declining a higher price turns auto-renewal off at once, after you acknowledge a notice that says so. If you close the notice instead, nothing is decided.",
          "If you don't answer within 30 days, auto-renewal turns off. You can still accept the higher price until your term ends, which turns auto-renewal back on at that price; declining keeps it off.",
          "A failed payment that isn't fixed by the end of your term starts the 30-day renewal reservation, with no automatic charge during it.",
          "The 30-day renewal reservation applies only when auto-renewal was on and the renewal didn't happen: you declined or didn't accept a higher price, the renewal payment wasn't completed by the end of your term, or we couldn't pay the creator. For 30 days after your license ends, nobody else can license the video, nothing is charged automatically, and you can renew from My licenses at the reserved price. The reservation doesn't extend your license: your rights end on its end date.",
          "If you turn auto-renewal off yourself, or never turned it on, there is no reservation: the creator may license the video to others once your license ends.",
          "You can turn auto-renewal off online at any time in My licenses, with no penalty. Your license stays valid until its end date.",
          "We never charge a renewal without your consent, and never more than the price you agreed to or accepted.",
          "We keep records of your consent, your answers to price changes, renewal notices and cancellations.",
        ],
      },
    ],
  },
  {
    id: "payments",
    title: "8. Payments",
    blocks: [
      {
        list: [
          "Stripe processes all payments.",
          `${APP_NAME} collects the license fee as the creator's limited payment-collection agent, so paying ${APP_NAME} settles what the buyer owes the creator. The service fee is ${APP_NAME}'s own fee.`,
          `Prices, charges and payouts are in the creator's own payout currency. ${APP_NAME} doesn't convert currencies.`,
        ],
      },
    ],
  },
  {
    id: "payouts",
    title: "9. Payouts",
    blocks: [
      [
        "Payouts go through Stripe. Creators accept the ",
        {
          href: STRIPE_CONNECTED_ACCOUNT_AGREEMENT_URL,
          label: "Stripe Connected Account Agreement",
        },
        `, and accepting these terms includes accepting it. Payout timing is set by Stripe.`,
      ],
      // 07 D139, verbatim (OQ-37).
      "When an admin revoke refunds a buyer, we take back your share of that sale from your Stripe balance. If that leaves your balance below zero (for example because the money was already paid out to your bank), Stripe may debit the bank account linked to your payouts for the amount owed, as the Stripe Connected Account Agreement allows.",
    ],
  },
  {
    id: "our-role",
    title: "10. Our role",
    blocks: [
      [
        `${APP_NAME} is a marketplace, not the licensor. We may disable a video, and we may revoke a license for the reasons in section 14 of the `,
        { href: "/legal/license/v1#revocation", label: "License" },
        ": a rights problem, a licensee breach, a reversed payment, or a license issued in error.",
      ],
    ],
  },
  {
    id: "prohibited-conduct",
    title: "11. Prohibited conduct",
    blocks: [
      "Don't commit fraud, upload content you don't have the rights to, misuse buyers' data, scrape the service, or attack it.",
    ],
  },
  {
    id: "copyright",
    title: "12. Copyright",
    blocks: [
      [
        `If you believe a video on ${APP_NAME} infringes your copyright, contact our copyright agent, ${COPYRIGHT_AGENT}, at `,
        mailtoLink(COPYRIGHT_EMAIL),
        ".",
      ],
      [
        mailtoLink(COPYRIGHT_EMAIL, "Report a video"),
        " by email. We may disable a reported video and revoke its licenses where needed.",
      ],
      "If your video was removed and you believe that was a mistake, you can send a counter-notice to the same address.",
      "We close the accounts of users who repeatedly infringe copyright.",
    ],
  },
  {
    id: "disclaimers",
    title: "13. Disclaimers, limits and indemnity",
    blocks: ["[To be drafted with a lawyer.]"],
  },
  {
    id: "governing-law",
    title: "14. Governing law and disputes",
    blocks: [
      `These terms are governed by ${GOVERNING_LAW}. Disputes go to ${VENUE}.`,
    ],
  },
  {
    id: "changes",
    title: "15. Changes and contact",
    blocks: [
      "We tell you about changes to these terms by email or in the app. Licenses already issued keep their version.",
      ["Questions: ", mailtoLink(SUPPORT_EMAIL), "."],
    ],
  },
];
