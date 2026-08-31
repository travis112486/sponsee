ALTER TABLE "contracts" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "mime_type" varchar(255);--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "original_filename" varchar(255);