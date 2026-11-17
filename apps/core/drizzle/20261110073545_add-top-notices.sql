CREATE TABLE "top_notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"text" varchar(120) NOT NULL,
	"link_url" text,
	"display_start_at" timestamp,
	"display_end_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE INDEX "idx_top_notices_active" ON "top_notices" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_top_notices_display_period" ON "top_notices" USING btree ("display_start_at","display_end_at");--> statement-breakpoint
CREATE INDEX "idx_top_notices_deleted_at" ON "top_notices" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_top_notices_sort" ON "top_notices" USING btree ("sort_order","created_at");