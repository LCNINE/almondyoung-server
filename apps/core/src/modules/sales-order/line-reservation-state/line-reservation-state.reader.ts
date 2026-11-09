import { and, asc, eq, gt, gte, inArray, isNotNull, notInArray } from 'drizzle-orm';
import type { SalesOrderLineReservationStatePayload } from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { readLineQuantities } from '../line-quantities/line-quantities.reader';
import { heldSalesUnits } from '../line-quantities/line-sales-units';

/**
 * 주문별 줄 예약 상태 스냅샷 (#1247) — Medusa 예약 투영이 «목표 = max(0, demand − heldUnits)» 를 계산할 사실만 싣는다.
 * 산술은 `readLineQuantities`·`heldSalesUnits` 가 한다 — 여기서는 모아 붙이기만 한다.
 * 없는 주문 id 는 결과에서 빠진다. 호출자 트랜잭션에서 읽는다(ADR-0025).
 */
export async function readLineReservationStates(
  trx: DbTx,
  salesOrderIds: readonly string[],
  asOf: Date,
): Promise<SalesOrderLineReservationStatePayload[]> {
  if (salesOrderIds.length === 0) return [];
  const so = wmsTables.salesOrders;
  const sol = wmsTables.salesOrderLines;
  const orders = await trx
    .select({
      id: so.id,
      salesChannel: so.salesChannel,
      channelOrderId: so.channelOrderId,
      orderDate: so.orderDate,
      version: so.lineStateVersion,
    })
    .from(so)
    .where(inArray(so.id, [...salesOrderIds]))
    .orderBy(asc(so.id));
  const lineRows = await trx
    .select({
      id: sol.id,
      salesOrderId: sol.salesOrderId,
      channelOrderItemId: sol.channelOrderItemId,
      variantId: sol.variantId,
    })
    .from(sol)
    .where(
      inArray(
        sol.salesOrderId,
        orders.map((order) => order.id),
      ),
    )
    .orderBy(asc(sol.id));

  const states: SalesOrderLineReservationStatePayload[] = [];
  for (const order of orders) {
    const quantities = await readLineQuantities(trx, order.id);
    const lines = lineRows
      .filter((row) => row.salesOrderId === order.id)
      .flatMap((row) => {
        const q = quantities.get(row.id);
        if (!q) return [];
        return [
          {
            salesOrderLineId: row.id,
            channelOrderItemId: row.channelOrderItemId,
            variantId: row.variantId,
            ordered: q.ordered,
            canceledBeforeShipment: q.canceledBeforeShipment,
            demand: q.demand,
            heldUnits: heldSalesUnits(q),
          },
        ];
      });
    states.push({
      salesOrderId: order.id,
      salesChannel: order.salesChannel,
      channelOrderId: order.channelOrderId,
      orderedAt: order.orderDate.toISOString(),
      version: order.version,
      asOf: asOf.toISOString(),
      lines,
    });
  }
  return states;
}

/** 채널의 줄 id → 주문 id. 그 채널에 없는 id 는 결과에 없다. */
export async function findOrderIdsByChannelOrderItemIds(
  trx: DbTx,
  salesChannel: SalesOrderLineReservationStatePayload['salesChannel'],
  channelOrderItemIds: readonly string[],
): Promise<Array<{ channelOrderItemId: string; salesOrderId: string }>> {
  if (channelOrderItemIds.length === 0) return [];
  const rows = await trx
    .select({
      channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
      salesOrderId: wmsTables.salesOrderLines.salesOrderId,
    })
    .from(wmsTables.salesOrderLines)
    .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.salesOrderLines.salesOrderId))
    .where(
      and(
        eq(wmsTables.salesOrders.salesChannel, salesChannel),
        inArray(wmsTables.salesOrderLines.channelOrderItemId, [...channelOrderItemIds]),
      ),
    );
  return rows.flatMap((row) =>
    row.channelOrderItemId === null
      ? []
      : [{ channelOrderItemId: row.channelOrderItemId, salesOrderId: row.salesOrderId }],
  );
}

/**
 * 투영 후보 줄 — 끝난 주문(취소·외부 출고·배송완료·타임아웃)을 빼고 `orderedAtOrAfter` 이후 주문의 채널 줄 id.
 * «목표 > 0» 의 상위 집합이다. 계산은 호출자가 한다. 줄 id 순 keyset 페이지.
 */
export async function readLineReservationCandidates(
  trx: DbTx,
  args: {
    salesChannel: SalesOrderLineReservationStatePayload['salesChannel'];
    orderedAtOrAfter: Date;
    afterLineId?: string;
    limit: number;
  },
): Promise<{ channelOrderItemIds: string[]; nextAfterLineId: string | null }> {
  const so = wmsTables.salesOrders;
  const sol = wmsTables.salesOrderLines;
  const rows = await trx
    .select({ id: sol.id, channelOrderItemId: sol.channelOrderItemId })
    .from(sol)
    .innerJoin(so, eq(so.id, sol.salesOrderId))
    .where(
      and(
        eq(so.salesChannel, args.salesChannel),
        notInArray(so.status, ['cancelled', 'shipped', 'delivered', 'timeout']),
        gte(so.orderDate, args.orderedAtOrAfter),
        isNotNull(sol.channelOrderItemId),
        args.afterLineId ? gt(sol.id, args.afterLineId) : undefined,
      ),
    )
    .orderBy(asc(sol.id))
    .limit(args.limit);
  return {
    channelOrderItemIds: rows.flatMap((row) => (row.channelOrderItemId === null ? [] : [row.channelOrderItemId])),
    nextAfterLineId: rows.length === args.limit ? rows[rows.length - 1].id : null,
  };
}
