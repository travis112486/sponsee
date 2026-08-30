CREATE TYPE "public"."platform_sync_status" AS ENUM('never', 'ok', 'error');--> statement-breakpoint
ALTER TYPE "public"."activity_kind" ADD VALUE 'platform_sync';--> statement-breakpoint
ALTER TABLE "creator_platforms" ADD COLUMN "handle" varchar(255);--> statement-breakpoint
ALTER TABLE "creator_platforms" ADD COLUMN "channel_url" text;--> statement-breakpoint
ALTER TABLE "creator_platforms" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "creator_platforms" ADD COLUMN "subscriber_count" integer;--> statement-breakpoint
ALTER TABLE "creator_platforms" ADD COLUMN "subscriber_count_is_estimate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_platforms" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_platforms" ADD COLUMN "sync_status" "platform_sync_status" DEFAULT 'never' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_platforms" ADD COLUMN "sync_error" text;