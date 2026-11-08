/**
 * My licenses' words (P20b; 04 §11.11, 05 §4.9; owner answers Q-192, Q-193): /licenses, its rows and detail, the buyer
 * sign-in and the onboarding link. A leaf module, as download-copy.ts is, so the client files that print them (the list's
 * error.tsx, the sign-in form) carry only these; LICENSE_RECORD_COPY.myLicenses is this object.
 */
export const MY_LICENSES_COPY = {
  title: "My licenses",
  heading: { lead: "My licenses.", rest: "Everything you've licensed." },
  /** `masked` is maskEmail(the session's email). */
  signedInAs: (masked: string) => `Signed in as ${masked}`,
  empty: { lead: "My licenses.", rest: "None yet." },
  emptyBody: (masked: string) =>
    `Licenses you buy with ${masked} show up here.`,
  otherEmail: "Bought with another email? Sign out and sign in with that one.",
  loadFailed: "Couldn't load your licenses. Try again.",
  tryAgain: "Try again",
  /** A row that isn't exclusive; an exclusive one shows INBOX_COPY.exclusiveTag. */
  standard: "Standard",
  /** A row's dates, formatPostDate each (UTC). */
  dates: (start: string, end: string) => `${start} – ${end} (UTC)`,
  perpetual: (start: string) => `From ${start} · No end date`,
  /** The detail's BackLink. */
  back: "My licenses",
  /** /l's link to the license in My licenses (Q-193). */
  manage: "Manage in My licenses",
  /** The sign-in email step when `next` is under /licenses (isBuyerSignIn). */
  signIn: {
    heading: "Sign in to manage your licenses",
    line: "If this email has licenses, you'll see them after you sign in.",
  },
  /** Onboarding's profile step, after the form. */
  onboardingLink: "Here to manage a license you bought? Go to My licenses.",
} as const;
