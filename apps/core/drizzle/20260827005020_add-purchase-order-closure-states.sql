ALTER TYPE "public"."inbound_status" ADD VALUE 'short_closed';--> statement-breakpoint
ALTER TYPE "public"."po_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "inbound_plan_items" ADD COLUMN "closed_reason" text;--> statement-breakpoint
ALTER TABLE "inbound_plan_items" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_plan_items" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "cancelled_reason" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
-- 이미 전량 입고된 계획을 닫는다. 아이템이 0개인 계획은 제외한다 —
-- 계획 생성과 첫 아이템 추가 사이의 과도 상태를 종결로 오해하면 안 된다.
UPDATE "inbound_plans" p
SET "status" = 'confirmed'
WHERE p."status" = 'pending'
  AND EXISTS (SELECT 1 FROM "inbound_plan_items" i WHERE i."plan_id" = p."id")
  AND NOT EXISTS (
    SELECT 1 FROM "inbound_plan_items" i
    WHERE i."plan_id" = p."id" AND i."status" = 'pending'
  );--> statement-breakpoint
-- 그 계획에 딸린 발주를 종결한다. requested 라인이 남았으면 아직 살 것이 남았다.
UPDATE "purchase_orders" po
SET "status" = 'received'
WHERE po."status" = 'confirmed'
  AND NOT EXISTS (
    SELECT 1 FROM "purchase_order_lines" l
    WHERE l."po_id" = po."id" AND l."status" = 'requested'
  )
  AND EXISTS (
    SELECT 1 FROM "inbound_plans" p
    WHERE p."linked_purchase_order_id" = po."id" AND p."status" = 'confirmed'
  );