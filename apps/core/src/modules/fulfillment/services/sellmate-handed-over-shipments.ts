/**
 * 셀메이트 상자 판정(#1412) — 컷오버 드레인 동안 셀메이트가 끝까지 내보내는 주문의 상자를 앱 출고 경로에서 뗀다.
 *
 * 경계는 «셀메이트에 넘긴 주문» 집합(`sellmate_handed_over_orders`, T 에 `evening-reconcile init` 이 한 번 쓴다)이다.
 * 시각으로 자르지 않는다 — 마지막 수집과 T 사이 주문, T 뒤 입금된 주문이 틀린다(2026-11-17 결정).
 *
 * 셀메이트 줄 = 넘긴 판매주문의 FO 에 속하고, 판매주문 줄이 교환 줄(`exchange_return_line_id`)이 아닌 줄.
 * 교환품은 같은 판매주문에 붙지만 앱이 보낸다. 판매주문 줄 참조가 비었거나 uuid 꼴이 아니면 셀메이트 줄로 본다(이중 출고보다 늦은 출고가 낫다).
 * 셀메이트 상자 = 셀메이트 줄이 하나라도 든 상자.
 *
 * 수명: 드레인 끝에 #1243 이 그 상자들을 닫으면 결과가 늘 비어 할 일이 없어진다. 2단계 정리 때 뺀다.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';

// 상자 확정·출고 준비 리더와 같은 꼴 — 판매주문 줄은 소문자 uuid 꼴만 기본키로 찾는다
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function loadSellmateShipmentIds(trx: DbTx, shipmentIds: readonly string[]): Promise<Set<string>> {
  if (shipmentIds.length === 0) {
    return new Set();
  }

  const candidates = await trx
    .select({
      shipmentId: wmsTables.shipmentLines.shipmentId,
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .innerJoin(
      wmsTables.sellmateHandedOverOrders,
      eq(wmsTables.sellmateHandedOverOrders.salesOrderId, wmsTables.fulfillmentOrders.salesOrderId),
    )
    .where(inArray(wmsTables.shipmentLines.shipmentId, [...shipmentIds]));

  if (candidates.length === 0) {
    return new Set();
  }

  // 출고 품목의 판매주문 줄 참조는 문자열이라 조인하면 인덱스를 못 쓴다 — 기본키로 따로 찾는다
  const lineIds = [
    ...new Set(
      candidates.flatMap(({ salesOrderLineId }) =>
        salesOrderLineId && UUID.test(salesOrderLineId) ? [salesOrderLineId] : [],
      ),
    ),
  ];
  const exchangeRows =
    lineIds.length === 0
      ? []
      : await trx
          .select({ id: wmsTables.salesOrderLines.id })
          .from(wmsTables.salesOrderLines)
          .where(
            and(
              inArray(wmsTables.salesOrderLines.id, lineIds),
              isNotNull(wmsTables.salesOrderLines.exchangeReturnLineId),
            ),
          );
  const exchangeLineIds = new Set(exchangeRows.map((row) => row.id));

  return new Set(
    candidates.flatMap(({ shipmentId, salesOrderLineId }) =>
      salesOrderLineId !== null && exchangeLineIds.has(salesOrderLineId) ? [] : [shipmentId],
    ),
  );
}
