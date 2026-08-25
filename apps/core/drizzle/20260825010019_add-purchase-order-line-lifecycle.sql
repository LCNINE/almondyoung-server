CREATE TYPE "public"."po_line_status" AS ENUM('requested', 'ordered', 'unavailable');--> statement-breakpoint
ALTER TABLE "inbound_plan_items" ADD COLUMN "expected_date" date;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "status" "po_line_status" DEFAULT 'requested' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "ordered_qty" integer;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "expected_arrival" date;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "ordered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "ordered_by" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "unavailable_reason" text;--> statement-breakpoint
-- 이미 확정/입고된 발주의 라인은 실제로 발주된 것이다. 새 모델에서 'requested' 로
-- 남으면 파이프라인이 이미 들어온 물량을 "아직 주문 안 함" 으로 읽는다.
UPDATE "purchase_order_lines" l SET "status" = 'ordered', "ordered_qty" = l."quantity"
  FROM "purchase_orders" p
 WHERE p."id" = l."po_id" AND p."status" IN ('confirmed', 'received');--> statement-breakpoint
-- 라인 ETA 는 헤더에서 물려받는다. 헤더는 naive timestamp 라 날짜 부분만 취한다.
UPDATE "purchase_order_lines" l SET "expected_arrival" = p."expected_arrival"::date
  FROM "purchase_orders" p
 WHERE p."id" = l."po_id" AND p."expected_arrival" IS NOT NULL;