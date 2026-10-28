import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { deliveredParcelsSql } from '../line-quantities/line-quantities.sql';

/**
 * 반품 회수 접수에 필요한 본문 (K8 PR9, N3).
 * 회수지 = 반품 줄을 실은 «배송완료 상자 중 가장 늦게 배송완료된 것»의 주소 스냅샷(= 그 상자 운송장에 쓴 주소),
 * 원운송장 = 그 상자의 `used` 운송장(없으면 null). 품목 = 반품 줄마다 상품명 × 줄 수량.
 * 주소는 호출자가 한진 본문에만 싣는다 — 여기서도 로그하지 않는다.
 */
export type PickupSource =
  | {
      kind: 'ok';
      snapshot: unknown;
      originalWaybillNo: string | null;
      items: Array<{ name: string; quantity: number }>;
    }
  | { kind: 'no_delivered_shipment' };

type ShipmentRow = {
  shipment_id: string;
};

export async function readPickupSource(trx: DbTx, customerReturnId: string): Promise<PickupSource> {
  const t = wmsTables;
  // FOI 의 sales_order_line_id 는 varchar 라 반품 줄과는 ::text 로 잇는다
  const picked = await trx.execute<ShipmentRow>(sql`
    select parcel.shipment_id
      from (${deliveredParcelsSql(sql`select ${t.customerReturns.salesOrderId} from ${t.customerReturns} where ${t.customerReturns.id} = ${customerReturnId}`)}) as parcel
      join ${t.fulfillmentOrderItems} as pickup_foi on pickup_foi.id = parcel.fulfillment_order_item_id
      join ${t.customerReturnLines} as pickup_line
        on pickup_line.sales_order_line_id::text = pickup_foi.sales_order_line_id
       and pickup_line.customer_return_id = ${customerReturnId}
     order by parcel.delivered_at desc, parcel.shipment_id desc
     limit 1
  `);
  const shipmentId = picked[0]?.shipment_id;
  if (!shipmentId) return { kind: 'no_delivered_shipment' };

  const [shipment] = await trx
    .select({ snapshot: t.shipments.recipientSnapshot })
    .from(t.shipments)
    .where(eq(t.shipments.id, shipmentId));

  const [waybill] = await trx
    .select({ trackingNo: t.waybills.trackingNo })
    .from(t.waybills)
    .where(and(eq(t.waybills.shipmentId, shipmentId), eq(t.waybills.status, 'used')))
    .orderBy(desc(t.waybills.issuedAt))
    .limit(1);

  const items = await trx
    .select({ name: t.salesOrderLines.productName, quantity: t.customerReturnLines.quantity })
    .from(t.customerReturnLines)
    .innerJoin(t.salesOrderLines, eq(t.salesOrderLines.id, t.customerReturnLines.salesOrderLineId))
    .where(eq(t.customerReturnLines.customerReturnId, customerReturnId))
    .orderBy(asc(t.salesOrderLines.productName), asc(t.customerReturnLines.id));

  return {
    kind: 'ok',
    snapshot: shipment?.snapshot ?? null,
    originalWaybillNo: waybill?.trackingNo ?? null,
    items,
  };
}
