ALTER TYPE "public"."fulfillment_status" ADD VALUE 'inspected' BEFORE 'invoiced';--> statement-breakpoint
CREATE TABLE "inspection_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"foi_id" uuid NOT NULL,
	"session_id" uuid,
	"type" varchar(32) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"qty" integer,
	"inspector_user_id" varchar(255),
	"photos" jsonb,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "inspection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"foi_id" uuid NOT NULL,
	"inspected_qty" integer DEFAULT 0 NOT NULL,
	"approved_qty" integer DEFAULT 0 NOT NULL,
	"rejected_qty" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"last_inspected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_inspection_items_session_foi" UNIQUE("session_id","foi_id")
);
--> statement-breakpoint
CREATE TABLE "inspection_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_order_id" uuid NOT NULL,
	"type" varchar(16) DEFAULT 'individual' NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"inspector_user_id" varchar(255),
	"total_items" integer DEFAULT 0 NOT NULL,
	"inspected_items" integer DEFAULT 0 NOT NULL,
	"completed_items" integer DEFAULT 0 NOT NULL,
	"issues" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_issues" ADD CONSTRAINT "inspection_issues_foi_id_fulfillment_order_items_id_fk" FOREIGN KEY ("foi_id") REFERENCES "public"."fulfillment_order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_issues" ADD CONSTRAINT "inspection_issues_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_session_id_inspection_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."inspection_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_foi_id_fulfillment_order_items_id_fk" FOREIGN KEY ("foi_id") REFERENCES "public"."fulfillment_order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_sessions" ADD CONSTRAINT "inspection_sessions_fulfillment_order_id_fulfillment_orders_id_fk" FOREIGN KEY ("fulfillment_order_id") REFERENCES "public"."fulfillment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_inspection_issues_foi" ON "inspection_issues" USING btree ("foi_id");--> statement-breakpoint
CREATE INDEX "idx_inspection_issues_session" ON "inspection_issues" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_inspection_items_session" ON "inspection_items" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_inspection_items_foi" ON "inspection_items" USING btree ("foi_id");--> statement-breakpoint
CREATE INDEX "idx_inspection_sessions_fo" ON "inspection_sessions" USING btree ("fulfillment_order_id");--> statement-breakpoint
CREATE INDEX "idx_inspection_sessions_status" ON "inspection_sessions" USING btree ("status");