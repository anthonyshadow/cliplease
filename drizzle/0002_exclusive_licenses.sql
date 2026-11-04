ALTER TABLE "rate_card" ADD COLUMN "exclusive_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_card" ADD COLUMN "exclusive_multiplier_bps" integer DEFAULT 30000 NOT NULL;--> statement-breakpoint
ALTER TABLE "license" ADD COLUMN "exclusive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "license_request" ADD COLUMN "exclusive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "license_request" ADD COLUMN "exclusive_multiplier_bps" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "exclusive_enabled" boolean;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "exclusive_multiplier_bps" integer;--> statement-breakpoint
ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_exclusive_multiplier_range" CHECK ("rate_card"."exclusive_multiplier_bps" between 10000 and 100000);--> statement-breakpoint
ALTER TABLE "license_request" ADD CONSTRAINT "license_request_exclusive_fields" CHECK (
    ("license_request"."exclusive" and "license_request"."exclusive_multiplier_bps" between 10000 and 100000 and "license_request"."term_key" in ('d30','m6','y1'))
    or (not "license_request"."exclusive" and "license_request"."exclusive_multiplier_bps" = 10000));--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_exclusive_multiplier_range" CHECK ("video"."exclusive_multiplier_bps" is null
    or "video"."exclusive_multiplier_bps" between 10000 and 100000);