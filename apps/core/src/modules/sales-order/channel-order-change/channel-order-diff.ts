import type { ShippingAddress } from '@packages/event-contracts/streams';
import type {
  ChannelDelta,
  ChannelOrderSnapshot,
  EffectiveSalesOrder,
  QuantityCorrectionDelta,
} from './channel-order-change.types';

const REQUIRED_ADDRESS_FIELDS = ['recipientName', 'phone', 'postalCode', 'roadAddress', 'detailAddress'] as const;
const OPTIONAL_ADDRESS_FIELDS = ['deliveryNote', 'personalCustomsCode'] as const;
const ADDRESS_FIELDS = [...REQUIRED_ADDRESS_FIELDS, ...OPTIONAL_ADDRESS_FIELDS] as const;
const NOT_DIFFED_STATUSES = new Set(['cancelled', 'timeout']);

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 판매주문 jsonb(`convertShippingAddress` 결과)를 계약 모양으로 읽는다. 없는 선택 필드는 키를 만들지 않는다. */
export function toShippingAddress(value: unknown): ShippingAddress {
  const record = value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {};
  const address: ShippingAddress = {
    recipientName: text(record.recipientName),
    phone: text(record.phone),
    postalCode: text(record.postalCode),
    roadAddress: text(record.roadAddress),
    detailAddress: text(record.detailAddress),
  };
  for (const field of OPTIONAL_ADDRESS_FIELDS) {
    const optional = record[field];
    if (typeof optional === 'string') address[field] = optional;
  }
  return address;
}

function addressChanged(current: ShippingAddress, next: ShippingAddress): boolean {
  return ADDRESS_FIELDS.some((field) => (current[field] ?? '').trim() !== (next[field] ?? '').trim());
}

/**
 * 채널 스냅샷과 «지금 유효한» 판매주문의 차이 (스펙 §6). 판정(반영/대기)은 하지 않는다.
 * 비교하지 않는 것: 총액·할인(감소의 결과), 우리 쪽 식별·상품명(6번 행의 오탐), 공동현관 비밀번호.
 */
export function diffChannelSnapshot(order: EffectiveSalesOrder, snapshot: ChannelOrderSnapshot): ChannelDelta[] {
  if (NOT_DIFFED_STATUSES.has(order.status)) return [];
  const deltas: ChannelDelta[] = [];

  if (addressChanged(order.shippingAddress, snapshot.shippingAddress)) {
    deltas.push({ type: 'shipping_address_change', before: order.shippingAddress, after: toShippingAddress(snapshot.shippingAddress) });
  }

  // 채널이 취소로 표시한 라인은 lifecycle OrderCancelled 가 맡는다 — 여기서 또 줄이면 이중 차감이다.
  const cancelledItemIds = new Set(
    snapshot.lines.flatMap((line) => (line.cancelled && line.channelOrderItemId ? [line.channelOrderItemId] : [])),
  );
  const liveLines = snapshot.lines.filter((line) => !line.cancelled);
  const liveByItemId = new Map(
    liveLines.flatMap((line) => (line.channelOrderItemId ? [[line.channelOrderItemId, line] as const] : [])),
  );

  for (const line of order.lines) {
    if (!line.channelOrderItemId) {
      // Don't emit unmatched_line if already fully cancelled (effectiveQuantity === 0)
      if (line.effectiveQuantity > 0) {
        deltas.push({ type: 'unmatched_line', salesOrderLineId: line.id, quantity: line.effectiveQuantity });
      }
      continue;
    }
    if (cancelledItemIds.has(line.channelOrderItemId)) continue;
    const next = liveByItemId.get(line.channelOrderItemId);
    const nextQuantity = next?.quantity ?? 0;
    if (nextQuantity !== line.effectiveQuantity) {
      deltas.push({
        type: 'quantity_correction',
        salesOrderLineId: line.id,
        channelOrderItemId: line.channelOrderItemId,
        quantityBefore: line.effectiveQuantity,
        correctedQuantity: nextQuantity,
      });
    }
    if (!next) continue;
    // When snapshot quantity is 0, don't emit replace_product or amount_correction
    if (nextQuantity === 0) continue;
    if (line.channelProductId && next.channelProductId && line.channelProductId !== next.channelProductId) {
      deltas.push({
        type: 'replace_product',
        salesOrderLineId: line.id,
        channelOrderItemId: line.channelOrderItemId,
        channelProductIdBefore: line.channelProductId,
        channelProductIdAfter: next.channelProductId,
      });
    }
    if (line.unitPrice !== null && next.unitPrice !== line.unitPrice) {
      deltas.push({
        type: 'amount_correction',
        salesOrderLineId: line.id,
        channelOrderItemId: line.channelOrderItemId,
        unitPriceBefore: line.unitPrice,
        unitPriceAfter: next.unitPrice,
      });
    }
  }

  const knownItemIds = new Set(order.lines.flatMap((line) => (line.channelOrderItemId ? [line.channelOrderItemId] : [])));
  for (const next of liveLines) {
    if (!next.channelOrderItemId) {
      // Don't emit unmatched_line if snapshot line is already removed (quantity === 0)
      if (next.quantity > 0) {
        deltas.push({ type: 'unmatched_line', salesOrderLineId: null, quantity: next.quantity });
      }
      continue;
    }
    if (!knownItemIds.has(next.channelOrderItemId) && next.quantity > 0) {
      deltas.push({
        type: 'add_product',
        channelOrderItemId: next.channelOrderItemId,
        channelProductId: next.channelProductId,
        quantity: next.quantity,
        unitPrice: next.unitPrice,
      });
    }
  }
  return deltas;
}

export function isDecrease(delta: ChannelDelta): delta is QuantityCorrectionDelta {
  return delta.type === 'quantity_correction' && delta.correctedQuantity < delta.quantityBefore;
}

/** 감소를 다 적용하면 남는 수량 합이 0 인가. 추가 라인이나 미확인 라인이 있으면 거짓. */
export function removesAllLines(order: EffectiveSalesOrder, deltas: ChannelDelta[]): boolean {
  if (deltas.some((delta) => delta.type === 'add_product')) return false;
  // If there's an unmatched snapshot line (null-id with qty > 0), we can't remove all
  if (deltas.some((delta) => delta.type === 'unmatched_line' && delta.salesOrderLineId === null && delta.quantity > 0)) return false;
  const corrected = new Map(
    deltas.flatMap((delta) => (delta.type === 'quantity_correction' ? [[delta.salesOrderLineId, delta.correctedQuantity] as const] : [])),
  );
  const remaining = order.lines.reduce((sum, line) => sum + (corrected.get(line.id) ?? line.effectiveQuantity), 0);
  return remaining === 0 && order.lines.some((line) => line.effectiveQuantity > 0);
}
