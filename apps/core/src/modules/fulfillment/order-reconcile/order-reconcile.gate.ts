// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.ts
import { JudgedRow } from '../order-progress/order-progress.reader';
import { ReconcileSituationRef } from './order-reconcile.rule';

/**
 * 실행 직전 재판정 게이트의 판단(스펙 D12·§11.4-3). 투영은 최대 1분 늦다 — 후보로 고른 뒤 지금 판정이 규칙의 칸을
 * 벗어났으면(외부 출고·채널 취소 요청·반품으로 넘어갔거나 이미 다음 단계) 규칙을 부르지 않는다.
 * 판정 SQL 의 우선순위를 규칙의 check 가 다시 구현하지 않아도 되게 하는 것이 목적이다.
 */
export function stillInSituation(
  situation: ReconcileSituationRef,
  judged: Pick<JudgedRow, 'stage' | 'state' | 'outcome'> | undefined,
): boolean {
  if (!judged || judged.outcome !== null) return false;
  if (judged.stage !== situation.stage || judged.state === null) return false;
  return situation.states.includes(judged.state);
}
