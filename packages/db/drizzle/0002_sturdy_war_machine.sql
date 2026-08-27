ALTER TABLE "chase_events" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
