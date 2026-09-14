CREATE TABLE "purchase_order_receipt_lines" (
	"po_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"receipt_line_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP VIEW "public"."stock_summary_view";--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "received_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "closed_reason" text;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_receipt_lines" ADD CONSTRAINT "purchase_order_receipt_lines_receipt_line_id_inbound_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."inbound_receipt_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_receipt_lines" ADD CONSTRAINT "fk_po_receipt_lines_line" FOREIGN KEY ("po_id","sku_id") REFERENCES "public"."purchase_order_lines"("po_id","sku_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_po_receipt_lines_line" ON "purchase_order_receipt_lines" USING btree ("po_id","sku_id");--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "ck_po_lines_received" CHECK ("purchase_order_lines"."received_qty" >= 0 AND "purchase_order_lines"."received_qty" <= COALESCE("purchase_order_lines"."ordered_qty", 0));--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "ck_po_lines_closed" CHECK ("purchase_order_lines"."closed_at" IS NULL OR "purchase_order_lines"."status" = 'ordered');--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "ck_po_lines_ordered_qty" CHECK (("purchase_order_lines"."status" = 'ordered') = ("purchase_order_lines"."ordered_qty" IS NOT NULL));--> statement-breakpoint
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
        -- 사내 이동만으로 전사 판매가능수량이 줄고, 옛 inbound_plan_items 기반이었을 때 실제 이동
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
        -- 입고예정 = 남은 수량이 있는 실발주 라인(스펙 §5.1). 출발 창고(source_warehouse_id) 기준이다.
        -- 술어는 procurement/services/purchase-order-outstanding.sql.ts 와 같은 식이어야 한다 —
        -- 파리티는 expected-arrivals-parity.integration.spec.ts 가 고정한다. COALESCE: CHECK 처럼 NULL 을 통과시키지 않기 위해.
        SELECT pol.sku_id, po.source_warehouse_id AS warehouse_id,
               SUM(COALESCE(pol.ordered_qty, 0) - pol.received_qty) as qty
        FROM purchase_order_lines pol
        INNER JOIN purchase_orders po ON po.id = pol.po_id
        WHERE pol.status = 'ordered'
          AND pol.closed_at IS NULL
          AND pol.received_qty < COALESCE(pol.ordered_qty, 0)
          AND po.status::text <> 'cancelled'
        GROUP BY pol.sku_id, po.source_warehouse_id
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