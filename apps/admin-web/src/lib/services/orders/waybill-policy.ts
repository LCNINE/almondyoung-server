// src/lib/services/orders/waybill-policy.ts
// 운송장 상태/carrier UI 정책 (순수). Core 가 실제 권한/전이 경계다.

export const WAYBILL_CARRIERS = [
  'CJ',
  'HANJIN',
  'LOTTE',
  'LOGEN',
  'KDEXP',
  'CJGLS',
] as const;

// 게이트웨이가 실제 구현된 carrier 만 발급 UI 에서 활성.
export const WAYBILL_LIVE_CARRIERS = ['HANJIN'] as const;

export function isCarrierSupported(carrier: string): boolean {
  return (WAYBILL_LIVE_CARRIERS as readonly string[]).includes(carrier);
}

// registered/used 만 운송장번호 확보(발급 성공).
export function isWaybillIssued(status: string | null | undefined): boolean {
  return status === 'registered' || status === 'used';
}

// 비종결 — 성공으로 표시 금지, 동일 키 재구동/폴링 대상.
export function isWaybillPendingIssue(
  status: string | null | undefined
): boolean {
  return status === 'pending' || status === 'allocated';
}

export function isWaybillFailed(status: string | null | undefined): boolean {
  return status === 'failed' || status === 'abandoned';
}

// 'voided' 는 의도적으로 미분류 — 발급 플로우 엔드포인트는 절대 반환하지 않으며
// (별도의 void 액션에서만 발생) 위 세 predicate 어디에도 매칭되지 않는다.
