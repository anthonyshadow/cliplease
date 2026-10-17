// Data deletion instructions, DRAFT (research/license.md §8.4 items 1–2, corrected by 03 §9.1 and 07 D87, D129).
// Left out until they exist: Settings → Delete account ([H8]), the status lookup and the Meta callbacks (Later).
import { APP_NAME, PRIVACY_EMAIL } from "@/lib/app-name";
import type { LegalSection } from "@/lib/legal/types";

export const DATA_DELETION_TITLE = `Delete your data from ${APP_NAME}`;

export const DATA_DELETION_SECTIONS: readonly LegalSection[] = [
  {
    id: "how",
    title: "1. How to delete your data",
    blocks: [
      { heading: "In the app" },
      "Connections → Disconnect. The account's tokens and profile are deleted at once, and so are its cached posts, except the id and link of posts used for your videos.",
      { heading: "By email" },
      [
        "Write from your account's email address to ",
        { href: `mailto:${PRIVACY_EMAIL}`, label: PRIVACY_EMAIL },
        ". We delete your account and your data within 7 days.",
      ],
      { heading: "From the platform" },
      {
        list: [
          `Instagram: remove ${APP_NAME} under your Instagram app's website permissions.`,
          [
            "YouTube / Google: ",
            {
              href: "https://security.google.com/settings/security/permissions",
              label:
                "https://security.google.com/settings/security/permissions",
            },
          ],
          `TikTok: remove ${APP_NAME} under your TikTok app's security and app permissions.`,
        ],
      },
    ],
  },
  {
    id: "what-we-keep",
    title: "2. What we delete, and what we keep",
    blocks: [
      {
        list: [
          "Licenses already sold stay valid for the buyers who paid for them.",
          "The verification page keeps each license's record (@handle, platform and date).",
          // 07 D87 (OQ-27) and D129.
          "How long we keep license, payment and download records is being decided with a lawyer. Until then they are kept.",
          "Consent and renewal records are kept too.",
          "Where your videos were posted is kept, and your handle stays reserved.",
        ],
      },
    ],
  },
];
