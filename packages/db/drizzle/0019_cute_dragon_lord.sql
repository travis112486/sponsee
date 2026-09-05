CREATE TABLE "media_kit_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"media_kit_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_kit_examples_url_https" CHECK ("media_kit_examples"."url" LIKE 'https://%'),
	CONSTRAINT "media_kit_examples_position_nonnegative" CHECK ("media_kit_examples"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "media_kit_offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"media_kit_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"price_cents" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_kit_offerings_price_nonnegative" CHECK ("media_kit_offerings"."price_cents" >= 0),
	CONSTRAINT "media_kit_offerings_position_nonnegative" CHECK ("media_kit_offerings"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "media_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"headline" varchar(255),
	"bio" text,
	"accent_color" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_kit_examples" ADD CONSTRAINT "media_kit_examples_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_kit_examples" ADD CONSTRAINT "media_kit_examples_kit_creator_fk" FOREIGN KEY ("media_kit_id","creator_id") REFERENCES "public"."media_kits"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_kit_offerings" ADD CONSTRAINT "media_kit_offerings_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_kit_offerings" ADD CONSTRAINT "media_kit_offerings_kit_creator_fk" FOREIGN KEY ("media_kit_id","creator_id") REFERENCES "public"."media_kits"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_kits" ADD CONSTRAINT "media_kits_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_kit_examples_kit_position_idx" ON "media_kit_examples" USING btree ("media_kit_id","position");--> statement-breakpoint
CREATE INDEX "media_kit_examples_creator_idx" ON "media_kit_examples" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_kit_offerings_kit_position_idx" ON "media_kit_offerings" USING btree ("media_kit_id","position");--> statement-breakpoint
CREATE INDEX "media_kit_offerings_creator_idx" ON "media_kit_offerings" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_kits_creator_idx" ON "media_kits" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_kits_id_creator_idx" ON "media_kits" USING btree ("id","creator_id");