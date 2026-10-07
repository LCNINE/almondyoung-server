import type { ChannelDelta, QuantityCorrectionDelta } from '../channel-order-change/channel-order-change.types';
import type { CancelRequestLine } from './channel-cancel-request.types';

function isQuantityCorrection(delta: ChannelDelta): delta is QuantityCorrectionDelta {
  return delta.type === 'quantity_correction';
}

/**
 * 열린 부분취소 요청의 줄 ↔ 5번 diff 의 감소(스펙 §5.4). 요청 줄 «전부»가 정확히 같은 감소로 보일 때만 먹는다.
 * 하나라도 어긋나면 아무것도 먹지 않는다 — 그 델타는 5번 규칙을 타고, 요청은 settler 가 superseded 로 닫는다.
 */
export function takeRequestedDecreases(
  lines: CancelRequestLine[],
  deltas: ChannelDelta[],
): { matched: true; rest: ChannelDelta[] } | { matched: false } {
  const taken = new Set<ChannelDelta>();
  for (const line of lines) {
    const hit = deltas.find(
      (delta) =>
        !taken.has(delta) &&
        isQuantityCorrection(delta) &&
        delta.salesOrderLineId === line.salesOrderLineId &&
        delta.quantityBefore - delta.correctedQuantity === line.quantity,
    );
    if (!hit) return { matched: false };
    taken.add(hit);
  }
  return { matched: true, rest: deltas.filter((delta) => !taken.has(delta)) };
}
