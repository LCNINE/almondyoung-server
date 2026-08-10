CREATE TABLE "site_popups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"content_type" varchar(20) DEFAULT 'rich_text' NOT NULL,
	"content" text,
	"pc_image_file_id" uuid,
	"mobile_image_file_id" uuid,
	"image_alt" varchar(255),
	"link_url" text,
	"notice_id" uuid,
	"pc_width" integer,
	"pc_height" integer,
	"mobile_width" integer,
	"mobile_height" integer,
	"placement" varchar(20) DEFAULT 'main' NOT NULL,
	"placement_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" varchar(20) DEFAULT 'all' NOT NULL,
	"dismiss_mode" varchar(10) DEFAULT 'today' NOT NULL,
	"dismiss_days" integer,
	"dismiss_version" integer DEFAULT 1 NOT NULL,
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
ALTER TABLE "site_popups" ADD CONSTRAINT "site_popups_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_site_popups_active" ON "site_popups" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_site_popups_display_period" ON "site_popups" USING btree ("display_start_at","display_end_at");--> statement-breakpoint
CREATE INDEX "idx_site_popups_deleted_at" ON "site_popups" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_site_popups_sort" ON "site_popups" USING btree ("sort_order","created_at");