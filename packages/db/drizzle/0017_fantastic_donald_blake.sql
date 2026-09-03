CREATE TYPE "public"."invoice_delivery_status" AS ENUM('queued', 'sent', 'delivered', 'bounced', 'failed');--> statement-breakpoint
ALTER TYPE "public"."activity_kind" ADD VALUE 'invoice_sent';--> statement-breakpoint
CREATE TABLE "invoice_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"to_email" varchar(255) NOT NULL,
	"from_email" varchar(255) NOT NULL,
	"reply_to_email" varchar(255) NOT NULL,
	"subject_snapshot" text NOT NULL,
	"text_snapshot" text NOT NULL,
	"html_snapshot" text,
	"public_token" text NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"status" "invoice_delivery_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_deliveries" ADD CONSTRAINT "invoice_deliveries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_deliveries_invoice_attempt_idx" ON "invoice_deliveries" USING btree ("invoice_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_deliveries_public_token_idx" ON "invoice_deliveries" USING btree ("public_token");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_deliveries_idempotency_key_idx" ON "invoice_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "invoice_deliveries_provider_message_id_idx" ON "invoice_deliveries" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "invoice_deliveries_invoice_idx" ON "invoice_deliveries" USING btree ("invoice_id");