// src/lib/api/domains/orders/shipment-phase.shape.ts
//
// 주문 «출고 단계» — core 가 주문 응답(list·getOne)에 실어 보내는 값(`shipmentPhase`)을 읽는 순수 함수.
// admin-web 은 컴포넌트 테스트가 안 되므로 화면이 읽는 판정은 여기서 한다.
// 서버 원형: apps/core/src/modules/sales-order/dto/sales-order-response.dto.ts
//
// 단계는 서버가 정한다. 옛 라인 상태로 클라이언트가 다시 도출하지 않는다 —
// 그 상태는 아무도 쓰지 않아 죽었고, 도출 규칙이 두 군데 있으면 갈린다.

export const SHIPMENT_PHASES = [
  'pending',
  'preparing',
  'shipping',
  'delivered',
  'external_shipped',
  'cancelled',
] as const;

export type ShipmentPhase = (typeof SHIPMENT_PHASES)[number];

const LABELS: Record<ShipmentPhase, string> = {
  pending: '결제대기',
  preparing: '준비중',
  shipping: '배송중',
  delivered: '배송완료',
  external_shipped: '외부 출고',
  cancelled: '취소',
};

/** 모르는 값·옛 core 응답(필드 없음) → null. 새 단계가 core 에 먼저 생겨도 화면이 죽지 않게 한다. */
export function toShipmentPhase(v: unknown): ShipmentPhase | null {
  return typeof v === 'string' && (SHIPMENT_PHASES as readonly string[]).includes(v)
    ? (v as ShipmentPhase)
    : null;
}

/** null(모름)은 빈 문자열 — 화면은 이때 배지를 그리지 않는다. */
export function shipmentPhaseLabel(p: ShipmentPhase | null): string {
  return p === null ? '' : LABELS[p];
}

/**
 * 상품 줄 배지 종류. 출고가 시작됐거나 끝난 주문은 매칭 여부와 무관하게 단계를 보인다(이미 나갔는데
 * «매칭 대기» 라고 하면 거짓이다). 아직 안 나간 주문(결제대기·준비중·모름)에서만 미매칭을 먼저 알린다.
 */
export function badgeKindOf(
  phase: ShipmentPhase | null,
  isMatched: boolean,
): 'phase' | 'unmatched' | 'none' {
  const left = phase === null || phase === 'pending' || phase === 'preparing';
  if (left && !isMatched) return 'unmatched';
  return phase === null ? 'none' : 'phase';
}
