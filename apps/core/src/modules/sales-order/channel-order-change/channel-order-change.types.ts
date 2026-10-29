import type { OrderModifiedPayload, ShippingAddress } from '@packages/event-contracts/streams';

export type ChannelOrderSnapshot = OrderModifiedPayload['snapshot'];

export const CHANNEL_ORDER_MODIFIED_REASON = 'CHANNEL_ORDER_MODIFIED';

export type ChannelBlockerCode =
  | 'WAYBILL_ISSUED'
  | 'SHIPMENT_IN_BATCH'
  | 'SHIPMENT_NOT_REVISABLE'
  | 'CONSOLIDATED_SHIPMENT'
  | 'RECIPIENT_INCOMPLETE'
  | 'CANCEL_NOT_IMMEDIATE'
  | 'ALL_LINES_REMOVED'
  | 'LINE_IDENTITY_MISSING'
  | 'OUT_OF_SCOPE';

export interface ChannelBlocker {
  code: ChannelBlockerCode;
  shipmentId?: string;
  detail?: string;
}

export interface EffectiveSalesOrderLine {
  id: string;
  /**
   * 교환 줄이면 그 반품 줄 id(K8 PR11). 교환 줄은 교환 사실로만 생기고 지워진다 — 채널 스냅샷과 비교하지 않는다(N18).
   * 정산 뒤 `channelOrderItemId` 에 Medusa 대체 품목 줄 id 가 이어져도 그 품목은 스냅샷 쪽에서도 뺀다.
   */
  exchangeReturnLineId: string | null;
  channelOrderItemId: string | null;
  channelProductId: string | null;
  /** 라인 수량 − 이미 취소된 수량 */
  effectiveQuantity: number;
  unitPrice: number | null;
}

export interface EffectiveSalesOrder {
  id: string;
  status: string;
  shippingAddress: ShippingAddress;
  lines: EffectiveSalesOrderLine[];
}

export interface ShippingAddressChangeDelta {
  type: 'shipping_address_change';
  before: ShippingAddress;
  after: ShippingAddress;
}
export interface QuantityCorrectionDelta {
  type: 'quantity_correction';
  salesOrderLineId: string;
  channelOrderItemId: string;
  quantityBefore: number;
  correctedQuantity: number;
}
export interface AddProductDelta {
  type: 'add_product';
  channelOrderItemId: string;
  channelProductId: string | null;
  quantity: number;
  unitPrice: number;
}
export interface ReplaceProductDelta {
  type: 'replace_product';
  salesOrderLineId: string;
  channelOrderItemId: string;
  channelProductIdBefore: string;
  channelProductIdAfter: string;
}
export interface AmountCorrectionDelta {
  type: 'amount_correction';
  salesOrderLineId: string;
  channelOrderItemId: string;
  unitPriceBefore: number;
  unitPriceAfter: number;
}
/** 어느 한쪽에 채널 라인 id 가 없어 짝을 못 지은 라인. 항상 pending(LINE_IDENTITY_MISSING). */
export interface UnmatchedLineDelta {
  type: 'unmatched_line';
  salesOrderLineId: string | null;
  quantity: number;
}

export type ChannelDelta =
  | ShippingAddressChangeDelta
  | QuantityCorrectionDelta
  | AddProductDelta
  | ReplaceProductDelta
  | AmountCorrectionDelta
  | UnmatchedLineDelta;

export type ChannelDeltaOutcome = { outcome: 'applied' } | { outcome: 'pending'; blockers: ChannelBlocker[] };

export type RecordedChannelDelta = ChannelDelta & ChannelDeltaOutcome;
