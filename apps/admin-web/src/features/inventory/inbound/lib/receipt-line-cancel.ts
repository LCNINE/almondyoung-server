import type { InboundReceiptLineDto } from '@/lib/types/dto/inventory';

export type ReceiptLineCancelRoute = 'purchase_order' | 'direct' | 'inbound_shipment';

/** 입고 라인의 취소가 어느 길로 가는지. 선적 입고는 이 화면에서 취소하지 않는다(core 가 409). */
export function receiptLineCancelRoute(
  source: InboundReceiptLineDto['source'] | null | undefined
): ReceiptLineCancelRoute {
  if (source === 'purchase_order') return 'purchase_order';
  if (source === 'inbound_shipment') return 'inbound_shipment';
  return 'direct';
}

export const INBOUND_SHIPMENT_SOURCE_LABEL = '선적 입고';
export const INBOUND_SHIPMENT_CANCEL_NOTICE =
  '선적 입고는 물류 앱의 선적 상자 화면에서 취소해요';
