// The license snapshot stored in license.snapshot (03 §3.7.2, 07 §8.2: the creator is an adult; amounts carry the currency).
// Type only: license issuing (P18) adds the Zod schema. Client-safe.
import type {
  Currency,
  PostingPlatform,
  SocialProviderId,
  TermKey,
  TerritoryKey,
  UseKey,
} from "../domain/values";
export type LicenseSnapshotV1 = {
  v: 1;
  termsVersion: "v1";
  code: string;
  issuedAt: string;
  startsAt: string;
  endsAt: string | null; // ISO UTC
  licensee: { name: string }; // public
  creator: { handle: string; displayName: string }; // at issue time (adult creators only, 07 D93)
  // From the primary verified posting: is_source, else the lowest-position verified one (07 D70, D71)
  ownership:
    | {
        kind: "verified_owner";
        provider: SocialProviderId;
        providerUsername: string; // that posting's verified_username, display form (07 D43)
        linkedAt: string;
        verifiedAt: string; // its verified_account_linked_at, verified_at
        sourcePermalink: string | null;
      } // its canonical url when show_link, else null
    | { kind: "self_attested" }; // no verified posting
  postings: Array<{
    platform: PostingPlatform;
    label: string; // postingPlatformLabel(platform, otherLabel)
    url: string | null; // canonical url; null when show_link is false or there is no link
    verified: boolean;
    verifiedUsername: string | null;
    linkedAt: string | null;
  }>; // verified first, then the creator's order
  video: {
    id: string;
    title: string;
    durationMs: number | null;
    width: number | null;
    height: number | null;
  };
  scope: {
    useKey: UseKey;
    useLabel: string;
    termKey: TermKey;
    termLabel: string;
    territoryKey: TerritoryKey;
    territoryLabel: string;
    territoryDetail: string | null;
  };
  exclusions: { music: boolean; people: boolean };
  creditLine: string; // "Video: {providerUsername} on {Platform}" (primary verified posting) or "Video: @{handle}" (self-attested)
  amounts: {
    licensePriceCents: number;
    platformFeeCents: number;
    amountTotalCents: number;
    currency: Currency;
  }; // = license_request.currency (07 D94); PDF and /l only — never /verify
  exclusive: boolean; // = license.exclusive: "Exclusive until {end_date}" or "Non-exclusive" on PDF, /l, /verify (07 D113)
  renewalOfCode: string | null; // the renewed term's code: "Renewal of {renewalOfCode}" (07 D113); null for a first term
};
