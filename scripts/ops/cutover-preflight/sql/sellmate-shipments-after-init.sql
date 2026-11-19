-- 런북 §6-2: init 직후 셀메이트 상자 세기. core DB, 읽기 전용(sql.ts). 교환 상자까지 세어 넉넉히 센다.
WITH s AS (
  SELECT sh.id, sh.status,
         bool_or(h.sales_order_id IS NOT NULL) AS has_sellmate,
         bool_or(h.sales_order_id IS NULL) AS has_other
    FROM shipments sh
    JOIN shipment_lines sl ON sl.shipment_id = sh.id
    JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
    JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
    LEFT JOIN sellmate_handed_over_orders h ON h.sales_order_id = fo.sales_order_id
   WHERE sh.status IN ('draft', 'planned')
   GROUP BY sh.id, sh.status
)
SELECT count(*) FILTER (WHERE has_sellmate AND EXISTS (
         SELECT 1 FROM outbound_batch_work_items w
          WHERE w.shipment_id = s.id AND w.status NOT IN ('excluded', 'completed'))) AS in_batch,
       count(*) FILTER (WHERE has_sellmate AND status = 'planned') AS planned,
       count(*) FILTER (WHERE has_sellmate AND has_other) AS mixed
  FROM s;
