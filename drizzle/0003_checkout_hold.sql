ALTER TABLE "license_request" ADD COLUMN "checkout_hold_until" timestamp with time zone;--> statement-breakpoint
UPDATE "license_request" SET "checkout_hold_until" = "checkout_expires_at";--> statement-breakpoint
ALTER TABLE "license_request" ALTER COLUMN "checkout_hold_until" SET NOT NULL;