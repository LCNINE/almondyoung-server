import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { sql, type SQL } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { salesOrderContacts, type OrderContactOutcome } from '../../customer-service/schema/customer-service.schema';
import { kstDateOf } from '../../inventory/replenishment/demand/calendar';
import {
  orderFulfillmentPhaseSql,
  type OrderShipmentPhase,
} from '../../sales-order/line-quantities/order-fulfillment-phase.sql';

export type OrderLastContact = {
  outcome: OrderContactOutcome;
  authorId: string;
  at: string;
  /** 다시 연락할 날(YYYY-MM-DD). 가장 최근 기록의 것만 유효하다 */
  followUpOn: string | null;
};

/** 줄에서 전화를 걸지 말지 정할 만큼의 정보 */
export type OrderCsBrief = {
  customerPhone: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  totalAmount: number | null;
  firstItemName: string | null;
  firstItemQty: number | null;
  itemCount: number;
  hasMemo: boolean;
  lastContact: OrderLastContact | null;
};

export type OrderCsBox = {
  shipmentId: string;
  fulfillmentOrderId: string;
  status: string;
  carrier: string | null;
  trackingNo: string | null;
  shippedAt: string | null;
};

export type OrderCsOtherOrder = {
  salesOrderId: string;
  orderNo: string;
  channelOrderId: string;
  salesChannel: string;
  orderedAt: string;
  totalAmount: number | null;
  phase: OrderShipmentPhase;
  /** 같은 배송지(주소 해시)로 온 주문 */
  sameAddress: boolean;
  /** 'customer' 같은 회원 · 'phone' 회원은 다르거나 없고 주문자 연락처가 같다 */
  matchedBy: 'customer' | 'phone';
};

export type OrderCsContext = { boxes: OrderCsBox[]; otherOrders: OrderCsOtherOrder[]; moreOtherOrders: boolean };

const OTHER_ORDERS = 10;

