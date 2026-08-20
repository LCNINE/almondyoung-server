/**
 * 파기 대상 판매주문을 고른다 — 상자가 이행하는 주문 전부다.
 *
 * 상자↔주문은 `shipment_lines → fulfillment_order_items → fulfillment_orders.sales_order_id`
 * 로만 확정할 수 있다. `shipments.opened_for_fulfillment_order_id` 는 합배송에서 비므로
 * 연결의 근거가 못 된다.
 *
 * - **중복 제거**: 한 주문의 여러 라인이 한 상자에 담기면 조인 결과에 같은 주문이 여러 번 나온다.
 * - **null 제외**: 판매주문 없이 만들어진 출고주문(수기 출고 등)은 지울 대상이 없다.
 * - **정렬**: 같은 주문 집합을 동시에 배송완료 처리하는 두 트랜잭션이 행 잠금을 같은
 *   순서로 잡게 한다. 이 파일 바로 위 `emitDeliveredProjections` 가 FO 잠금에 쓰는 것과 같은 이유다.
 */
export function purgeTargetSalesOrderIds(rows: { salesOrderId: string | null }[]): string[] {
  const ids = rows.map((row) => row.salesOrderId).filter((id): id is string => id !== null);
  return [...new Set(ids)].sort();
}
