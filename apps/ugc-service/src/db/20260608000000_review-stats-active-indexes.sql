CREATE INDEX IF NOT EXISTS "reviews_active_product_rating"
  ON "reviews" USING btree ("product_id", "rating")
  WHERE "status" = 'active' AND "deleted_at" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "reviews_active_rating"
  ON "reviews" USING btree ("rating")
  WHERE "status" = 'active' AND "deleted_at" IS NULL;
