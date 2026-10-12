import type { Charge } from '../types';

/**
 * provider 원장이 이 결제분을 어떤 결제분 id 로 기록했는가.
 *
 * 확정(CAPTURE)은 별도 결제분 행을 만들지만 provider 에는 승인(AUTHORIZE) 결제분 id 를 넘긴다
 * (`capture.service.ts` captureOneLeg). 그래서 포인트 원장의 사용(REDEEM)은 승인 id 를 키로 쌓인다.
 * 환불은 확정 결제분을 고르므로, 원장을 읽을 때는 이 함수로 승인 id 를 되찾아야 한다.
 * 승인 id 를 모르는 옛 확정 행은 자기 id 로 둔다(그 경우 지금처럼 원장을 못 찾고 실패한다).
 */
export function ledgerLegChargeId(charge: Pick<Charge, 'id' | 'operation' | 'requestPayload'>): string {
  if (charge.operation !== 'CAPTURE') return charge.id;
  const authorizeChargeId = charge.requestPayload?.['authorizeChargeId'];
  return typeof authorizeChargeId === 'string' && authorizeChargeId.length > 0 ? authorizeChargeId : charge.id;
}
