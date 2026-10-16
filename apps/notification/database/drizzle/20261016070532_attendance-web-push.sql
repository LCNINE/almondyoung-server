CREATE TABLE "web_push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"subscription_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "web_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "web_push_deliveries" ADD CONSTRAINT "web_push_deliveries_subscription_id_web_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."web_push_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "web_push_delivery_key" ON "web_push_deliveries" USING btree ("key","subscription_id");--> statement-breakpoint
CREATE INDEX "web_push_subscription_user" ON "web_push_subscriptions" USING btree ("user_id");