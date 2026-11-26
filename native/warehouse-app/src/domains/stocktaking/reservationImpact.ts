import type { AdjustmentPreview, ReservationImpact } from './types';

/** 실사 완료가 주문 예약에 주는 영향을 상품마다 한 문장으로 쓴다. */
export function reservationImpactLines(
  impact: readonly ReservationImpact[],
  preview: readonly AdjustmentPreview[]
): string[] {
  return impact.map((row) => {
    const name =
      preview.find((item) => item.skuId === row.skuId)?.skuName ?? '이 상품';
    const parts: string[] = [];
    if (row.quantity > 0)
      parts.push(
        `주문 ${row.orderCount}건이 잡아 둔 ${row.quantity}개를 놓아요. 그 주문은 재고가 들어오면 다시 잡아요.`
      );
    if (row.missingQty > 0) {
      const holders = row.heldBy
        .map((h) => `${h.orderNo ?? '주문번호 없음'} ${h.quantity}개`)
        .join(', ');
      parts.push(
        `출고 준비에 들어간 주문(${holders})은 예약을 놓지 못해 ${row.missingQty}개가 모자라요. 관리자 출고 준비에서 그 주문을 배치에서 빼거나 피킹 때 결품으로 처리해 주세요.`
      );
    }
    return `${name}: ${parts.join(' ')}`;
  });
}
