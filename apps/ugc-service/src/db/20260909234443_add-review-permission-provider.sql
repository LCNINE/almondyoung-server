DROP INDEX "review_eligibilities_order_line_unique";--> statement-breakpoint
ALTER TABLE "review_eligibilities" ALTER COLUMN "order_line_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "review_eligibilities" ADD COLUMN "provider" varchar(20) DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_eligibilities" ADD COLUMN "batch_id" varchar(64);--> statement-breakpoint
ALTER TABLE "review_eligibilities" ADD COLUMN "granted_reason" varchar(255);--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "review_permission_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_review_permission_id_review_eligibilities_id_fk" FOREIGN KEY ("review_permission_id") REFERENCES "public"."review_eligibilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_eligibilities_order_line_unique" ON "review_eligibilities" USING btree ("order_line_id") WHERE "review_eligibilities"."order_line_id" is not null;