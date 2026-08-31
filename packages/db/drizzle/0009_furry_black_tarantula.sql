ALTER TABLE "proofs" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "proofs" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "proofs" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "proofs" ADD COLUMN "original_filename" text;