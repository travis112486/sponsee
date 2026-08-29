ALTER TABLE "chase_events" ADD COLUMN "enqueued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chase_events" ADD COLUMN "send_job_id" text;