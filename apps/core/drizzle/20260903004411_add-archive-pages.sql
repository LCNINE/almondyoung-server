CREATE TABLE "archive_page_favorites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_archive_page_favorites" UNIQUE("page_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "archive_page_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"title" varchar(255) DEFAULT '' NOT NULL,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_markdown" text DEFAULT '' NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"space" varchar(16) DEFAULT 'team' NOT NULL,
	"owner_id" uuid,
	"title" varchar(255) DEFAULT '' NOT NULL,
	"icon" varchar(32),
	"cover_url" text,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_markdown" text DEFAULT '' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"sort_key" varchar(64) COLLATE "C" NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_archive_pages_space" CHECK ("archive_pages"."space" IN ('team', 'private')),
	CONSTRAINT "ck_archive_pages_owner" CHECK (("archive_pages"."space" = 'private') = ("archive_pages"."owner_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "archive_page_favorites" ADD CONSTRAINT "archive_page_favorites_page_id_archive_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."archive_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_page_versions" ADD CONSTRAINT "archive_page_versions_page_id_archive_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."archive_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_pages" ADD CONSTRAINT "archive_pages_parent_id_archive_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."archive_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_archive_page_favorites_user" ON "archive_page_favorites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_archive_page_versions_page" ON "archive_page_versions" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_archive_pages_parent" ON "archive_pages" USING btree ("parent_id","sort_key");--> statement-breakpoint
CREATE INDEX "idx_archive_pages_space_alive" ON "archive_pages" USING btree ("space","owner_id","sort_key") WHERE "archive_pages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_archive_pages_deleted_at" ON "archive_pages" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_archive_pages_updated_at" ON "archive_pages" USING btree ("updated_at");