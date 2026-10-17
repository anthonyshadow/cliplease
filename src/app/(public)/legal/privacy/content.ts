// Privacy Policy, DRAFT (research/license.md §8.2 outline, corrected by 03 §9.1 and 07 D64, D67, D83, D84, D87,
// D93, D113, D126, D129). A lawyer reviews it before real money (OQ-28).
import { APP_NAME, LEGAL_ENTITY_NAME, PRIVACY_EMAIL } from "@/lib/app-name";
import {
  GOOGLE_PERMISSIONS_URL,
  type LegalSection,
  mailtoLink,
  urlLink,
} from "@/lib/legal/types";

const privacyEmail = mailtoLink(PRIVACY_EMAIL);

export const PRIVACY_SECTIONS: readonly LegalSection[] = [
  {
    id: "who-we-are",
    title: "1. Who we are",
    blocks: [
      [
        `${APP_NAME} is run by ${LEGAL_ENTITY_NAME}. For anything about your privacy, email `,
        privacyEmail,
        ".",
      ],
    ],
  },
  {
    id: "what-we-collect",
    title: "2. What we collect",
    blocks: [
      { heading: "Creators" },
      {
        list: [
          "Your email, handle and display name, your approval settings and your payout currency.",
          // 07 D93, verbatim, and the Stripe note next to it.
          "We don't ask for or store your date of birth. We record when you confirmed you're 18 or older.",
          `Stripe's payout setup may ask for your date of birth to verify your identity. Stripe keeps it, along with your identity and bank details; ${APP_NAME} never stores them. We keep your Stripe account id and payout status.`,
          "The videos and images you upload, your rate card and your prices.",
          'The places you say a video was posted. The links you paste for "Where was it posted?" are stored and shown to buyers, and never fetched.',
        ],
      },
      { heading: "Buyers" },
      {
        list: [
          "The licensed-to name (public on the verification page), your contact name, email and intended use.",
          "Your payment status (Stripe holds your card details), when you accepted the terms, your IP address and browser, and your downloads.",
          "You can sign in with your email to see your licenses in My licenses.",
          `If you turn on auto-renewal, Stripe stores your card, not ${APP_NAME}. We keep only its brand, last 4 digits and expiry.`,
        ],
      },
      { heading: "Everyone" },
      {
        list: [
          "Your device's time zone, so emails show times in your local time.",
          "Essential cookies only (to keep you signed in). There are no ad or analytics trackers.",
        ],
      },
    ],
  },
  {
    id: "social-accounts",
    title: "3. Social-account data",
    blocks: [
      "When you link Instagram, TikTok or YouTube, we read only what is listed here.",
      {
        list: [
          "Access tokens: encrypted at rest. Deleted at once when you disconnect, or when the platform tells us you revoked access.",
          "Profile (platform id, @username, display name, avatar link, account type): kept while the account is linked and removed when you disconnect, except the platform id, which we keep so the account can be reconnected and isn't linked twice. The @username, platform and link date stay on your videos and licenses as a business record.",
          "Post details (id, caption, link, thumbnail link, type, duration, date, and view, like and comment counts where the platform offers them): cached and refreshed when you sync. Details not refreshed for 30 days are deleted. Removed when you disconnect, except for posts used for your videos, of which we keep only the id and link.",
          "Instagram view counts: only if you grant that permission.",
          `Video files: never. ${APP_NAME} never downloads or imports video from Instagram, TikTok or YouTube; the originals we store come only from your upload.`,
        ],
      },
    ],
  },
  {
    id: "why",
    title: "4. Why we use it",
    blocks: [
      "To run your account, show your Library, show who controls the account that posted a video, process licenses, prevent fraud and meet our legal obligations. Never for ads, and never sold. Google user data is not transferred except as Google's API Services User Data Policy allows.",
    ],
  },
  {
    id: "sharing",
    title: "5. Who we share it with",
    blocks: [
      {
        list: [
          "Stripe (payments and payouts), our database host, Cloudflare R2 (files), Resend (email), Vercel (hosting), and the platforms themselves (when we call their APIs).",
          "Public: the verification page of each license shows the license code, the licensed-to name, the creator's display name and @handle, the ownership statement, the video title and where it was posted, the scope, the dates and the status. It never shows prices, emails or payment details.",
          "The creator sees the buyer's licensed-to name, contact name and intended use.",
        ],
      },
    ],
  },
  {
    id: "youtube",
    title: "6. YouTube",
    blocks: [
      `${APP_NAME} uses YouTube API Services.`,
      [
        "Google Privacy Policy: ",
        urlLink("https://policies.google.com/privacy"),
      ],
      [
        `You can revoke ${APP_NAME}'s access at `,
        urlLink(GOOGLE_PERMISSIONS_URL),
      ],
    ],
  },
  {
    id: "data-deletion",
    title: "7. Your choices and deleting your data",
    blocks: [
      {
        list: [
          "Disconnect any linked account in Connections. Its tokens are deleted at once.",
          [
            "To delete your account and your data, email ",
            privacyEmail,
            " from your account's email address. We act within 7 days.",
          ],
          [
            "See ",
            { href: "/legal/data-deletion", label: "how to delete your data" },
            " for every way to do it.",
          ],
        ],
      },
    ],
  },
  {
    id: "retention",
    title: "8. How long we keep it",
    blocks: [
      // 07 D87 (OQ-27) and D129.
      "How long we keep license, payment and download records is being decided with a lawyer. Until then they are kept.",
      "Consent and renewal records (consents, price acceptances, renewal notices, cancellations) are kept too.",
      "Requests that didn't become licenses (including the buyer details on them), where your videos were posted, and our audit and payment-event records are kept on the same basis. Your account details are kept while your account exists, email logs for 1 year, and social-account data as section 3 says.",
    ],
  },
  {
    id: "security",
    title: "9. Security",
    blocks: [
      "Tokens are encrypted at rest, files are stored privately, and download links are signed and short-lived.",
    ],
  },
  {
    id: "children",
    title: "10. Children",
    blocks: [
      `${APP_NAME} is not for anyone under 18. We delete data if we learn a user is under 18.`,
    ],
  },
  {
    id: "other",
    title: "11. Transfers, your rights and changes",
    blocks: [
      "International transfers and your rights where you live: [To be drafted with a lawyer.]",
      [
        "We tell you about changes by email or in the app. Questions: ",
        privacyEmail,
        ".",
      ],
    ],
  },
];
