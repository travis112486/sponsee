DROP INDEX "contracts_deal_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_deal_idx" ON "contracts" USING btree ("deal_id");