ALTER TABLE "picking_plan_members" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "picking_plan_members" ADD COLUMN "retire_reason" text;--> statement-breakpoint
ALTER TABLE "picking_plan_members" ADD COLUMN "retired_by_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "picking_plan_members" ADD COLUMN "retired_by_operation_type" "shipment_operation_type";--> statement-breakpoint
ALTER TABLE "shipment_operations" ADD CONSTRAINT "uq_shipment_operations_id_type" UNIQUE("id","type");--> statement-breakpoint
ALTER TABLE "picking_plan_members" ADD CONSTRAINT "fk_picking_plan_member_retirement_operation" FOREIGN KEY ("retired_by_operation_id","retired_by_operation_type") REFERENCES "public"."shipment_operations"("id","type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_picking_plan_members_active_shipment" ON "picking_plan_members" USING btree ("shipment_id") WHERE "picking_plan_members"."retired_at" IS NULL;--> statement-breakpoint
ALTER TABLE "picking_plan_members" ADD CONSTRAINT "ck_picking_plan_member_retirement" CHECK ((
        "picking_plan_members"."retired_at" IS NULL
        AND "picking_plan_members"."retire_reason" IS NULL
        AND "picking_plan_members"."retired_by_operation_id" IS NULL
        AND "picking_plan_members"."retired_by_operation_type" IS NULL
      ) OR (
        "picking_plan_members"."retired_at" IS NOT NULL
        AND "picking_plan_members"."retire_reason" IS NOT NULL
        AND length(btrim("picking_plan_members"."retire_reason")) > 0
        AND "picking_plan_members"."retired_by_operation_id" IS NOT NULL
        AND "picking_plan_members"."retired_by_operation_type" IS NOT NULL
        AND "picking_plan_members"."retired_by_operation_type" = 'short_pick'
        AND "picking_plan_members"."retired_at" >= "picking_plan_members"."created_at"
      ));
