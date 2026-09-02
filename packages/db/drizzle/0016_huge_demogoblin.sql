CREATE TYPE "public"."creator_file_scope" AS ENUM('evidence', 'contract');--> statement-breakpoint
CREATE TABLE "creator_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"original_filename" text,
	"origin_deal_id" uuid,
	"origin_deal_title" text,
	"scope" "creator_file_scope" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "creator_files" ADD CONSTRAINT "creator_files_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_files" ADD CONSTRAINT "creator_files_origin_deal_id_deals_id_fk" FOREIGN KEY ("origin_deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_files_storage_key_idx" ON "creator_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "creator_files_creator_idx" ON "creator_files" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "creator_files_origin_deal_idx" ON "creator_files" USING btree ("origin_deal_id");--> statement-breakpoint
-- Backfill (SPO-348): every proofs/contracts row that already carries a
-- storage_key predates this table, and its deal row must still exist to have
-- reached this point — proofs.deal_id/contracts.deal_id cascade-delete with
-- their deal, so a row with a dead deal reference can't exist here — so a
-- plain INNER JOIN is safe. mime_type/size_bytes are backfilled defensively
-- with COALESCE because those two columns are optional on proofs/contracts
-- but NOT NULL here; every real upload path sets them together with
-- storage_key, so the fallback is only ever exercised by a hand-crafted or
-- pre-validation row.
INSERT INTO "creator_files" ("creator_id", "storage_key", "mime_type", "size_bytes", "original_filename", "origin_deal_id", "origin_deal_title", "scope", "created_at")
SELECT "d"."creator_id", "p"."storage_key", COALESCE("p"."mime_type", 'application/octet-stream'), COALESCE("p"."size_bytes", 0), "p"."original_filename", "p"."deal_id", "d"."title", 'evidence', "p"."created_at"
FROM "proofs" "p"
JOIN "deals" "d" ON "d"."id" = "p"."deal_id"
WHERE "p"."storage_key" IS NOT NULL
ON CONFLICT ("storage_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "creator_files" ("creator_id", "storage_key", "mime_type", "size_bytes", "original_filename", "origin_deal_id", "origin_deal_title", "scope", "created_at")
SELECT "d"."creator_id", "c"."storage_key", COALESCE("c"."mime_type", 'application/octet-stream'), COALESCE("c"."size_bytes", 0), "c"."original_filename", "c"."deal_id", "d"."title", 'contract', "c"."created_at"
FROM "contracts" "c"
JOIN "deals" "d" ON "d"."id" = "c"."deal_id"
WHERE "c"."storage_key" IS NOT NULL
ON CONFLICT ("storage_key") DO NOTHING;