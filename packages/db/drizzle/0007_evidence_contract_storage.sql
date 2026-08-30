ALTER TABLE "proofs" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "proofs" ADD COLUMN "mime_type" varchar(255);--> statement-breakpoint
ALTER TABLE "proofs" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "proofs" ADD COLUMN "uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "mime_type" varchar(255);--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "uploaded_at" timestamp with time zone;
