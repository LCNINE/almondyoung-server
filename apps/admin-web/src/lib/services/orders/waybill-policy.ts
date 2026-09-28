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

/**
 * 일시적 거절(한진 ERROR-05 일일한도 / ERROR-06 지역통제)로 «대기 중»인가.
 *
 * `pending` 을 전부 「진행중」으로 보여주면 이 건들이 정상 진행 중에 섞여 아무도 모른다 —
 * 실제로는 재시도 시각까지 아무 일도 일어나지 않는다. 상태만으로는 가를 수 없고
 * `nextAttemptAt` 이 미래인지를 같이 봐야 한다(#914).
 */
export function isWaybillWaitingRetry(
  status: string | null | undefined,
  nextAttemptAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (status !== 'pending' || !nextAttemptAt) return false;
  const at = new Date(nextAttemptAt).getTime();
  return Number.isFinite(at) && at > now.getTime();
}

/** 「내일 09:00 재시도」처럼 사람이 읽을 수 있는 문구. 대기 중이 아니면 null. */
export function retryNoticeOf(
  status: string | null | undefined,
  nextAttemptAt: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (!isWaybillWaitingRetry(status, nextAttemptAt, now)) return null;
  const at = new Date(nextAttemptAt as string);
  return `일시적 거절 — ${at.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })} 이후 재시도`;
}

// 'voided' 는 의도적으로 미분류 — 발급 플로우 엔드포인트는 절대 반환하지 않으며
// (별도의 void 액션에서만 발생) 위 세 predicate 어디에도 매칭되지 않는다.
