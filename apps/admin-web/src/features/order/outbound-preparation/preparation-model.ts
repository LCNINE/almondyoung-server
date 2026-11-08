import type { PlannedShipment } from '@/lib/types/dto/fulfillment';

// 한 번에 출고 준비하는 상자 수 상한. 서버 BulkShipmentIdsDto 의 ArrayMaxSize(100) 과 같아야 한다.
export const PREPARATION_BATCH_LIMIT = 100;

export function plannedOrderText(
  shipment: Pick<PlannedShipment, 'shipmentId' | 'orderNos'>
): string {
  if (shipment.orderNos.length === 0) {
    return `상자 ${shipment.shipmentId.slice(0, 8)}`;
  }

  return shipment.orderNos.map((no) => `#${no}`).join(', ');
}
