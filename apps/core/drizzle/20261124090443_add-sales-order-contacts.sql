CREATE TABLE "sales_order_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"follow_up_on" date,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_sales_order_contacts_order" ON "sales_order_contacts" USING btree ("sales_order_id","created_at");