CREATE TYPE "public"."logo_contest_entry_status" AS ENUM('active', 'hidden');--> statement-breakpoint
CREATE TABLE "logo_contest_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"author_name" varchar(100) NOT NULL,
	"title" varchar(30) NOT NULL,
	"description" varchar(500),
	"status" "logo_contest_entry_status" DEFAULT 'active' NOT NULL,
	"is_winner" boolean DEFAULT false NOT NULL,
	"agreed_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logo_contest_entry_media" (
	"entry_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "logo_contest_entry_media_pkey" PRIMARY KEY("entry_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "logo_contest_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "logo_contest_entry_media" ADD CONSTRAINT "logo_contest_entry_media_entry_id_logo_contest_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."logo_contest_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logo_contest_votes" ADD CONSTRAINT "logo_contest_votes_entry_id_logo_contest_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."logo_contest_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "logo_contest_entries_user_unique" ON "logo_contest_entries" USING btree ("user_id") WHERE "logo_contest_entries"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "logo_contest_entries_winner_unique" ON "logo_contest_entries" USING btree ("is_winner") WHERE "logo_contest_entries"."is_winner" = true;--> statement-breakpoint
CREATE INDEX "logo_contest_entries_visible_created" ON "logo_contest_entries" USING btree ("created_at") WHERE "logo_contest_entries"."status" = 'active' AND "logo_contest_entries"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "logo_contest_entry_media_order_unique" ON "logo_contest_entry_media" USING btree ("entry_id","order");--> statement-breakpoint
CREATE INDEX "logo_contest_entry_media_entry_id" ON "logo_contest_entry_media" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "logo_contest_votes_user_unique" ON "logo_contest_votes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "logo_contest_votes_entry" ON "logo_contest_votes" USING btree ("entry_id");