CREATE TABLE "membership_arrears_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arrears_id" uuid NOT NULL,
	"user_id" varchar NOT NULL,
	"action" text NOT NULL,
	"amount_before" integer NOT NULL,
	"amount_after" integer NOT NULL,
	"reason" text NOT NULL,
	"admin_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_arrears_adjustments" ADD CONSTRAINT "membership_arrears_adjustments_arrears_id_membership_arrears_id_fk" FOREIGN KEY ("arrears_id") REFERENCES "public"."membership_arrears"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_membership_arrears_adjustments_arrears" ON "membership_arrears_adjustments" USING btree ("arrears_id");--> statement-breakpoint
CREATE INDEX "idx_membership_arrears_adjustments_user" ON "membership_arrears_adjustments" USING btree ("user_id");