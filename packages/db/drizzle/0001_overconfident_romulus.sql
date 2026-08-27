CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'trialing');--> statement-breakpoint
ALTER TYPE "public"."chase_event_status" ADD VALUE 'sending' BEFORE 'sent';--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "subscription_status" "subscription_status";--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "current_period_end" timestamp with time zone;