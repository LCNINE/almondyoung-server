CREATE TYPE "public"."product_import_item_status" AS ENUM('created', 'failed');--> statement-breakpoint
CREATE TYPE "public"."product_import_session_status" AS ENUM('completed', 'archived');--> statement-breakpoint
CREATE TABLE "product_import_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"product_key" varchar(255),
	"status" "product_import_item_status" NOT NULL,
	"master_id" uuid,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_import_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"file_name" varchar(500),
	"uploaded_by" uuid,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" "product_import_session_status" DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"committed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "product_import_items" ADD CONSTRAINT "product_import_items_session_id_product_import_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."product_import_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_import_items_session" ON "product_import_items" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_import_sessions_uploaded_by" ON "product_import_sessions" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "idx_import_sessions_created_at" ON "product_import_sessions" USING btree ("created_at");