DROP VIEW "public"."stock_summary_view";--> statement-breakpoint
CREATE VIEW "public"."stock_summary_view" AS (
    SELECT
        s.id as sku_id,
        w.id as warehouse_id,
        s.name as sku_name,
        w.name as warehouse_name,

        -- 물리적 재고
        COALESCE(on_hand.qty, 0) as on_hand_qty,
        COALESCE(defective.qty, 0) as defective_qty,
        COALESCE(in_transfer.qty, 0) as in_transfer_qty,

        -- 예약 상태
        COALESCE(reserved.qty, 0) as reserved_qty,
        -- 가용재고 = ON_HAND 합 − confirmed 예약 합 (ADR-0001).
        -- transit_out 을 다시 빼지 말 것: 출발 창고에서만 빠지고 도착 창고에 더해지지 않아
        -- 사내 이동만으로 전사 판매가능수량이 줄고, inbound_plan_items 기반이라 실제 이동
        -- (stock_journals)이 끝나도 줄지 않는다. 등가성은 view-parity.integration.spec.ts 가 고정한다.
        COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) as available_qty,

        -- 예정 상태
        COALESCE(inbound_pending.qty, 0) as inbound_pending_qty,
        0 as on_order_qty,
        COALESCE(transit_out.qty, 0) as transfer_pending_qty,

        -- 계산된 전망
        COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) + COALESCE(inbound_pending.qty, 0) as projected_available_qty,

        NOW() as last_calculated_at

    FROM skus s
    CROSS JOIN warehouses w
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(qty) as qty
        FROM stock_ledgers
        WHERE stock_state = 'ON_HAND'
        GROUP BY sku_id, warehouse_id
    ) on_hand ON s.id = on_hand.sku_id AND w.id = on_hand.warehouse_id
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(qty) as qty
        FROM stock_ledgers
        WHERE stock_state = 'DEFECTIVE'
        GROUP BY sku_id, warehouse_id
    ) defective ON s.id = defective.sku_id AND w.id = defective.warehouse_id
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(qty) as qty
        FROM stock_ledgers
        WHERE stock_state = 'IN_TRANSFER'
        GROUP BY sku_id, warehouse_id
    ) in_transfer ON s.id = in_transfer.sku_id AND w.id = in_transfer.warehouse_id
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(quantity) as qty
        FROM stock_reservations
        WHERE status = 'confirmed'
        GROUP BY sku_id, warehouse_id
    ) reserved ON s.id = reserved.sku_id AND w.id = reserved.warehouse_id
    LEFT JOIN (
        -- 그 창고에 실제로 입고될 예정 수량. destination_warehouse_id 로 집계하면
        -- source/destination 두 계획이 같은 창고에 잡혀 이중 계상된다.
        SELECT ipi.sku_id, ip.warehouse_id, SUM(ipi.expected_qty - ipi.received_qty) as qty
        FROM inbound_plan_items ipi
        INNER JOIN inbound_plans ip ON ipi.plan_id = ip.id
        WHERE ipi.status = 'pending'
        GROUP BY ipi.sku_id, ip.warehouse_id
    ) inbound_pending ON s.id = inbound_pending.sku_id AND w.id = inbound_pending.warehouse_id
    LEFT JOIN (
        -- 미도착 이동 잔량. 도착 창고 기준이다 — 옛 정의는 inbound_plan_items 를 읽어
        -- 출발 창고에 붙였고, 실제 이동 경로를 추적하지 못했다.
        SELECT tol.sku_id, tord.to_warehouse_id AS warehouse_id,
               SUM(tol.shipped_qty - tol.received_qty - tol.lost_qty) as qty
        FROM transfer_order_lines tol
        INNER JOIN transfer_orders tord ON tord.id = tol.transfer_order_id
        WHERE (tol.shipped_qty - tol.received_qty - tol.lost_qty) > 0
        GROUP BY tol.sku_id, tord.to_warehouse_id
    ) transit_out ON s.id = transit_out.sku_id AND w.id = transit_out.warehouse_id
);