// src/db/schema/ops.ts
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { createdAt, pk, tstz, updatedAt } from "./columns";
import { auditActorTypeEnum, currencyEnum, emailStatusEnum } from "./enums";
import { licenseRequest } from "./licensing";

export const stripeEvent = pgTable(
  "stripe_event",
  {
    id: text("id").primaryKey(), // Stripe evt_… — the de-duplication key
    platformCurrency: currencyEnum("platform_currency").notNull(), // the Stripe platform account: the webhook route's [currency]; fake events the request's (07 D96)
    type: text("type").notNull(),
    livemode: boolean("livemode").notNull(),
    apiVersion: text("api_version"),
    account: text("account"), // null for platform-scope events
    objectId: text("object_id"), // data.object.id (cs_/pi_/ch_; tr_ for the [H4] transfer.reversed flag)
    licenseRequestId: uuid("license_request_id").references(
      () => licenseRequest.id,
      { onDelete: "set null" },
    ),
    attempts: integer("attempts").notNull().default(1), // deliveries seen
    receivedAt: tstz("received_at").notNull().defaultNow(),
    processedAt: tstz("processed_at"),
    lastError: text("last_error"), // message or code only ('currency_mismatch', 07 D96); no payload, no PII
    updatedAt: updatedAt(),
  },
  (t) => [
    index("stripe_event_license_request_idx").on(t.licenseRequestId),
    index("stripe_event_unprocessed_idx")
      .on(t.receivedAt)
      .where(sql`${t.processedAt} is null`),
    check("stripe_event_test_mode_only", sql`${t.livemode} = false`), // CORE · drop this CHECK in the go-live migration
  ],
);

export const emailLog = pgTable(
  "email_log",
  {
    id: pk(),
    template: text("template").notNull(), // EmailTemplateId (infra §7), validated in code
    recipientHash: text("recipient_hash").notNull(), // sha256(lowercased address) hex — no plain address
    subject: text("subject").notNull(), // never a sign-in code, token or link
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(), // e.g. "request-new/<requestId>"
    status: emailStatusEnum("status").notNull().default("queued"),
    attempts: smallint("attempts").notNull().default(0), // send attempts; the outbox retries failed rows, max 3 (07 D34)
    provider: text("provider").notNull(), // "resend" | "console"
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    sentAt: tstz("sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("email_log_idempotency_key_uidx").on(t.idempotencyKey),
    index("email_log_entity_idx").on(t.entityType, t.entityId),
    index("email_log_status_created_idx").on(
      t.status,
      t.createdAt.desc().nullsFirst(),
    ),
    check(
      "email_log_entity_type",
      sql`${t.entityType} in ('user','license_request','license','social_account')`,
    ), // CORE
    check("email_log_provider", sql`${t.provider} in ('resend','console')`), // CORE
    check(
      "email_log_recipient_hash",
      sql`${t.recipientHash} ~ '^[0-9a-f]{64}$'`,
    ), // CORE
    check(
      "email_log_key_len",
      sql`char_length(${t.idempotencyKey}) between 1 and 256`,
    ), // CORE · Resend max 256
  ],
);

export const auditEvent = pgTable(
  "audit_event",
  {
    id: pk(),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(), // "license_request.approved", "video.disabled", …
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`), // never tokens/secrets/emails
    requestId: text("request_id"), // x-vercel-id
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_event_entity_idx").on(
      t.entityType,
      t.entityId,
      t.createdAt.desc().nullsFirst(),
    ),
    index("audit_event_created_idx").on(t.createdAt.desc().nullsFirst()),
    check(
      "audit_event_action_format",
      sql`${t.action} ~ '^[a-z_]+([.][a-z_]+)+$'`,
    ), // CORE
  ],
);
