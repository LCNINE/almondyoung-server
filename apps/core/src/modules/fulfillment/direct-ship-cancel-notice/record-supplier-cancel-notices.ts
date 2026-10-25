import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import type { ShipmentLineRow, ShipmentRow } from '../services/shipment-aggregate';
import type { SalesOrderCancellationOrigin } from './direct-ship-cancel-notice.types';

/**
 * 넘긴 입점사 상자의 라인을 줄였으면 입점사에 알릴 대기 행을 남긴다(K3 PR6, 스펙 §4.7). 입점사는 이미 시트를 받았으므로
 * 취소를 따로 알려야 한다. 상자 후 취소(`applyDraftCancellation`)가 FOI 를 줄이는 같은 tx 에서 부른다.
 *
 * 넘기지 않은 상자·창고 상자는 알릴 상대가 없다. «못 보냄»으로 보고된 라인은 입점사가 먼저 알려 온 것이라 남기지 않는다.
 * 판매주문·FO·라인은 상자가 아니라 라인에서 읽는다 — 되돌린 합포장 상자는 여러 주문을 담는다.
 * `canceled` 의 라인은 줄이기 전 값이어야 한다(사유 칸 판정).
 */
export async function recordSupplierCancelNotices(
  tx: DbTx,
  input: {
    origin: SalesOrderCancellationOrigin | null;
    shipment: ShipmentRow;
    canceled: ReadonlyArray<{ line: ShipmentLineRow; qty: number }>;
  },
): Promise<number> {
  const { shipment, origin } = input;
  const supplierId = shipment.supplierId;
  if (supplierId === null || shipment.supplierHandoffId === null) return 0;
  const notify = input.canceled.filter(({ line, qty }) => qty > 0 && line.unfulfillableReason === null);
  if (notify.length === 0) return 0;
  if (!origin) {
    throw new Error(
      `Handed-off supplier shipment ${shipment.id} lines were canceled without a sales order cancellation — cannot record partner cancel notice`,
    );
  }
  const rows = notify.map(({ line, qty }) => {
    if (!line.salesOrderId) {
      throw new Error(`Supplier shipment line ${line.id} in ${shipment.id} has no sales order`);
    }
    return {
      orderCancellationId: origin.orderCancellationId,
      salesOrderId: line.salesOrderId,
      fulfillmentOrderId: line.fulfillmentOrderId,
      fulfillmentOrderItemId: line.fulfillmentOrderItemId,
      supplierId,
      salesOrderLineId: line.salesOrderLineId,
      skuId: line.skuId,
      canceledQty: qty,
      cancellationScope: origin.scope,
    };
  });
  await tx.insert(wmsTables.directShipCancelNotices).values(rows);
  return rows.length;
}
