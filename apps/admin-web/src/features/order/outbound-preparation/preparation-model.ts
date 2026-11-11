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

type LineQuantity = { qty: number; reservedQty: number };

// «있는 것만 먼저 보내기»는 예약된 만큼을 지금 보낼 상자에 남기고 나머지를 기다릴 상자로 옮긴다.
export function splitQuantities(lines: LineQuantity[]): {
  now: number;
  wait: number;
} {
  return lines.reduce(
    (total, line) => ({
      now: total.now + line.reservedQty,
      wait: total.wait + Math.max(0, line.qty - line.reservedQty),
    }),
    { now: 0, wait: 0 }
  );
}

export function lineSplitText(line: LineQuantity): string {
  const { now, wait } = splitQuantities([line]);

  return `주문 ${line.qty} · 지금 보낼 ${now} · 기다릴 ${wait}`;
}
