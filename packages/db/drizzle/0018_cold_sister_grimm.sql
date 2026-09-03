CREATE TYPE "public"."brand_icon_outcome" AS ENUM('hit', 'miss');--> statement-breakpoint
CREATE TABLE "brand_icon_cache" (
	"domain" varchar(255) PRIMARY KEY NOT NULL,
	"outcome" "brand_icon_outcome" NOT NULL,
	"content_type" varchar(128),
	"body_base64" text,
	"size_bytes" integer,
	"source" varchar(16),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_icon_cache_hit_has_body" CHECK (("brand_icon_cache"."outcome" <> 'hit') OR ("brand_icon_cache"."body_base64" IS NOT NULL AND "brand_icon_cache"."content_type" IS NOT NULL AND "brand_icon_cache"."size_bytes" IS NOT NULL))
);
