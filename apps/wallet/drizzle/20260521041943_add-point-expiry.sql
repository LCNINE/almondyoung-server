ALTER TABLE "point_events" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_point_events_expires_at" ON "point_events" USING btree ("expires_at");