// The license snapshot stored in license.snapshot (03 §3.7.2, 07 §8.2: the creator is an adult; amounts carry the currency)
// and the pure builder issueLicense calls (07 D71). /l, the PDF and /verify render only from it, so a record is checked
// against LicenseSnapshotV1Schema before it is stored. Client-safe; client components import the type only.
import { z } from "zod";
import {
  CURRENCIES,
  type Currency,
  isOneOf,
  POSTING_PLATFORMS,
  type PostingPlatform,
  SOCIAL_PROVIDERS,
  type SocialProviderId,
  TERM_KEYS,
  TERRITORY_KEYS,
  type TermKey,
  type TerritoryKey,
  USE_KEYS,
  type UseKey,
} from "../domain/values";
import { postingPlatformLabel } from "../postings/labels";
import { buyerPostingOrder, shownPostingUrl } from "../videos/ownership";
import { creditLine } from "./credit";
import { rateOptionLabel } from "./options";
import { territoryLabel } from "./selection";

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

/** A license code as the license_code_format CHECK has it (07 D101). Client-safe: the schema and /verify read it. */
export const LICENSE_CODE_PATTERN =
  /^CL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

const isoInstant = z.iso.datetime();
const cents = z.number().int().nonnegative();

/** LicenseSnapshotV1 as data: what issueLicense stores, and what /l, the PDF and /verify parse (03 §3.7.2). */
export const LicenseSnapshotV1Schema = z.object({
  v: z.literal(1),
  termsVersion: z.literal("v1"),
  code: z.string().regex(LICENSE_CODE_PATTERN),
  issuedAt: isoInstant,
  startsAt: isoInstant,
  endsAt: isoInstant.nullable(),
  licensee: z.object({ name: z.string().min(1) }),
  creator: z.object({ handle: z.string().min(1), displayName: z.string() }),
  ownership: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("verified_owner"),
      provider: z.enum(SOCIAL_PROVIDERS),
      providerUsername: z.string().min(1),
      linkedAt: isoInstant,
      verifiedAt: isoInstant,
      sourcePermalink: z.string().nullable(),
    }),
    z.object({ kind: z.literal("self_attested") }),
  ]),
  postings: z.array(
    z.object({
      platform: z.enum(POSTING_PLATFORMS),
      label: z.string().min(1),
      url: z.string().nullable(),
      verified: z.boolean(),
      verifiedUsername: z.string().nullable(),
      linkedAt: isoInstant.nullable(),
    }),
  ),
  video: z.object({
    id: z.uuid(),
    title: z.string().min(1),
    durationMs: z.number().int().nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
  }),
  scope: z.object({
    useKey: z.enum(USE_KEYS),
    useLabel: z.string().min(1),
    termKey: z.enum(TERM_KEYS),
    termLabel: z.string().min(1),
    territoryKey: z.enum(TERRITORY_KEYS),
    territoryLabel: z.string().min(1),
    territoryDetail: z.string().nullable(),
  }),
  exclusions: z.object({ music: z.boolean(), people: z.boolean() }),
  creditLine: z.string().min(1),
  amounts: z.object({
    licensePriceCents: cents,
    platformFeeCents: cents,
    amountTotalCents: cents,
    currency: z.enum(CURRENCIES),
  }),
  exclusive: z.boolean(),
  renewalOfCode: z.string().regex(LICENSE_CODE_PATTERN).nullable(),
});

/** One video_posting row as the snapshot reads it, at issue time. */
export type SnapshotPosting = {
  platform: PostingPlatform;
  otherLabel: string | null;
  url: string | null;
  showLink: boolean;
  isSource: boolean;
  verification: "verified" | "unverified";
  position: number;
  verifiedUsername: string | null;
  verifiedAccountLinkedAt: Date | null;
  verifiedAt: Date | null;
  /** The platform removed the verified post: its link is never kept (07 D70). */
  removed: boolean;
};

