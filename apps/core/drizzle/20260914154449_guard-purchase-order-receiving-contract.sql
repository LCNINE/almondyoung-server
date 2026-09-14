SET LOCAL lock_timeout = '10s';--> statement-breakpoint
LOCK TABLE purchase_order_lines, purchase_order_receipt_lines, inbound_receipt_lines, inbound_work_logs, inbound_plans, inbound_plan_items IN SHARE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT ipi.id FROM inbound_plan_items ipi
    JOIN inbound_plans ip ON ip.id = ipi.plan_id
    LEFT JOIN purchase_order_lines pol ON pol.po_id = ip.linked_purchase_order_id AND pol.sku_id = ipi.sku_id
    WHERE pol.po_id IS NULL
  ) THEN
    RAISE EXCEPTION 'PR-C guard: 옛 입고예정 품목에 대응하는 발주 라인이 없습니다';
  END IF;

  IF EXISTS (
    SELECT irl.id FROM inbound_receipt_lines irl
    LEFT JOIN purchase_order_receipt_lines porl ON porl.receipt_line_id = irl.id
    WHERE irl.plan_item_id IS NOT NULL AND porl.receipt_line_id IS NULL
  ) THEN
    RAISE EXCEPTION 'PR-C guard: 옛 입고 회차 라인의 발주 링크가 누락되었습니다';
  END IF;

  IF EXISTS (
    SELECT pol.po_id, pol.sku_id FROM purchase_order_lines pol
    LEFT JOIN purchase_order_receipt_lines porl ON porl.po_id = pol.po_id AND porl.sku_id = pol.sku_id
    LEFT JOIN inbound_receipt_lines irl ON irl.id = porl.receipt_line_id
    GROUP BY pol.po_id, pol.sku_id, pol.received_qty
    HAVING pol.received_qty <> COALESCE(SUM(irl.quantity - irl.canceled_qty), 0)
  ) THEN
    RAISE EXCEPTION 'PR-C guard: 발주 받은 누계와 링크된 회차 라인 합계가 다릅니다';
  END IF;
END $$;
