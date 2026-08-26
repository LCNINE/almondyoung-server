-- 계획 날짜를 아이템으로 내린다. 아이템이 예정일을 갖지 않은 행(2단계 이전에 만들어진
-- 계획, 수동 생성 계획)이 컬럼과 함께 날짜를 통째로 잃지 않게 한다.
UPDATE "inbound_plan_items" i SET "expected_date" = p."expected_date"::date
  FROM "inbound_plans" p
 WHERE p."id" = i."plan_id" AND i."expected_date" IS NULL AND p."expected_date" IS NOT NULL;--> statement-breakpoint
-- 헤더 ETA 를 라인으로 내린다. 2단계 백필과 같은 문장이고 멱등하다 — 그 이후 생성된
-- 발주(헤더에만 날짜가 있는 행)를 받아낸다.
UPDATE "purchase_order_lines" l SET "expected_arrival" = p."expected_arrival"::date
  FROM "purchase_orders" p
 WHERE p."id" = l."po_id" AND l."expected_arrival" IS NULL AND p."expected_arrival" IS NOT NULL;--> statement-breakpoint
DROP INDEX "idx_inbound_plans_wh_date";--> statement-breakpoint
DROP INDEX "idx_inbound_plans_destination";--> statement-breakpoint
CREATE INDEX "idx_inbound_plan_items_expected_date" ON "inbound_plan_items" USING btree ("expected_date");--> statement-breakpoint
CREATE INDEX "idx_inbound_plans_destination" ON "inbound_plans" USING btree ("destination_warehouse_id");--> statement-breakpoint
ALTER TABLE "inbound_plans" DROP COLUMN "expected_date";--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP COLUMN "expected_arrival";