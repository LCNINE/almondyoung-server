import type { ChannelDelta, QuantityCorrectionDelta } from '../channel-order-change/channel-order-change.types';
import type { CancelRequestLine } from './channel-cancel-request.types';

function isQuantityCorrection(delta: ChannelDelta): delta is QuantityCorrectionDelta {
  return delta.type === 'quantity_correction';
}

function takeRequested(
  lines: CancelRequestLine[],
  deltas: ChannelDelta[],
  sizeOf: (delta: QuantityCorrectionDelta) => number,
): { matched: true; rest: ChannelDelta[] } | { matched: false } {
  const taken = new Set<ChannelDelta>();
  for (const line of lines) {
    const hit = deltas.find(
      (delta) =>
        !taken.has(delta) &&
        isQuantityCorrection(delta) &&
        delta.salesOrderLineId === line.salesOrderLineId &&
        sizeOf(delta) === line.quantity,
    );
    if (!hit) return { matched: false };
    taken.add(hit);
  }
  return { matched: true, rest: deltas.filter((delta) => !taken.has(delta)) };
}

/**
 * 열린 부분취소 요청의 줄 ↔ 5번 diff 의 감소(스펙 §5.4). 요청 줄 «전부»가 정확히 같은 감소로 보일 때만 먹는다.
 * 하나라도 어긋나면 아무것도 먹지 않는다 — 그 델타는 5번 규칙을 타고, 요청은 settler 가 superseded 로 닫는다.
 */
export function takeRequestedDecreases(lines: CancelRequestLine[], deltas: ChannelDelta[]) {
  return takeRequested(lines, deltas, (d) => d.quantityBefore - d.correctedQuantity);
}

/**
 * 정산 중인 부분취소(core 는 확정 때 이미 줄였다) ↔ 아직 안 줄인 채널 스냅샷. 다른 변경(주소 등)이 수집되면 diff 가 요청분을
 * «늘어남»으로 본다 — 우리가 낸 감소의 거울이라 5번 규칙에 넘기지 않는다(#1016 36번 재설계 D10). 요청 줄 전부가 정확히 맞을 때만 먹는다.
 */
export function takeRequestedIncreases(lines: CancelRequestLine[], deltas: ChannelDelta[]) {
  return takeRequested(lines, deltas, (d) => d.correctedQuantity - d.quantityBefore);
}
