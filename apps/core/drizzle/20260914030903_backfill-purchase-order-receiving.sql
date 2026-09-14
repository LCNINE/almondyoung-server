-- PR-B 백필 (스펙 §11). 옛 행이 없으면 전부 no-op. 기존 enum 값만 쓴다(D9).
-- ⓪ 가드 — 백필이 결정적이지 않은 데이터면 요란하게 멈춘다. 사전 확인 쿼리 P1~P3 가 같은 조건이다.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "inbound_plan_items" ipi JOIN "inbound_plans" ip ON ip."id" = ipi."plan_id"
    GROUP BY ip."linked_purchase_order_id", ipi."sku_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'backfill guard: 한 발주·SKU 에 입고예정 품목이 둘 이상이다 — 사전 확인 쿼리 (P1) 로 행을 보고 사람이 정리할 것';
  END IF;
  IF EXISTS (SELECT 1 FROM "inbound_plans" WHERE "plan_type" = 'destination') THEN
    RAISE EXCEPTION 'backfill guard: destination 계획이 남아 있다 — 사전 확인 쿼리 (P2) 로 행을 보고 사람이 정리할 것';
  END IF;
  IF EXISTS (SELECT 1 FROM "purchase_order_lines" WHERE ("status" = 'ordered') <> ("ordered_qty" IS NOT NULL)) THEN
    RAISE EXCEPTION 'backfill guard: status 와 ordered_qty 가 어긋난 발주 라인이 있다 — 사전 확인 쿼리 (P3)';
  END IF;
END $$;--> statement-breakpoint
-- ① 옛 품목 → 발주 라인 정산 (⓪ 이 다중 매치를 막았으므로 결정적이다)
UPDATE "purchase_order_lines" pol
SET "received_qty"  = ipi."received_qty",
    "closed_reason" = ipi."closed_reason",
    "closed_at"     = ipi."closed_at",
    "closed_by"     = ipi."closed_by"
FROM "inbound_plan_items" ipi
JOIN "inbound_plans" ip ON ip."id" = ipi."plan_id"
WHERE pol."po_id" = ip."linked_purchase_order_id" AND pol."sku_id" = ipi."sku_id";--> statement-breakpoint
-- ② 옛 회차 링크 → 링크 테이블 + source
INSERT INTO "purchase_order_receipt_lines" ("po_id", "sku_id", "receipt_line_id")
SELECT ip."linked_purchase_order_id", ipi."sku_id", irl."id"
FROM "inbound_receipt_lines" irl
JOIN "inbound_plan_items" ipi ON ipi."id" = irl."plan_item_id"
JOIN "inbound_plans" ip ON ip."id" = ipi."plan_id";--> statement-breakpoint
UPDATE "inbound_receipt_lines" SET "source" = 'purchase_order' WHERE "plan_item_id" IS NOT NULL;--> statement-breakpoint
-- ③ 헤더를 새 규칙(§5.2)으로 재계산 — cancelled 는 건드리지 않는다
UPDATE "purchase_orders" po
SET "status" = CASE
  WHEN EXISTS (SELECT 1 FROM "purchase_order_lines" l
               WHERE l."po_id" = po."id" AND l."status" = 'requested') THEN 'created'
  WHEN EXISTS (SELECT 1 FROM "purchase_order_lines" l
               WHERE l."po_id" = po."id" AND l."status" = 'ordered')
   AND NOT EXISTS (SELECT 1 FROM "purchase_order_lines" l
                   WHERE l."po_id" = po."id" AND l."status" = 'ordered'
                     AND l."closed_at" IS NULL
                     AND l."received_qty" < COALESCE(l."ordered_qty", 0)) THEN 'received'
  ELSE 'confirmed'
END::po_status
WHERE po."status"::text <> 'cancelled';
--> statement-breakpoint
-- 이전 모델의 orphan 또는 stale cache를 조용히 옮기지 않는다. PR-C 확인 쿼리 3종.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM inbound_plan_items ipi
    JOIN inbound_plans ip ON ip.id = ipi.plan_id
    LEFT JOIN purchase_order_lines pol ON pol.po_id = ip.linked_purchase_order_id AND pol.sku_id = ipi.sku_id
    WHERE pol.po_id IS NULL
  ) THEN
    RAISE EXCEPTION 'backfill parity guard: 옛 입고예정 품목에 대응하는 발주 라인이 없습니다';
  END IF;
  IF EXISTS (
    SELECT 1 FROM inbound_receipt_lines irl
    LEFT JOIN purchase_order_receipt_lines porl ON porl.receipt_line_id = irl.id
    WHERE irl.plan_item_id IS NOT NULL AND porl.receipt_line_id IS NULL
  ) THEN
    RAISE EXCEPTION 'backfill parity guard: 옛 입고 회차 라인의 발주 링크가 누락되었습니다';
  END IF;
  IF EXISTS (
    SELECT pol.po_id, pol.sku_id FROM purchase_order_lines pol
    LEFT JOIN purchase_order_receipt_lines porl ON porl.po_id = pol.po_id AND porl.sku_id = pol.sku_id
    LEFT JOIN inbound_receipt_lines irl ON irl.id = porl.receipt_line_id
    GROUP BY pol.po_id, pol.sku_id, pol.received_qty
    HAVING pol.received_qty <> COALESCE(SUM(irl.quantity - irl.canceled_qty), 0)
  ) THEN
    RAISE EXCEPTION 'backfill parity guard: 발주 받은 누계와 링크된 회차 라인 합계가 다릅니다';
  END IF;
END $$;
