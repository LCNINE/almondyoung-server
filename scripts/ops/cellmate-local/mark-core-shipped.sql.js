// mark-core-shipped.js 가 core DB 에 보내는 UPDATE 셋. 파라미터 $1::text[] = channel_order_id 목록(Medusa order id).
// FO·FOI 는 취소된 것을 출고로 덮지 않는다(K6 F12): 취소 FO 는 건너뛰고, FOI 는 취소 수량을 뺀 만큼만 출고로 채운다
// (제약 shipped_qty + canceled_qty <= qty).

const MARK_SALES_ORDERS_SHIPPED = `update sales_orders set status='shipped',updated_at=now() where channel_order_id=any($1::text[]) and status='pending'`;

const MARK_FULFILLMENT_ORDERS_SHIPPED = `update fulfillment_orders set status='shipped',shipped_at=coalesce(shipped_at,now()),updated_at=now() where sales_order_id in(select id from sales_orders where channel_order_id=any($1::text[])) and status not in('shipped','canceled')`;

const MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED = `update fulfillment_order_items set shipped_qty=qty-canceled_qty,status='shipped',updated_at=now() where fulfillment_order_id in(select fo.id from fulfillment_orders fo join sales_orders so on so.id=fo.sales_order_id where so.channel_order_id=any($1::text[]) and fo.status<>'canceled') and status<>'canceled' and shipped_qty<qty-canceled_qty`;

module.exports = { MARK_SALES_ORDERS_SHIPPED, MARK_FULFILLMENT_ORDERS_SHIPPED, MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED };
