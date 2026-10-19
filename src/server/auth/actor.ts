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

/** `a` as a creator actor; any other actor here is a programming error. */
export function requireCreatorActor(a: Actor): CreatorActor {
  if (a.kind !== "creator") throw new Error("a creator actor is required");
  return a;
}