const isoSql = (expr: SQL) => sql`to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** 같은 고객의 근거로 쓸 번호 — 마켓 안심번호(050…)는 다른 사람에게 다시 쓰이고, 010-0000-0000 처럼 채워 넣은 번호는 남과 겹친다 */
const ownPhoneSql = (expr: SQL) => sql`(
  CASE WHEN length(regexp_replace(coalesce(${expr}, ''), '\\D', '', 'g')) >= 9
        AND regexp_replace(${expr}, '\\D', '', 'g') NOT LIKE '050%'
        AND regexp_replace(${expr}, '\\D', '', 'g') !~ '(\\d)\\1{7}$'
       THEN regexp_replace(${expr}, '\\D', '', 'g') END)`;

/** 가장 최근 연락 기록에 적힌 «다시 연락할 날»이 오늘(한국)이거나 지났다 */
export const followUpDueSql = (salesOrderId: SQL, now: Date) => sql`(
  SELECT c.follow_up_on FROM ${salesOrderContacts} c WHERE c.sales_order_id = ${salesOrderId}
   ORDER BY c.created_at DESC, c.id DESC LIMIT 1
) <= ${kstDateOf(now)}::date`;

/** 정체 보드에서 CS 를 하려고 읽는 것 — 판정과 무관하다. 원천 테이블을 읽기만 한다. */
@Injectable()
export class OrderCsReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async briefs(salesOrderIds: string[], tx?: DbTx): Promise<Map<string, OrderCsBrief>> {
    if (salesOrderIds.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const ids = sql.join(
        salesOrderIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const result = await trx.execute(sql`
        SELECT so.id, so.customer_phone, so.total_amount,
               so.shipping_address->>'recipientName' AS recipient_name,
               so.shipping_address->>'phone' AS recipient_phone,
               coalesce(btrim(so.memo), '') <> '' AS has_memo,
               items.item_count, items.first_name, items.first_qty,
               contact.outcome, contact.author_id, contact.at, contact.follow_up_on
          FROM ${wmsTables.salesOrders} so
          LEFT JOIN LATERAL (
            SELECT count(*)::int AS item_count,
                   (array_agg(l.product_name ORDER BY l.created_at, l.id))[1] AS first_name,
                   (array_agg(l.quantity ORDER BY l.created_at, l.id))[1] AS first_qty
              FROM ${wmsTables.salesOrderLines} l WHERE l.sales_order_id = so.id
          ) items ON true
          LEFT JOIN LATERAL (
            SELECT c.outcome, c.author_id, ${isoSql(sql`c.created_at`)} AS at,
                   to_char(c.follow_up_on, 'YYYY-MM-DD') AS follow_up_on
              FROM ${salesOrderContacts} c WHERE c.sales_order_id = so.id
             ORDER BY c.created_at DESC, c.id DESC LIMIT 1
          ) contact ON true
         WHERE so.id IN (${ids})
      `);
      // execute() 원시 결과 타이핑 — order-progress.reader.ts 와 같은 문서화된 캐스트
      const rows = result as unknown as BriefRow[];
      return new Map(
        rows.map((r) => [
          r.id,
          {
            customerPhone: r.customer_phone,
            recipientName: r.recipient_name,
            recipientPhone: r.recipient_phone,
            totalAmount: r.total_amount,
            firstItemName: r.first_name,
            firstItemQty: r.first_qty,
            itemCount: r.item_count,
            hasMemo: r.has_memo,
            lastContact:
              r.outcome && r.author_id && r.at
                ? { outcome: r.outcome, authorId: r.author_id, at: r.at, followUpOn: r.follow_up_on }
                : null,
          },
        ]),
      );
    }, tx);
  }

  async context(salesOrderId: string, tx?: DbTx): Promise<OrderCsContext> {
    return this.dbService.run(async (trx) => {
      const boxRows = (await trx.execute(sql`
        SELECT s.id AS shipment_id, box.fulfillment_order_id, s.status::text AS status,
               w.carrier, w.tracking_no, ${isoSql(sql`s.shipped_at`)} AS shipped_at
          FROM (
            SELECT DISTINCT sl.shipment_id, fo.id AS fulfillment_order_id
              FROM ${wmsTables.fulfillmentOrders} fo
              JOIN ${wmsTables.fulfillmentOrderItems} foi ON foi.fulfillment_order_id = fo.id
              JOIN ${wmsTables.shipmentLines} sl ON sl.fulfillment_order_item_id = foi.id
             WHERE fo.sales_order_id = ${salesOrderId}::uuid
          ) box
          JOIN ${wmsTables.shipments} s ON s.id = box.shipment_id AND s.status <> 'superseded'
          LEFT JOIN LATERAL (
            SELECT wb.carrier::text AS carrier, wb.tracking_no
              FROM ${wmsTables.waybills} wb
             WHERE wb.shipment_id = s.id AND wb.status NOT IN ('voided', 'failed', 'abandoned')
             LIMIT 1
          ) w ON true
         ORDER BY s.opened_at, s.id
      `)) as unknown as BoxRow[];

      const [order] = (await trx.execute(sql`
        SELECT id FROM ${wmsTables.salesOrders} WHERE id = ${salesOrderId}::uuid
      `)) as unknown as { id: string }[];
      if (!order) throw new NotFoundError(`Sales order not found: ${salesOrderId}`);

      const otherRows = (await trx.execute(sql`
        WITH me AS (
          SELECT so.id, so.customer_id, so.shipping_address_hash, ${ownPhoneSql(sql`so.customer_phone`)} AS phone
            FROM ${wmsTables.salesOrders} so WHERE so.id = ${salesOrderId}::uuid
        ),
        hit AS (
          SELECT o.id, o.display_order_no, o.channel_order_id, o.sales_channel, o.order_date, o.total_amount,
                 coalesce(o.shipping_address_hash = me.shipping_address_hash, false) AS same_address,
                 coalesce(o.customer_id = me.customer_id, false) AS same_customer
            FROM ${wmsTables.salesOrders} o CROSS JOIN me
           WHERE o.id <> me.id
             AND (o.customer_id = me.customer_id OR ${ownPhoneSql(sql`o.customer_phone`)} = me.phone)
           ORDER BY o.order_date DESC, o.id DESC
           LIMIT ${OTHER_ORDERS + 1}
        )
        SELECT hit.id, hit.display_order_no, hit.channel_order_id, hit.sales_channel::text AS sales_channel,
               ${isoSql(sql`hit.order_date`)} AS ordered_at, hit.total_amount, hit.same_address, hit.same_customer,
               phase.admin_phase
          FROM hit
          JOIN (${orderFulfillmentPhaseSql(sql`SELECT id FROM hit`)}) phase ON phase.sales_order_id = hit.id
         ORDER BY hit.order_date DESC, hit.id DESC
      `)) as unknown as OtherRow[];

      return {
        boxes: boxRows.map((r) => ({
          shipmentId: r.shipment_id,
          fulfillmentOrderId: r.fulfillment_order_id,
          status: r.status,
          carrier: r.carrier,
          trackingNo: r.tracking_no,
          shippedAt: r.shipped_at,
        })),
        otherOrders: otherRows.slice(0, OTHER_ORDERS).map((r) => ({
          salesOrderId: r.id,
          orderNo: r.display_order_no ?? r.channel_order_id,
          channelOrderId: r.channel_order_id,
          salesChannel: r.sales_channel,
          orderedAt: r.ordered_at,
          totalAmount: r.total_amount,
          phase: r.admin_phase,
          sameAddress: r.same_address,
          matchedBy: r.same_customer ? 'customer' : 'phone',
        })),
        moreOtherOrders: otherRows.length > OTHER_ORDERS,
      };
    }, tx);
  }
}

type BriefRow = {
  id: string;
  customer_phone: string | null;
  total_amount: number | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  has_memo: boolean;
  item_count: number;
  first_name: string | null;
  first_qty: number | null;
  outcome: OrderContactOutcome | null;
  author_id: string | null;
  at: string | null;
  follow_up_on: string | null;
};
type BoxRow = {
  shipment_id: string;
  fulfillment_order_id: string;
  status: string;
  carrier: string | null;
  tracking_no: string | null;
  shipped_at: string | null;
};
type OtherRow = {
  id: string;
  display_order_no: string | null;
  channel_order_id: string;
  sales_channel: string;
  ordered_at: string;
  total_amount: number | null;
  same_address: boolean;
  same_customer: boolean;
  admin_phase: OrderShipmentPhase;
};