/** Everything a snapshot is built from: plain values, read in the issuing transaction. */
export type LicenseSnapshotInput = {
  code: string;
  issuedAt: Date;
  startsAt: Date;
  endsAt: Date | null;
  request: {
    licenseeName: string;
    useKey: UseKey;
    termKey: TermKey;
    territoryKey: TerritoryKey;
    territoryCode: string | null;
    licensePriceCents: number;
    platformFeeCents: number;
    amountTotalCents: number;
    currency: Currency;
  };
  video: {
    id: string;
    title: string;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    containsMusic: boolean;
    identifiablePeople: boolean;
  };
  creator: { handle: string; displayName: string };
  postings: readonly SnapshotPosting[];
};

/** A verified posting's identity, which the database guarantees (CHECK video_posting_verified_fields). */
function verifiedFacts(p: SnapshotPosting) {
  if (!p.verifiedUsername || !p.verifiedAccountLinkedAt || !p.verifiedAt) {
    throw new Error(
      "buildLicenseSnapshot: a verified posting lacks its account",
    );
  }
  return {
    username: p.verifiedUsername,
    linkedAt: p.verifiedAccountLinkedAt.toISOString(),
    verifiedAt: p.verifiedAt.toISOString(),
  };
}

/** A posting as the record lists it (03 §3.7.2): a handle and link time only when verified. */
function entryOf(p: SnapshotPosting): LicenseSnapshotV1["postings"][number] {
  const facts = p.verification === "verified" ? verifiedFacts(p) : null;
  return {
    platform: p.platform,
    label: postingPlatformLabel(p.platform, p.otherLabel),
    url: shownPostingUrl(p),
    verified: facts !== null,
    verifiedUsername: facts?.username ?? null,
    linkedAt: facts?.linkedAt ?? null,
  };
}

/**
 * The license's immutable record (03 §3.7.2; 07 D71, D93, D94): the scope's labels, the postings (verified first, then
 * the creator's order, as the license page shows them), the ownership and credit line from the primary verified posting
 * (is_source, else the lowest-position verified one), and the request's amounts in its currency. Standard licenses only: P19g sets
 * `exclusive` from the request, and the renewal engine sets `renewalOfCode`.
 */
export function buildLicenseSnapshot(
  i: LicenseSnapshotInput,
): LicenseSnapshotV1 {
  const { ordered, primary } = buyerPostingOrder(i.postings);
  const { request: r, video: v } = i;
  return {
    v: 1,
    termsVersion: "v1",
    code: i.code,
    issuedAt: i.issuedAt.toISOString(),
    startsAt: i.startsAt.toISOString(),
    endsAt: i.endsAt?.toISOString() ?? null,
    licensee: { name: r.licenseeName },
    creator: { handle: i.creator.handle, displayName: i.creator.displayName },
    ownership: primary ? verifiedOwner(primary) : { kind: "self_attested" },
    postings: ordered.map(entryOf),
    video: {
      id: v.id,
      title: v.title,
      durationMs: v.durationMs,
      width: v.width,
      height: v.height,
    },
    scope: {
      useKey: r.useKey,
      useLabel: rateOptionLabel(r.useKey),
      termKey: r.termKey,
      termLabel: rateOptionLabel(r.termKey),
      territoryKey: r.territoryKey,
      territoryLabel: rateOptionLabel(r.territoryKey),
      territoryDetail:
        r.territoryKey === "worldwide"
          ? null
          : territoryLabel(r.territoryKey, r.territoryCode),
    },
    exclusions: { music: v.containsMusic, people: v.identifiablePeople },
    creditLine: creditLine({
      handle: i.creator.handle,
      primary: primary && entryOf(primary),
    }),
    amounts: {
      licensePriceCents: r.licensePriceCents,
      platformFeeCents: r.platformFeeCents,
      amountTotalCents: r.amountTotalCents,
      currency: r.currency,
    },
    exclusive: false,
    renewalOfCode: null,
  };
}

function verifiedOwner(p: SnapshotPosting): LicenseSnapshotV1["ownership"] {
  if (!isOneOf(SOCIAL_PROVIDERS, p.platform)) {
    throw new Error("buildLicenseSnapshot: a verified posting's platform");
  }
  const facts = verifiedFacts(p);
  return {
    kind: "verified_owner",
    provider: p.platform,
    providerUsername: facts.username,
    linkedAt: facts.linkedAt,
    verifiedAt: facts.verifiedAt,
    sourcePermalink: shownPostingUrl(p),
  };
}
