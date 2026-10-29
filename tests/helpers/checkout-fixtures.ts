// The demo request (05 §4.1; 07 D99): Paid social ads · 1 year · Worldwide on @maya's First snow, as StartCheckoutSchema
// takes it. Tests only.

export const DEMO_REQUEST = {
  videoId: "00000000-0000-4000-8000-000000000101",
  useKey: "paid_social",
  termKey: "y1",
  territoryKey: "worldwide",
  territoryCode: null,
  licenseeName: "Daily Laughs Media LLC",
  contactName: "Sam Lee",
  buyerEmail: "sam@dailylaughs.com",
  intendedUse: "@dailylaughs on Instagram",
  acceptTerms: true,
  termsVersion: "v1",
  submissionId: "3f6b2c1e-8d4a-4f7b-9c2e-1a5d6e7f8a9b",
  expectedTotalCents: 173250,
  timeZone: "America/Toronto",
} as const;
