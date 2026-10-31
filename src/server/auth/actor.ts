import "server-only";

// Who did something (02 §5). The audit writer maps it to audit_event.actor_type (07 D47). The teen flow is Later
// (07 D93), so it has no actor or source here.
export type Actor =
  | { kind: "creator"; userId: string; creatorId: string }
  | { kind: "admin"; userId: string }
  | { kind: "buyer"; requestId: string } // private token links (/r, /l)
  | { kind: "buyer_user"; userId: string; email: string } // signed-in buyer (07 D126); audit actor_type 'buyer'
  | {
      kind: "system";
      // auto_approve: 07 D81; renewals: the renewal engine (cron, lazy per-plan runs, 07 D124)
      source:
        | "webhook"
        | "cron"
        | "lazy"
        | "return_url"
        | "seed"
        | "auto_approve"
        | "renewals";
    };

export type CreatorActor = Extract<Actor, { kind: "creator" }>;

/** The system doing work a page load or a reconcile triggers, with no cron or webhook behind it. */
export const LAZY: Actor = { kind: "system", source: "lazy" };

/** Stripe's events, as the webhook route and the dev fake checkout deliver them. */
export const WEBHOOK: Actor = { kind: "system", source: "webhook" };

/** The expire-requests cron (07 D57): audited as actor_type cron (07 D47). */
export const CRON: Actor = { kind: "system", source: "cron" };

/** Auto-approve (07 D81): audited as actor_type system with data.source 'auto_approve'. */
export const AUTO_APPROVE: Actor = { kind: "system", source: "auto_approve" };

/** `a` as a creator actor; any other actor here is a programming error. */
export function requireCreatorActor(a: Actor): CreatorActor {
  if (a.kind !== "creator") throw new Error("a creator actor is required");
  return a;
}
