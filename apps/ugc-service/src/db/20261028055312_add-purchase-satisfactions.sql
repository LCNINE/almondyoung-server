CREATE TABLE "purchase_satisfactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" varchar(255) NOT NULL,
	"order_display_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"reasons" varchar(32)[] DEFAULT '{}'::varchar[] NOT NULL,
	"memo" varchar(300),
	"checked_at" timestamp,
	"checked_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ck_purchase_satisfactions_rating" CHECK ("purchase_satisfactions"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_satisfactions_order_id_unique" ON "purchase_satisfactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "purchase_satisfactions_updated_at" ON "purchase_satisfactions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "purchase_satisfactions_rating_checked" ON "purchase_satisfactions" USING btree ("rating","checked_at");